import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { readinessSummaryStats, readinessViewModel } from "../renderer/src/Backtest.helpers.js";
import { refoldBaselineRequest } from "../renderer/src/hooks/useBaseline.js";

const EXPECTED_IDS = ["tests", "baseline", "sessions", "corpus", "parity", "net_positive", "strategy_review", "user_approval"];

function completeGates(status = "pass") {
  return EXPECTED_IDS.map((id) => ({ id, status, reason: `${id} ${status}`, evidence: {} }));
}

function readinessWith({ verdict, ready, statuses = {} }) {
  return {
    verdict,
    ready,
    reason: verdict,
    gates: completeGates().map((gate) => statuses[gate.id] ? { ...gate, status: statuses[gate.id] } : gate),
  };
}

test("readinessViewModel maps ordered readiness gates to compact UI rows", () => {
  const gates = completeGates().map((gate) => (
    gate.id === "user_approval"
      ? { ...gate, status: "pending", reason: "approval pending", evidence: { approval_ok: false } }
      : gate
  ));
  const vm = readinessViewModel({
    verdict: "REVIEW_REQUIRED",
    ready: false,
    reason: "approval pending",
    gates,
  });

  assert.equal(vm.word, "REVIEW REQUIRED");
  assert.equal(vm.tone, "amber");
  assert.deepEqual(vm.rows.map((r) => r.id), EXPECTED_IDS);
  assert.deepEqual(vm.rows.at(-1), {
    id: "user_approval",
    label: "Approval",
    status: "pending",
    reason: "approval pending",
    evidence: { approval_ok: false },
  });
});

test("BacktestPopover imports the readiness view helper it renders", () => {
  const source = fs.readFileSync(new URL("../renderer/src/BacktestPopover.jsx", import.meta.url), "utf8");
  const helperImport = source.match(/import\s*\{([\s\S]*?)\}\s*from\s*["']\.\/Backtest\.helpers\.js["']/)?.[1] ?? "";
  assert.match(helperImport, /\breadinessViewModel\b/);
});

test("review regression — contradictory or incomplete green UI payload is forced BLOCKED with eight rows", () => {
  for (const payload of [
    { verdict: "NET_POSITIVE_APPROVED", ready: false, gates: completeGates() },
    { verdict: "NET_POSITIVE_APPROVED", ready: true, gates: [{ id: "tests", status: "fail", reason: "bad" }] },
    {
      verdict: "NET_POSITIVE_APPROVED",
      ready: true,
      gates: completeGates().map(({ evidence: _evidence, ...gate }) => gate),
    },
    {
      verdict: "NET_POSITIVE_APPROVED",
      ready: true,
      gates: completeGates().map((gate) => gate.id === "parity" ? { ...gate, status: "fail" } : gate),
    },
    {
      verdict: "NET_POSITIVE_APPROVED",
      ready: true,
      reason: { malformed: true },
      gates: completeGates(),
    },
    {
      verdict: "NET_POSITIVE_APPROVED",
      ready: true,
      reason: "all gates pass",
      gates: completeGates().map((gate, index) => index === 0 ? { ...gate, reason: "" } : gate),
    },
  ]) {
    const vm = readinessViewModel(payload);
    assert.equal(vm.verdict, "BLOCKED");
    assert.equal(vm.tone, "red");
    assert.deepEqual(vm.rows.map((row) => row.id), EXPECTED_IDS);
    assert.equal(vm.rows.every((row) => row.status === "fail"), true);
    assert.equal(vm.rows.every((row) => row.evidence === null), true);
    assert.equal(typeof vm.reason, "string");
  }
});

test("review regression — invalid envelopes cannot leak raw performance into BaselineVerdict", () => {
  const gates = completeGates().map((gate) => {
    if (gate.id === "sessions") return { ...gate, evidence: { sessions: 20, min_sessions: 20 } };
    if (gate.id === "net_positive") return { ...gate, evidence: { cum_r: 999, sessions: 20 } };
    return gate;
  }).reverse();
  const vm = readinessViewModel({ verdict: "NET_POSITIVE_APPROVED", ready: true, gates });
  assert.equal(vm.verdict, "BLOCKED");
  assert.deepEqual(readinessSummaryStats(vm), { cum_r: null, sessions: null });

  const source = fs.readFileSync(new URL("../renderer/src/BacktestPopover.jsx", import.meta.url), "utf8");
  const body = source.match(/function BaselineVerdict[\s\S]*?function BaselineHeader/)?.[0] ?? "";
  assert.match(body, /readinessSummaryStats\(vm\)/);
  assert.doesNotMatch(body, /readiness\?\.gates/);
});

test("review regression — renderer enforces canonical gate-to-verdict precedence for non-green states", () => {
  const reviewRequired = readinessViewModel(readinessWith({
    verdict: "REVIEW_REQUIRED",
    ready: false,
    statuses: { strategy_review: "pending", user_approval: "pending" },
  }));
  assert.equal(reviewRequired.verdict, "REVIEW_REQUIRED");

  const notReady = readinessViewModel(readinessWith({
    verdict: "NOT_READY",
    ready: false,
    statuses: { net_positive: "fail" },
  }));
  assert.equal(notReady.verdict, "NOT_READY");

  const softenedMechanicalFailure = readinessViewModel(readinessWith({
    verdict: "REVIEW_REQUIRED",
    ready: false,
    statuses: { tests: "fail", strategy_review: "pending", user_approval: "pending" },
  }));
  assert.equal(softenedMechanicalFailure.verdict, "BLOCKED");
  assert.equal(softenedMechanicalFailure.reason, "readiness payload invalid or incomplete");

  const softenedNonPositive = readinessViewModel(readinessWith({
    verdict: "REVIEW_REQUIRED",
    ready: false,
    statuses: { net_positive: "fail", strategy_review: "pending", user_approval: "pending" },
  }));
  assert.equal(softenedNonPositive.verdict, "BLOCKED");
});

test("review regression — rejected refold is handled and clears readiness", async () => {
  const patches = [];
  const result = await refoldBaselineRequest({
    api: { refold: async () => { throw new Error("fold failed"); } },
    symbol: "MNQ1!",
    isCurrent: () => true,
    onState: (patch) => patches.push(patch),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /fold failed/);
  assert.equal(patches[0].readiness, null);
  assert.equal(patches.at(-1).refolding, false);
});

test("review regression — stale refold completion cannot cross-wire symbols", async () => {
  let resolveRefold;
  let current = true;
  const patches = [];
  const pending = refoldBaselineRequest({
    api: {
      refold: () => new Promise((resolve) => { resolveRefold = resolve; }),
      history: async () => ({ history: [{ id: "mnq-history" }] }),
    },
    symbol: "MNQ1!",
    isCurrent: () => current,
    onState: (patch) => patches.push(patch),
  });
  current = false;
  resolveRefold({ baseline: { symbol: "MNQ1!" }, readiness: { verdict: "BLOCKED" } });
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(patches.some((patch) => patch.baseline?.symbol === "MNQ1!"), false);
});

test("review regression — successful refold consumes exact IPC envelopes", async () => {
  const patches = [];
  const result = await refoldBaselineRequest({
    api: {
      refold: async () => ({ baseline: { symbol: "MES1!" }, readiness: { verdict: "BLOCKED" } }),
      history: async () => ({ history: [{ total_r: 1 }] }),
    },
    symbol: "MES1!",
    isCurrent: () => true,
    onState: (patch) => patches.push(patch),
  });
  assert.equal(result.ok, true);
  assert.equal(patches.some((patch) => patch.baseline?.symbol === "MES1!"), true);
  assert.equal(patches.some((patch) => patch.readiness?.verdict === "BLOCKED"), true);
  assert.deepEqual(patches.find((patch) => patch.history)?.history, [{ total_r: 1 }]);
});

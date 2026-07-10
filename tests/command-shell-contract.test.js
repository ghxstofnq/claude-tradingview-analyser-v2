// command-shell-contract.test — the deterministic half of the Command Shell
// workflow harness (Task D1). The Playwright half (design-harness/command-shell-
// smoke.mjs) drives the real renderer; this file locks the two pure contracts
// the harness depends on, under `node --test` (no browser):
//   1. the fixture adapter's production guard + api shape, and
//   2. every fixture scenario satisfies the REAL renderer sanitizers, so a green
//      harness can never be a false pass on a malformed fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFixtureApi, buildFixtureState, installFixtureApi,
  defaultReadinessRows, defaultBacktestReadiness,
} from "../app/renderer/src/fixture-adapter.js";
import { readinessView, readinessBadge } from "../app/renderer/src/Readiness.helpers.js";
import { readinessViewModel } from "../app/renderer/src/Backtest.helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = JSON.parse(readFileSync(path.join(repoRoot, "design-harness/fixtures/command-shell-state.json"), "utf8"));

// ── 1. production guard: the adapter must never install without the sentinel ──
test("installFixtureApi throws unless the harness sentinel is present", () => {
  const saved = globalThis.window;
  try {
    globalThis.window = { __GOFNQ_FIXTURE__: undefined }; // no sentinel
    assert.throws(() => installFixtureApi({ __isGofnqFixtureHarness: true }), /refusing to install/);
    // a forged sentinel that isn't the object on window is refused too
    const forged = { __isGofnqFixtureHarness: true };
    globalThis.window = { __GOFNQ_FIXTURE__: { __isGofnqFixtureHarness: true } };
    assert.throws(() => installFixtureApi(forged), /refusing to install/);
  } finally {
    if (saved === undefined) delete globalThis.window; else globalThis.window = saved;
  }
});

test("installFixtureApi installs only when window.__GOFNQ_FIXTURE__ IS the sentinel", () => {
  const saved = globalThis.window;
  try {
    const sentinel = { __isGofnqFixtureHarness: true, state: {}, crashPage: "agent" };
    globalThis.window = { __GOFNQ_FIXTURE__: sentinel };
    const api = installFixtureApi(sentinel);
    assert.equal(typeof api, "object");
    assert.equal(globalThis.window.api, api);
    assert.equal(globalThis.window.__GOFNQ_FIXTURE_CRASH__, "agent");
  } finally {
    if (saved === undefined) delete globalThis.window; else globalThis.window = saved;
  }
});

// ── 2. api shape: the namespaces/methods the hooks call must exist ────────────
test("buildFixtureApi exposes the preload namespaces the renderer reads", async () => {
  const api = buildFixtureApi({ state: {} });
  // invoke-style
  for (const p of [
    ["execution", "state"], ["execution", "orderIntents"], ["execution", "flatten"],
    ["execution", "placeManual"], ["prep", "get"], ["setups", "current"],
    ["trade", "list"], ["trade", "accept"], ["review", "journal"], ["readiness", "get"],
  ]) {
    assert.equal(typeof api[p[0]][p[1]], "function", `api.${p[0]}.${p[1]} missing`);
  }
  assert.equal(typeof api.execution.config.get, "function");
  assert.equal(typeof api.backtest.baseline.readiness, "function");
  // on*-style subscribers must return an unsubscribe function
  const off = api.health.onUpdate(() => {});
  assert.equal(typeof off, "function");
  off();
  // resolved shapes
  const state = await api.execution.state();
  assert.equal(state.ok, true);
  const cfg = await api.execution.config.get();
  assert.equal(cfg.config.automationMode, "manual");
});

test("execStaleAfter makes execution.state fail after N ok reads", async () => {
  const api = buildFixtureApi({ state: { execStaleAfter: 1, executionState: { connected: true, position: { qty: 1 }, workingOrders: [] } } });
  assert.equal((await api.execution.state()).ok, true);   // 1st ok
  assert.equal((await api.execution.state()).ok, false);  // then fails → drives exec-stale
});

test("flatten/accept calls are recorded, not executed", async () => {
  const api = buildFixtureApi({ state: {} });
  assert.deepEqual(api.__fixtureCalls.flatten, []);
  await api.execution.flatten({ symbol: "MNQ1!" });
  assert.equal(api.__fixtureCalls.flatten.length, 1);
  await api.trade.accept({ id: "s1" });
  assert.equal(api.__fixtureCalls.accept.length, 1);
});

test("defaults: 11 readiness rows and 8 backtest gates in the pinned order", () => {
  const rows = defaultReadinessRows();
  assert.equal(rows.length, 11);
  const br = defaultBacktestReadiness();
  assert.equal(br.gates.length, 8);
  assert.equal(readinessBadge(readinessView({ rows })).text, "READY"); // all-green default
});

// ── 3. every fixture scenario satisfies the REAL renderer sanitizers ──────────
test("fixture file carries all 10 plan scenarios + the keyboard scenario", () => {
  const keys = Object.keys(FIXTURES.scenarios);
  for (const need of [
    "briefing", "manual-setup", "auto-blocked", "pending-order", "filled-protected",
    "filled-critical", "stale-feed", "review-domains", "backtest-blocked", "page-crash", "keyboard",
  ]) {
    assert.ok(keys.includes(need), `fixture scenario "${need}" missing`);
  }
});

test("every scenario builds a fixture state without throwing", () => {
  for (const [key, scenario] of Object.entries(FIXTURES.scenarios)) {
    const st = buildFixtureState(scenario);
    assert.equal(typeof st, "object", `${key} built no state`);
    assert.ok(Array.isArray(st.readiness.rows), `${key} readiness rows`);
  }
});

test("auto-blocked readiness sanitizes to a trusted BLOCKED card with real blockers", () => {
  const view = readinessView(FIXTURES.scenarios["auto-blocked"].state.readiness);
  assert.equal(view.trusted, true);                       // 11 valid rows → trusted
  assert.equal(readinessBadge(view).text, "BLOCKED");     // safety-red protective_stop
  const blockerIds = view.summary.blockers.map((b) => b.id);
  assert.ok(blockerIds.includes("detector"), "detector should be a blocker");
  assert.ok(blockerIds.includes("protective_stop"), "protective_stop should be a blocker");
});

test("backtest-blocked readiness sanitizes to a trusted BLOCKED verdict on the corpus gate", () => {
  const vm = readinessViewModel(FIXTURES.scenarios["backtest-blocked"].state.backtestReadiness);
  assert.equal(vm.trusted, true);      // valid 8-gate contract
  assert.equal(vm.verdict, "BLOCKED");
  assert.equal(vm.word, "BLOCKED");
  const corpus = vm.rows.find((r) => r.id === "corpus");
  assert.equal(corpus.status, "fail");
});

test("briefing fixture exposes the deterministic grade/draw/quality the page reads", () => {
  const b = FIXTURES.scenarios.briefing.state.briefsBySymbol["MNQ1!"];
  assert.equal(b.pillar_grade, "B");                      // grade
  assert.equal(b.pillar2_verdict, "marginal");            // quality
  assert.ok(b.primary_draw && b.anchored_target, "draw/target present"); // draw
  assert.equal(b.pillar1_votes.htf, "bullish");
});

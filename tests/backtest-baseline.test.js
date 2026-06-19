// Unit tests for the faithful-baseline core (pure helpers + the buildAnalytics
// round-trip invariant). The full corpus fold (foldSymbol) is an integration
// check run manually at Checkpoint A — too slow/corpus-dependent for CI.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  symbolSlug, buildSetupRows, shouldSnapshot, diffPerDay, round2,
  refoldBaseline, readBaseline, readHistory, applyRunResultsToIndex,
  writeBaseline, buildTestArtifact, writeTestVerdict, readTest, listTests, deleteTest,
} from "../app/main/backtest-baseline.js";
import { buildAnalytics } from "../cli/lib/backtest-analytics.js";

test("symbolSlug strips non-alphanumerics", () => {
  assert.equal(symbolSlug("MNQ1!"), "MNQ1");
  assert.equal(symbolSlug("MES1!"), "MES1");
});

test("buildSetupRows emits open+outcome with signed realized_r", () => {
  const setup = { id: "s1", side: "long", entry: 100, stop: 90, tp1: 120, tp2: 140, grade: "A+", model: "MSS", event_ts: "2026-05-11T13:31:00Z" };
  const [open, outcome] = buildSetupRows(setup, { outcome: "tp1_hit", exit: 120 });
  assert.equal(open.type, "open");
  assert.equal(open.id, "s1");
  assert.equal(open.tp1, 120);
  assert.equal(open.grade, "A+");
  assert.equal(outcome.type, "outcome");
  assert.equal(outcome.setup_id, "s1");
  assert.equal(outcome.outcome, "tp1_hit");
  assert.equal(outcome.realized_r, 2); // (120-100)/10

  const [, shortOc] = buildSetupRows(
    { id: "s2", side: "short", entry: 200, stop: 210 },
    { outcome: "stop_hit", exit: 210 },
  );
  assert.equal(shortOc.realized_r, -1); // (200-210)/10
});

test("shouldSnapshot only on total or sha change", () => {
  const a = { total_r: 100, code_sha: "abc" };
  assert.equal(shouldSnapshot(null, a), false);
  assert.equal(shouldSnapshot(a, { total_r: 100, code_sha: "abc" }), false);
  assert.equal(shouldSnapshot(a, { total_r: 117, code_sha: "abc" }), true);
  assert.equal(shouldSnapshot(a, { total_r: 100, code_sha: "def" }), true);
});

test("diffPerDay aligns by date+session, nulls missing side", () => {
  const base = [{ date: "2026-05-11", session: "ny-am", r: 5 }, { date: "2026-05-11", session: "ny-pm", r: 2 }];
  const treat = [{ date: "2026-05-11", session: "ny-am", r: 8 }, { date: "2026-05-12", session: "ny-am", r: -1 }];
  const d = diffPerDay(base, treat);
  const am11 = d.find((x) => x.date === "2026-05-11" && x.session === "ny-am");
  assert.equal(am11.delta, 3); // 8 - 5
  const pm11 = d.find((x) => x.session === "ny-pm");
  assert.equal(pm11.baseline_r, 2);
  assert.equal(pm11.treatment_r, null);
  assert.equal(pm11.delta, -2); // 0 - 2
  const am12 = d.find((x) => x.date === "2026-05-12");
  assert.equal(am12.baseline_r, null);
  assert.equal(am12.delta, -1); // -1 - 0
});

test("buildAnalytics(run_details).cum_r equals the booked total (the dashboard invariant)", () => {
  // A: long tp1 +2R · B: short stop -1R · C: long 16:00-close +0.4R (default branch uses realized_r)
  const mk = (setup, oc) => buildSetupRows(
    { grade: "B", model: "MSS", ...setup },
    oc,
  );
  const setups = [
    ...mk({ id: "a", side: "long", entry: 100, stop: 90, tp1: 120, tp2: 140 }, { outcome: "tp1_hit", exit: 120 }),
    ...mk({ id: "b", side: "short", entry: 200, stop: 210, tp1: 180, tp2: 160 }, { outcome: "stop_hit", exit: 210 }),
    ...mk({ id: "c", side: "long", entry: 50, stop: 45, tp1: 70, tp2: 90 }, { outcome: "closed_1600", exit: 52 }),
  ];
  const run_details = [{ entry: { date: "2026-05-11", session: "ny-am", open_reaction: null }, setups }];
  const A = buildAnalytics(run_details);
  const expectedTotal = round2(2 + -1 + 0.4);
  assert.equal(A.cum_r, expectedTotal);
  assert.equal(A.n_trades, 3);
});

test("refoldBaseline persists, snapshots history only on change, carries reason", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-test-"));
  const symbol = "MNQ1!";
  const mkFold = (total_r, code_sha, built_at) =>
    async () => ({ symbol, total_r, code_sha, built_at, corpus: { n_sessions: 5, dates: [] }, per_day: [], run_details: [], reason: null });

  // first fold — writes baseline, history stays empty
  const b1 = await refoldBaseline({ stateDir, symbol, fold: mkFold(100, "abc", "t1") });
  assert.equal(b1.total_r, 100);
  assert.equal(readBaseline({ stateDir, symbol }).total_r, 100);
  assert.deepEqual(readHistory({ stateDir, symbol }), []);

  // second fold with a changed total — snapshots the prior (100) into history
  await refoldBaseline({ stateDir, symbol, reason: "adopt X", fold: mkFold(117, "abc", "t2") });
  const hist = readHistory({ stateDir, symbol });
  assert.equal(hist.length, 1);
  assert.equal(hist[0].total_r, 100);
  assert.equal(readBaseline({ stateDir, symbol }).total_r, 117);
  assert.equal(readBaseline({ stateDir, symbol }).reason, "adopt X");

  // third fold identical (same total + sha) — no new history record
  await refoldBaseline({ stateDir, symbol, fold: mkFold(117, "abc", "t3") });
  assert.equal(readHistory({ stateDir, symbol }).length, 1);

  fs.rmSync(stateDir, { recursive: true, force: true });
});

test("applyRunResultsToIndex writes faithful per-run totals back, leaves others", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "idx-test-"));
  const BT = path.join(stateDir, "backtest");
  fs.mkdirSync(BT, { recursive: true });
  fs.writeFileSync(path.join(BT, "index.json"), JSON.stringify({ runs: [
    { run_id: "r1", date: "2026-05-11", session: "ny-am", symbol: "MNQ1!", total_r: 0 },
    { run_id: "r2", date: "2026-05-11", session: "ny-pm", symbol: "MNQ1!", total_r: 0 },
    { run_id: "rX", date: "2026-05-11", session: "ny-am", symbol: "MES1!", total_r: 9 },
  ] }));

  applyRunResultsToIndex({ stateDir, marker: "refold-abc", runResults: [
    { run_id: "r1", total_r: 5.5, wins: 1, losses: 0, setups: 1 },
    { run_id: "r2", total_r: -1, wins: 0, losses: 1, setups: 1 },
  ] });

  const ix = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
  const r1 = ix.runs.find((r) => r.run_id === "r1");
  assert.equal(r1.total_r, 5.5);
  assert.equal(r1.wins, 1);
  assert.equal(r1.refold_baseline, "refold-abc");
  const rX = ix.runs.find((r) => r.run_id === "rX");
  assert.equal(rX.total_r, 9); // untouched
  assert.equal(rX.refold_baseline, undefined);

  fs.rmSync(stateDir, { recursive: true, force: true });
});

test("buildTestArtifact diffs treatment vs accepted baseline; verdict + list round-trip", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "tests-test-"));
  const symbol = "MNQ1!";

  // accepted baseline: AM +5, PM 0 over 2026-05-11
  writeBaseline({ stateDir, symbol, baseline: {
    symbol, total_r: 5, code_sha: "oldsha", reason: null,
    corpus: { n_sessions: 2, dates: ["2026-05-11"] },
    per_day: [{ date: "2026-05-11", session: "ny-am", r: 5 }, { date: "2026-05-11", session: "ny-pm", r: 0 }],
    run_details: [],
  } });

  // treatment (stub fold): AM +8, PM 0 — same corpus, code improved +3
  const stubFold = async () => ({
    symbol, code_sha: "newsha", total_r: 8,
    corpus: { n_sessions: 2, dates: ["2026-05-11"] },
    per_day: [{ date: "2026-05-11", session: "ny-am", r: 8 }, { date: "2026-05-11", session: "ny-pm", r: 0 }],
    run_details: [{ entry: { date: "2026-05-11", session: "ny-am" }, setups: [] }],
  });

  const t = await buildTestArtifact({ stateDir, symbol, label: "my gate", fold: stubFold });
  assert.equal(t.baseline_total, 5);
  assert.equal(t.treatment_total, 8);
  assert.equal(t.delta, 3);
  assert.equal(t.corpus_match, true);
  assert.equal(t.status, "pending");
  const am = t.per_day.find((d) => d.session === "ny-am");
  assert.equal(am.delta, 3);

  // list strips the heavy run_details
  const list = listTests({ stateDir, symbol });
  assert.equal(list.length, 1);
  assert.equal(list[0].treatment_run_details, undefined);
  assert.equal(list[0].delta, 3);

  // accept with a reason persists
  writeTestVerdict({ stateDir, id: t.id, status: "accepted", reason: "real +3R, no regressions" });
  const got = readTest({ stateDir, id: t.id });
  assert.equal(got.status, "accepted");
  assert.equal(got.reason, "real +3R, no regressions");

  deleteTest({ stateDir, id: t.id });
  assert.equal(readTest({ stateDir, id: t.id }), null);

  fs.rmSync(stateDir, { recursive: true, force: true });
});

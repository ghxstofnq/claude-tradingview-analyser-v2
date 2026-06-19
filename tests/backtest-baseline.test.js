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

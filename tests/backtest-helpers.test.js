// tests/backtest-helpers.test.js
// Pure helpers consumed by BacktestPopover.jsx — testable via `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextState,
  aggregateRuns,
  filterRuns,
  formatRunForRow,
  estimateRun,
} from "../app/renderer/src/Backtest.helpers.js";

test("nextState — IDLE + START → AUTO_RUNNING", () => {
  assert.equal(nextState("IDLE", { type: "START", mode: "auto" }), "AUTO_RUNNING");
  assert.equal(nextState("IDLE", { type: "START", mode: "pause" }), "AUTO_RUNNING");
});

test("nextState — AUTO_RUNNING + SETUP_SURFACED (mode=pause) → PAUSE_AWAITING", () => {
  assert.equal(nextState("AUTO_RUNNING", { type: "SETUP_SURFACED", mode: "pause" }), "PAUSE_AWAITING");
});

test("nextState — AUTO_RUNNING + SETUP_SURFACED (mode=auto) → stays AUTO_RUNNING", () => {
  assert.equal(nextState("AUTO_RUNNING", { type: "SETUP_SURFACED", mode: "auto" }), "AUTO_RUNNING");
});

test("nextState — PAUSE_AWAITING + DECISION → AUTO_RUNNING", () => {
  assert.equal(nextState("PAUSE_AWAITING", { type: "DECISION", choice: "accept" }), "AUTO_RUNNING");
  assert.equal(nextState("PAUSE_AWAITING", { type: "DECISION", choice: "reject" }), "AUTO_RUNNING");
});

test("nextState — COMPLETE from running/paused → DONE", () => {
  assert.equal(nextState("AUTO_RUNNING", { type: "COMPLETE" }), "DONE");
  assert.equal(nextState("PAUSE_AWAITING", { type: "COMPLETE" }), "DONE");
});

test("nextState — DONE + DISMISS → IDLE", () => {
  assert.equal(nextState("DONE", { type: "DISMISS" }), "IDLE");
});

test("nextState — VIEW_ALL from IDLE / DONE → LIBRARY", () => {
  assert.equal(nextState("IDLE", { type: "VIEW_ALL" }), "LIBRARY");
  assert.equal(nextState("DONE", { type: "VIEW_ALL" }), "LIBRARY");
});

test("nextState — LIBRARY + ROW_CLICK → DETAIL", () => {
  assert.equal(nextState("LIBRARY", { type: "ROW_CLICK" }), "DETAIL");
});

test("nextState — DETAIL + BACK → LIBRARY", () => {
  assert.equal(nextState("DETAIL", { type: "BACK" }), "LIBRARY");
});

test("nextState — unknown event keeps state", () => {
  assert.equal(nextState("IDLE", { type: "WAT" }), "IDLE");
});

test("aggregateRuns — totals + per-grade + agreement", () => {
  const runs = [
    {
      setups: 2, wins: 2, losses: 0, total_r: 8.5,
      your_agreement: { agreed: 2, disagreed: 0, ungraded: 0 }, best_model: "MSS",
      setups_by_grade: { "A+": 2, B: 0, NO: 0 }, wins_by_grade: { "A+": 2, B: 0 },
    },
    {
      setups: 1, wins: 0, losses: 1, total_r: -1.0,
      your_agreement: { agreed: 0, disagreed: 1, ungraded: 0 }, best_model: "Trend",
      setups_by_grade: { "A+": 0, B: 1, NO: 0 }, wins_by_grade: { "A+": 0, B: 0 },
    },
  ];
  const agg = aggregateRuns(runs);
  assert.equal(agg.total_runs, 2);
  assert.equal(agg.cum_r, 7.5);
  assert.deepEqual(agg.aplus_hit_rate, { numerator: 2, denominator: 2 });
  assert.deepEqual(agg.b_hit_rate, { numerator: 0, denominator: 1 });
  assert.equal(agg.agreement.agreed, 2);
  assert.equal(agg.agreement.disagreed, 1);
});

test("aggregateRuns — empty list", () => {
  const agg = aggregateRuns([]);
  assert.equal(agg.total_runs, 0);
  assert.equal(agg.cum_r, 0);
});

test("filterRuns — by session", () => {
  const runs = [
    { session: "ny-am", date: "2026-05-20" },
    { session: "ny-pm", date: "2026-05-19" },
    { session: "london", date: "2026-05-18" },
  ];
  assert.equal(filterRuns(runs, { session: "ny-am" }).length, 1);
  assert.equal(filterRuns(runs, { session: null }).length, 3);
});

test("filterRuns — by mode", () => {
  const runs = [{ mode: "auto" }, { mode: "pause" }, { mode: "auto" }];
  assert.equal(filterRuns(runs, { mode: "auto" }).length, 2);
});

test("filterRuns — by grade NO (= zero setups)", () => {
  const runs = [{ setups: 0 }, { setups: 1, setups_by_grade: { "A+": 1 } }];
  assert.equal(filterRuns(runs, { grade: "NO" }).length, 1);
});

test("formatRunForRow — shortens session label", () => {
  const row = formatRunForRow({ session: "ny-am", date: "2026-05-20", total_r: 8.5 });
  assert.equal(row.session_short, "AM");
  assert.equal(row.session_short_for, "ny-am");
});

test("estimateRun — deterministic engine is free; wall-time estimate sane", () => {
  const a = estimateRun({ session: "ny-am" });
  const b = estimateRun({ session: "ny-pm" });
  assert.equal(a.cost, 0);
  assert.equal(b.cost, 0);
  assert.ok(a.minutes >= 5 && a.minutes <= 30, `minutes estimate out of range: ${a.minutes}`);
  assert.ok(b.bars >= a.bars);
});

test("estimateRun — unknown session falls back to default bars", () => {
  const v = estimateRun({ session: "unknown" });
  assert.ok(v.bars > 0);
  assert.equal(v.cost, 0);
});

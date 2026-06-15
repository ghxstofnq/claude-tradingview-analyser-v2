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
  formatClockEt,
  recordClockEt,
  outcomeMeta,
  runGrade,
  displayGrade,
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

test("nextState — NEW (RUN_ANOTHER) escapes ANALYTICS/DETAIL back to IDLE", () => {
  // Regression: the header NEW tab dispatches RUN_ANOTHER; from LIBRARY it was
  // a no-op, trapping the user in ANALYTICS.
  assert.equal(nextState("LIBRARY", { type: "RUN_ANOTHER" }), "IDLE");
  assert.equal(nextState("DETAIL", { type: "RUN_ANOTHER" }), "IDLE");
  // But a RUN_ANOTHER must NOT abandon an in-flight run (use STOP for that).
  assert.equal(nextState("AUTO_RUNNING", { type: "RUN_ANOTHER" }), "AUTO_RUNNING");
  assert.equal(nextState("PAUSE_AWAITING", { type: "RUN_ANOTHER" }), "PAUSE_AWAITING");
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

// ── Display-fix regression tests (2026-06-15) ──────────────────────────
// The backtest DETAIL view showed run-time instead of session-time, mislabeled
// UTC as ET, rendered TP2 winners as red "STOPPED", and defaulted missing
// grades to "A+". These lock the fixes.

test("formatClockEt — converts UTC to New York (ET), not a UTC slice labeled ET", () => {
  // 2026-05-13 13:50 UTC = 09:50 EDT.
  assert.equal(formatClockEt("2026-05-13T13:50:00.000Z"), "09:50 ET");
  // epoch ms accepted too
  assert.equal(formatClockEt(Date.parse("2026-05-13T13:50:00.000Z")), "09:50 ET");
  assert.equal(formatClockEt(null), "");
  assert.equal(formatClockEt(""), "");
});

test("recordClockEt — prefers the historical event_ts over the run-time ts", () => {
  // The bug: ts is the wall-clock fold time (run day); event_ts is the real bar.
  const rec = { ts: 1781515901746 /* 2026-06-15 run time */, event_ts: "2026-05-13T13:50:00.000Z" };
  assert.equal(recordClockEt(rec), "09:50 ET");
  // Falls back to ts when no event_ts (e.g. live-streamed activity).
  assert.equal(recordClockEt({ ts: "2026-05-13T14:00:00.000Z" }), "10:00 ET");
  assert.equal(recordClockEt({}), "");
});

test("outcomeMeta — BOTH targets are wins; only a stop is a loss", () => {
  assert.deepEqual(outcomeMeta("tp1_hit"), { cls: "win", label: "HIT TP1" });
  assert.deepEqual(outcomeMeta("tp2_hit"), { cls: "win", label: "HIT TP2" }); // was rendered "STOPPED"
  assert.deepEqual(outcomeMeta("stop_hit"), { cls: "loss", label: "STOPPED" });
  assert.equal(outcomeMeta("closed_eod").cls, "live");
  assert.deepEqual(outcomeMeta(undefined), { cls: "live", label: null }); // still open → no badge
  assert.equal(outcomeMeta("weird_state").label, "WEIRD STATE");
});

test("runGrade — strategy grade of the setups, independent of win-rate", () => {
  // A losing day of A+ setups is still graded A+ (was "B" under the win-rate heuristic).
  assert.equal(runGrade({ setups: 5, wins: 0, losses: 5, setups_by_grade: { "A+": 5 } }), "A+");
  assert.equal(runGrade({ setups: 3, wins: 3, losses: 0, setups_by_grade: { B: 3 } }), "B");
  assert.equal(runGrade({ setups: 4, setups_by_grade: { "A+": 1, B: 3 } }), "A+"); // best present
  assert.equal(runGrade({ setups: 0 }), "NO");
});

test("displayGrade — never fabricates an A+ for a missing grade", () => {
  assert.equal(displayGrade("A+"), "A+");
  assert.equal(displayGrade("B"), "B");
  assert.equal(displayGrade(undefined), "—");
  assert.equal(displayGrade(null), "—");
});

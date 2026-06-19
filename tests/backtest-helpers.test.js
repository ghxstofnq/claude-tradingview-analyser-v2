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
  sessionClosedET,
  weekdaysBetween,
  expandStudy,
  todayET,
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

test("nextState — RE-RUN (START) from DONE / DETAIL → AUTO_RUNNING", () => {
  // RE-RUN buttons dispatch START; from DONE it used to rely on the followEngine
  // quirk, and from DETAIL it stranded the UI. Both now transition explicitly.
  assert.equal(nextState("DONE", { type: "START", mode: "auto" }), "AUTO_RUNNING");
  assert.equal(nextState("DETAIL", { type: "START", mode: "auto" }), "AUTO_RUNNING");
});

test("filterRuns — query matches date / run_id substring", () => {
  const runs = [
    { run_id: "r1", date: "2026-06-16", session: "ny-am", mode: "auto" },
    { run_id: "r2", date: "2026-06-09", session: "ny-pm", mode: "auto" },
  ];
  assert.deepEqual(filterRuns(runs, { query: "06-16" }).map((r) => r.run_id), ["r1"]);
  assert.deepEqual(filterRuns(runs, { query: "r2" }).map((r) => r.run_id), ["r2"]);
  assert.equal(filterRuns(runs, { query: "zzz" }).length, 0);
  assert.equal(filterRuns(runs, { query: "" }).length, 2);          // empty = no filter
  assert.equal(filterRuns(runs, {}).length, 2);                      // absent = no filter
  // query composes with the existing filters
  assert.deepEqual(filterRuns(runs, { session: "ny-pm", query: "2026" }).map((r) => r.run_id), ["r2"]);
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

test("filterRuns — by symbol (per-instrument analytics scoping)", () => {
  const runs = [
    { run_id: "a", symbol: "MNQ1!", session: "ny-am" },
    { run_id: "b", symbol: "MES1!", session: "ny-am" },
    { run_id: "c", symbol: "MNQ1!", session: "ny-pm" },
    { run_id: "d", session: "ny-am" }, // untagged legacy run
  ];
  assert.deepEqual(filterRuns(runs, { symbol: "MNQ1!" }).map((r) => r.run_id), ["a", "c"]);
  assert.deepEqual(filterRuns(runs, { symbol: "MES1!" }).map((r) => r.run_id), ["b"]);
  // Untagged runs match NEITHER instrument (never shown under a fabricated symbol).
  assert.equal(filterRuns(runs, { symbol: "MNQ1!" }).some((r) => r.run_id === "d"), false);
  // symbol composes with the other filters.
  assert.deepEqual(filterRuns(runs, { symbol: "MNQ1!", session: "ny-pm" }).map((r) => r.run_id), ["c"]);
  // absent symbol = no symbol filter (all runs).
  assert.equal(filterRuns(runs, {}).length, 4);
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

// ── Future-date guard (2026-06-19 bug: a custom range ran today pre-open +
// all of next week, since nothing stopped jobs at the last closed session) ──

// Fixed reference "now": 2026-06-19 (Fri) 10:00 ET = 14:00 UTC (EDT).
const NOW = Date.UTC(2026, 5, 19, 14, 0);

test("sessionClosedET — a fully past session is closed", () => {
  assert.equal(sessionClosedET("2026-06-18", "ny-am", NOW), true);
  assert.equal(sessionClosedET("2026-06-18", "ny-pm", NOW), true);
});

test("sessionClosedET — today before the close is NOT closed; after IS", () => {
  // 10:00 ET now: ny-am (closes 12:00) not closed; london (closes 06:00) closed.
  assert.equal(sessionClosedET("2026-06-19", "ny-am", NOW), false);
  assert.equal(sessionClosedET("2026-06-19", "ny-pm", NOW), false);
  assert.equal(sessionClosedET("2026-06-19", "london", NOW), true);
});

test("sessionClosedET — a future date is never closed", () => {
  assert.equal(sessionClosedET("2026-06-22", "ny-am", NOW), false);
  assert.equal(sessionClosedET("2026-06-25", "ny-pm", NOW), false);
});

test("expandStudy — drops not-yet-closed sessions (today pre-close + future)", () => {
  // Range Wed 06-17 → next Thu 06-25, NY-AM only, MES, at NOW (Fri 10:00 ET).
  const jobs = expandStudy({
    symbol: "mes", start: "2026-06-17", end: "2026-06-25",
    sessions: { "ny-am": true, "ny-pm": false, london: false }, mode: "auto", now: NOW,
  });
  const dates = jobs.map((j) => j.date);
  // Only fully-closed NY-AM sessions: 06-17, 06-18. NOT 06-19 (closes 12:00,
  // now is 10:00) and NOT 06-22..06-25 (future weekdays).
  assert.deepEqual(dates, ["2026-06-17", "2026-06-18"]);
  assert.ok(jobs.every((j) => j.symbol === "mes" && j.session === "ny-am"));
});

test("expandStudy — today's london (closed by 10:00 ET) IS included, today's am/pm are not", () => {
  const jobs = expandStudy({
    symbol: "mnq", start: "2026-06-19", end: "2026-06-19",
    sessions: { "ny-am": true, "ny-pm": true, london: true }, mode: "auto", now: NOW,
  });
  assert.deepEqual(jobs.map((j) => j.session), ["london"]);
});

test("expandStudy — BOTH expands each closed session into an MNQ + MES job", () => {
  const jobs = expandStudy({
    symbol: "both", start: "2026-06-18", end: "2026-06-18",
    sessions: { "ny-am": true, "ny-pm": false, london: false }, mode: "auto", now: NOW,
  });
  assert.deepEqual(jobs.map((j) => j.symbol).sort(), ["mes", "mnq"]);
});

test("weekdaysBetween — inclusive, skips weekends, 0 if reversed", () => {
  assert.equal(weekdaysBetween("2026-06-15", "2026-06-19"), 5); // Mon–Fri
  assert.equal(weekdaysBetween("2026-06-19", "2026-06-22"), 2); // Fri + Mon (Sat/Sun skipped)
  assert.equal(weekdaysBetween("2026-06-19", "2026-06-15"), 0); // reversed
});

test("todayET — returns the ET calendar date for the given instant", () => {
  // 2026-06-19 14:00 UTC = 10:00 ET → still 2026-06-19 in ET.
  assert.equal(todayET(NOW), "2026-06-19");
  // 2026-06-20 02:00 UTC = 2026-06-19 22:00 ET → previous ET day.
  assert.equal(todayET(Date.UTC(2026, 5, 20, 2, 0)), "2026-06-19");
});

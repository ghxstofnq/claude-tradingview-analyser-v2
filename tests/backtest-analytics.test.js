import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate, byCut, outcomeBreakdown,
  computeTradeR, tradesFromSetups, buildAnalytics,
} from "../cli/lib/backtest-analytics.js";

const trades = [
  { r: 4, grade: "A+", model: "x", side: "long", outcome: "tp2_hit" },
  { r: -1, grade: "B", model: "x", side: "long", outcome: "stop_hit" },
  { r: 4, grade: "A+", model: "y", side: "short", outcome: "tp1_hit" },
];

test("aggregate computes cumR, expectancy, payoff, win-rate", () => {
  const a = aggregate(trades);
  assert.equal(a.n, 3);
  assert.equal(a.cumR, 7);
  assert.equal(a.winRate, 67);
  assert.equal(a.avgWin, 4);
  assert.equal(a.avgLoss, -1);
  assert.equal(a.expectancy, 2.33);
  assert.equal(a.payoff, 4);
});

test("aggregate produces an equity curve + max drawdown", () => {
  const a = aggregate(trades);
  assert.deepEqual(a.equity, [4, 3, 7]);
  assert.equal(a.maxDD, -1);
});

test("empty input is safe", () => {
  const a = aggregate([]);
  assert.equal(a.n, 0); assert.equal(a.cumR, 0); assert.equal(a.winRate, 0);
});

test("byCut groups + aggregates per key", () => {
  const cuts = byCut(trades, (t) => t.grade);
  const aplus = cuts.find((c) => c.key === "A+");
  assert.equal(aplus.n, 2); assert.equal(aplus.cumR, 8); assert.equal(aplus.winRate, 100);
});

test("outcomeBreakdown counts + sums R per outcome", () => {
  const o = outcomeBreakdown(trades);
  assert.equal(o.tp2_hit.n, 1); assert.equal(o.tp2_hit.r, 4);
  assert.equal(o.stop_hit.r, -1);
});

// ── computeTradeR — code-computed per-trade R from levels + outcome ──────
test("computeTradeR books tp1 at its actual multiple", () => {
  // real run: |29391.5-29496.75| / |29496.75-29542.75| = 105.25/46 = 2.29
  assert.equal(
    computeTradeR({ entry: 29496.75, stop: 29542.75, tp1: 29391.5, outcome: "tp1_hit" }),
    2.29,
  );
});

test("computeTradeR books tp2 at its actual multiple", () => {
  assert.equal(computeTradeR({ entry: 100, stop: 90, tp2: 130, outcome: "tp2_hit" }), 3);
});

test("computeTradeR books a stop at -1R and a break-even at 0", () => {
  assert.equal(computeTradeR({ entry: 100, stop: 90, outcome: "stop_hit" }), -1);
  assert.equal(computeTradeR({ entry: 100, stop: 90, outcome: "closed_be" }), 0);
  assert.equal(computeTradeR({ entry: 100, stop: 90, outcome: "be" }), 0);
});

test("computeTradeR falls back to the grader's realized_r for a 16:00 close", () => {
  assert.equal(
    computeTradeR({ entry: 100, stop: 90, outcome: "closed_1600", realized_r: 0.5 }),
    0.5,
  );
});

test("computeTradeR guards zero-risk", () => {
  assert.equal(computeTradeR({ entry: 100, stop: 100, tp1: 120, outcome: "tp1_hit" }), 0);
});

// ── tradesFromSetups — pair open + outcome rows from one run's jsonl ─────
const sampleSetups = [
  { type: "open", id: "a", grade: "A+", model: "MSS", side: "long", entry: 100, stop: 90, tp1: 120, tp2: 140, event_ts: "2026-05-21T13:35:00.000Z" },
  { type: "outcome", setup_id: "a", outcome: "tp1_hit", exit: 120, realized_r: 2 },
  { type: "open", id: "b", grade: "B", model: "Trend", side: "short", entry: 200, stop: 210, tp1: 180, tp2: 170, event_ts: "2026-05-21T13:50:00.000Z" },
  { type: "outcome", setup_id: "b", outcome: "stop_hit", exit: 210, realized_r: -1 },
  { type: "skipped_active_trade", setup_id: "z" },
  { type: "open", id: "d", grade: "B", model: "Inversion", side: "short", entry: 80, stop: 85, tp1: 70 }, // no outcome → dropped
];

test("tradesFromSetups pairs open+outcome and computes R, dropping unresolved opens", () => {
  const t = tradesFromSetups(sampleSetups);
  assert.equal(t.length, 2);
  const a = t.find((x) => x.outcome === "tp1_hit");
  assert.equal(a.r, 2); assert.equal(a.grade, "A+"); assert.equal(a.model, "MSS");
  assert.equal(a.side, "long"); assert.equal(a.entry_ts, "2026-05-21T13:35:00.000Z");
  const b = t.find((x) => x.outcome === "stop_hit");
  assert.equal(b.r, -1);
});

test("tradesFromSetups is safe on empty/garbage", () => {
  assert.deepEqual(tradesFromSetups([]), []);
  assert.deepEqual(tradesFromSetups(), []);
});

// ── buildAnalytics — full `A` shape for the dashboard ───────────────────
const runDetails = [
  {
    entry: { run_id: "r1", date: "2026-05-21", session: "ny-am" },
    setups: [
      { type: "open", id: "a", grade: "A+", model: "MSS", side: "long", entry: 100, stop: 90, tp1: 120, tp2: 140, event_ts: "2026-05-21T13:35:00.000Z" },
      { type: "outcome", setup_id: "a", outcome: "tp1_hit", exit: 120 },
      { type: "open", id: "b", grade: "B", model: "Trend", side: "short", entry: 200, stop: 210, tp1: 180, tp2: 170, event_ts: "2026-05-21T13:50:00.000Z" },
      { type: "outcome", setup_id: "b", outcome: "stop_hit", exit: 210 },
    ],
  },
  {
    entry: { run_id: "r2", date: "2026-05-20", session: "london" },
    setups: [
      { type: "open", id: "c", grade: "A+", model: "MSS", side: "long", entry: 50, stop: 45, tp1: 60, tp2: 70, event_ts: "2026-05-21T08:35:00.000Z" },
      { type: "outcome", setup_id: "c", outcome: "tp2_hit", exit: 70 },
    ],
  },
];

test("buildAnalytics aggregates real per-trade R across runs", () => {
  const A = buildAnalytics(runDetails);
  assert.equal(A.n_trades, 3);
  assert.equal(A.n_sessions, 2);
  assert.equal(A.cum_r, 5);
  assert.equal(A.win_n, 2);
  assert.equal(A.loss_n, 1);
  assert.equal(A.be_n, 0);
  assert.equal(A.win_pct, 67);
  assert.equal(A.avg_win, 3);
  assert.equal(A.avg_loss, -1);
  assert.equal(A.payoff, 3);
  assert.equal(A.expectancy, 1.67);
  assert.equal(A.largest_win_r, 4);
  assert.equal(A.max_drawdown_r, -1);
  assert.deepEqual(A.equity, [2, 1, 5]);
});

test("buildAnalytics cuts by grade and model, sorted by expectancy", () => {
  const A = buildAnalytics(runDetails);
  assert.deepEqual(A.by_grade.map((r) => r.k), ["A+", "B"]);
  assert.equal(A.by_grade[0].exp, 3); assert.equal(A.by_grade[0].win, 100); assert.equal(A.by_grade[0].n, 2);
  assert.deepEqual(A.by_model.map((r) => r.k), ["MSS", "Trend"]);
});

test("buildAnalytics omits by_bias (untracked), never fabricates it", () => {
  const A = buildAnalytics(runDetails);
  assert.equal(A.by_bias, undefined);
});

test("buildAnalytics builds session concentration sorted by R", () => {
  const A = buildAnalytics(runDetails);
  assert.deepEqual(A.sessions.map((s) => s.k), ["LONDON", "NY-AM"]);
  assert.equal(A.sessions[0].r, 4); assert.equal(A.sessions[0].n, 1);
  assert.equal(A.sessions[1].r, 1); assert.equal(A.sessions[1].n, 2);
  assert.equal(A.best_session_r, 4);
  assert.equal(A.worst_session_r, 1);
});

test("buildAnalytics builds an outcome breakdown with tones", () => {
  const A = buildAnalytics(runDetails);
  const byK = Object.fromEntries(A.outcomes.map((o) => [o.k, o]));
  assert.equal(byK["TP1 HIT"].n, 1); assert.equal(byK["TP1 HIT"].tone, "green");
  assert.equal(byK["TP2 HIT"].n, 1);
  assert.equal(byK["STOP"].n, 1); assert.equal(byK["STOP"].tone, "red");
});

test("buildAnalytics buckets entry time in ET", () => {
  const A = buildAnalytics(runDetails);
  const keys = A.by_time.map((r) => r.k);
  assert.ok(keys.includes("09:30–10:00")); // 13:35Z + 13:50Z → 09:35/09:50 EDT
  assert.ok(keys.includes("04:30–05:00")); // 08:35Z → 04:35 EDT
});

test("buildAnalytics is safe with no runs", () => {
  const A = buildAnalytics([]);
  assert.equal(A.n_trades, 0);
  assert.equal(A.cum_r, 0);
  assert.deepEqual(A.by_grade, []);
  assert.deepEqual(A.sessions, []);
  assert.deepEqual(A.equity, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, byCut, outcomeBreakdown } from "../cli/lib/backtest-analytics.js";

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

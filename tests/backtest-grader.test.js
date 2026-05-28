// tests/backtest-grader.test.js
// Pure-function tests for the outcome grader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";

test("long: bar.low <= stop → stop_hit", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29110, low: 29045 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "stop_hit", exit: 29050, conflict_bar: false,
  });
});

test("long: bar.high >= tp1 → tp1_hit", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29160, low: 29070 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "tp1_hit", exit: 29150, conflict_bar: false,
  });
});

test("long: bar straddles both → stop_hit + conflict_bar:true (conservative)", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29160, low: 29045 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "stop_hit", exit: 29050, conflict_bar: true,
  });
});

test("short: bar.high >= stop → stop_hit", () => {
  const trade = { side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const bar = { high: 29110, low: 29070 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "stop_hit", exit: 29105, conflict_bar: false,
  });
});

test("short: bar.low <= tp1 → tp1_hit", () => {
  const trade = { side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const bar = { high: 29090, low: 29045 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "tp1_hit", exit: 29050, conflict_bar: false,
  });
});

test("short: straddles → stop_hit + conflict (conservative)", () => {
  const trade = { side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const bar = { high: 29110, low: 29045 };
  assert.deepEqual(gradeOpenTrade(trade, bar), {
    outcome: "stop_hit", exit: 29105, conflict_bar: true,
  });
});

test("bar inside levels → pending", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29100, low: 29070 };
  assert.deepEqual(gradeOpenTrade(trade, bar), { outcome: "pending" });
});

test("invalid side throws", () => {
  assert.throws(() => gradeOpenTrade({ side: "wrong", entry: 1, stop: 1, tp1: 1 }, { high: 1, low: 1 }));
});

test("long: exact-touch on stop counts as hit", () => {
  // bar.low === stop: this is a stop touch. Conservative interpretation: hit.
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29150 };
  const bar = { high: 29100, low: 29050 };
  assert.equal(gradeOpenTrade(trade, bar).outcome, "stop_hit");
});

test("short: exact-touch on tp1 counts as hit", () => {
  const trade = { side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const bar = { high: 29090, low: 29050 };
  assert.equal(gradeOpenTrade(trade, bar).outcome, "tp1_hit");
});

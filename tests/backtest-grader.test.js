// tests/backtest-grader.test.js
// Pure-function tests for the outcome grader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeOpenTrade, closeAtMarket, gradeRunner } from "../app/main/backtest-grader.js";

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

// closeAtMarket — the 4:00 PM forced close (user ruling 2026-06-13).
test("closeAtMarket long in profit → signed positive R at the close", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29200 }; // risk 30
  const out = closeAtMarket(trade, { close: 29125 });                    // +45 = +1.5R
  assert.equal(out.outcome, "closed_1600");
  assert.equal(out.exit, 29125);
  assert.equal(out.realized_r, 1.5);
});

test("closeAtMarket long underwater → signed negative R (but not a full -1R stop)", () => {
  const trade = { side: "long", entry: 29080, stop: 29050, tp1: 29200 }; // risk 30
  const out = closeAtMarket(trade, { close: 29065 });                    // -15 = -0.5R
  assert.equal(out.realized_r, -0.5);
});

test("closeAtMarket short in profit → signed positive R at the close", () => {
  const trade = { side: "short", entry: 29080, stop: 29110, tp1: 28960 }; // risk 30
  const out = closeAtMarket(trade, { close: 29030 });                     // entry-exit=50 = +1.67R
  assert.equal(out.realized_r, 1.67);
});

test("closeAtMarket zero risk → 0R, never NaN", () => {
  const out = closeAtMarket({ side: "long", entry: 29080, stop: 29080, tp1: 29200 }, { close: 29200 });
  assert.equal(out.realized_r, 0);
});

// gradeRunner — the A+ post-TP1 runner phase (user ruling 2026-06-13).
test("gradeRunner short: hits TP2 → win, R off the original risk", () => {
  const t = { side: "short", entry: 29664, orig_stop: 29713.75, stop: 29664, tp2: 29302.5 }; // risk 49.75
  const out = gradeRunner(t, { high: 29650, low: 29300 });
  assert.equal(out.outcome, "tp2_hit");
  assert.equal(out.exit, 29302.5);
  assert.equal(out.realized_r, 7.27); // (29664-29302.5)/49.75
});

test("gradeRunner short: back to entry → break-even scratch (0R)", () => {
  const t = { side: "short", entry: 29664, orig_stop: 29713.75, stop: 29664, tp2: 29302.5 };
  const out = gradeRunner(t, { high: 29670, low: 29600 });
  assert.equal(out.outcome, "closed_be");
  assert.equal(out.realized_r, 0);
});

test("gradeRunner long: hits TP2 → win", () => {
  const t = { side: "long", entry: 100, orig_stop: 95, stop: 100, tp2: 130 }; // risk 5
  const out = gradeRunner(t, { high: 131, low: 101 });
  assert.equal(out.outcome, "tp2_hit");
  assert.equal(out.realized_r, 6);
});

test("gradeRunner: conflict bar (entry AND tp2) → break-even first (conservative)", () => {
  const t = { side: "short", entry: 29664, orig_stop: 29713.75, stop: 29664, tp2: 29302.5 };
  const out = gradeRunner(t, { high: 29700, low: 29300 });
  assert.equal(out.outcome, "closed_be");
  assert.equal(out.conflict_bar, true);
});

test("gradeRunner: neither hit → pending", () => {
  const t = { side: "short", entry: 29664, orig_stop: 29713.75, stop: 29664, tp2: 29302.5 };
  assert.equal(gradeRunner(t, { high: 29650, low: 29400 }).outcome, "pending");
});

test("closeAtMarket uses orig_stop for a runner (live stop sits at BE)", () => {
  const t = { side: "short", entry: 29664, orig_stop: 29713.75, stop: 29664 };
  const out = closeAtMarket(t, { close: 29500 }); // (29664-29500)/49.75 = 3.30
  assert.equal(out.realized_r, 3.3);
});

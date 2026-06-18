// tests/smt-leader.test.js — pure SMT relative-strength leader selection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSmtLeader, SMT_GAP_BAND } from "../cli/lib/smt-leader.js";

// Minimal engine builder. levels: [{name,price,swept}], swings: [{price,is_high,tier,bar_ms}].
const WS = 1000, WE = 2000, IN = 1500;       // window bounds + an in-window bar_ms
function eng({ levels = [], swings = [], atr = 20 }) {
  return { levels, swings, quality: { atr_14: String(atr) } };
}
// A symbol that put in a confirmed swing HIGH at `high` reacting to overnight high `ref`.
function highSym({ ref, high, atr }) {
  return eng({
    levels: [{ name: "AS.H", price: ref, swept: high > ref }],
    swings: [{ price: high, is_high: true, tier: "swing", bar_ms: IN }],
    atr,
  });
}
// A symbol that put in a confirmed swing LOW at `low` reacting to overnight low `ref`.
function lowSym({ ref, low, atr }) {
  return eng({
    levels: [{ name: "AS.L", price: ref, swept: low < ref }],
    swings: [{ price: low, is_high: false, tier: "swing", bar_ms: IN }],
    atr,
  });
}
const win = { windowStartMs: WS, windowEndMs: WE };

test("bearish SMT: one takes its high, the other fails → short the laggard", () => {
  // MNQ +0.70 ATR over AS.H; MES -0.42 under AS.H → gap 1.12, short MES.
  const r = computeSmtLeader({
    primary: "MNQ1!", secondary: "MES1!",
    primaryEngine: highSym({ ref: 30615, high: 30650, atr: 50 }),
    secondaryEngine: highSym({ ref: 7565, high: 7560, atr: 12 }),
    context: "short", ...win,
  });
  assert.equal(r.divergence, true);
  assert.equal(r.bias_dir, "short");
  assert.equal(r.leader, "MES1!");
  assert.equal(r.done, true);
  assert.equal(r.reason, "smt_divergence");
  assert.ok(r.gap >= SMT_GAP_BAND);
});

test("bullish SMT mirror: one sweeps the low, the other holds → long the leader", () => {
  // MNQ -1.0 (broke below AS.L), MES +0.17 (held) → long MES (stronger).
  const r = computeSmtLeader({
    primary: "MNQ1!", secondary: "MES1!",
    primaryEngine: lowSym({ ref: 30000, low: 29950, atr: 50 }),
    secondaryEngine: lowSym({ ref: 7400, low: 7402, atr: 12 }),
    context: "long", ...win,
  });
  assert.equal(r.divergence, true);
  assert.equal(r.bias_dir, "long");
  assert.equal(r.leader, "MES1!");
  assert.equal(r.done, true);
});

test("both crossed but one clearly stronger → still short the weaker (graded gap)", () => {
  const r = computeSmtLeader({
    primary: "MNQ1!", secondary: "MES1!",
    primaryEngine: highSym({ ref: 30600, high: 30700, atr: 50 }),  // +2.0
    secondaryEngine: highSym({ ref: 7560, high: 7566, atr: 12 }),  // +0.5
    context: "short", ...win,
  });
  assert.equal(r.divergence, true);
  assert.equal(r.leader, "MES1!");            // weaker of the two
});

test("both crossed, near-tie → no divergence, MNQ left to the caller", () => {
  const r = computeSmtLeader({
    primary: "MNQ1!", secondary: "MES1!",
    primaryEngine: highSym({ ref: 30600, high: 30625, atr: 50 }),  // +0.50
    secondaryEngine: highSym({ ref: 7560, high: 7582.6, atr: 50 }),// +0.452
    context: "short", ...win,
  });
  assert.equal(r.divergence, false);
  assert.equal(r.leader, null);
  assert.equal(r.reason, "no_divergence_measured");
  assert.equal(r.criteria.data_present, true);
  assert.equal(r.criteria.pivots_confirmed, true);
  assert.equal(r.criteria.gap_cleared, false);
});

test("ATR normalization: same raw-point gap diverges at MES scale but not MNQ scale", () => {
  const mkPair = (atr) => computeSmtLeader({
    primary: "A", secondary: "B",
    primaryEngine: highSym({ ref: 100, high: 105, atr }),   // +5 pts
    secondaryEngine: highSym({ ref: 100, high: 95, atr }),  // -5 pts
    context: "short", ...win,
  });
  assert.equal(mkPair(12).divergence, true);    // 10/12 = 0.83 ATR gap → diverges
  assert.equal(mkPair(50).divergence, false);   // 10/50 = 0.20 ATR gap → near-tie
});

test("secondary engine missing → unreadable, never a leader", () => {
  const r = computeSmtLeader({
    primary: "MNQ1!", secondary: "MES1!",
    primaryEngine: highSym({ ref: 30615, high: 30650, atr: 50 }),
    secondaryEngine: null,
    context: "short", ...win,
  });
  assert.equal(r.reason, "smt_unreadable_data");
  assert.equal(r.criteria.data_present, false);
  assert.equal(r.done, false);
  assert.equal(r.leader, null);
});

test("no confirmed pivot in window → not done, unreadable", () => {
  const noPivot = eng({ levels: [{ name: "AS.H", price: 30615, swept: false }], swings: [], atr: 50 });
  const r = computeSmtLeader({
    primary: "MNQ1!", secondary: "MES1!",
    primaryEngine: noPivot,
    secondaryEngine: highSym({ ref: 7565, high: 7560, atr: 12 }),
    context: "short", ...win,
  });
  assert.equal(r.criteria.pivots_confirmed, false);
  assert.equal(r.done, false);
  assert.equal(r.reason, "smt_unreadable_data");
});

test("auto context picks the reacted side (highs present, no lows → short)", () => {
  const r = computeSmtLeader({
    primary: "MNQ1!", secondary: "MES1!",
    primaryEngine: highSym({ ref: 30615, high: 30650, atr: 50 }),
    secondaryEngine: highSym({ ref: 7565, high: 7560, atr: 12 }),
    context: "auto", ...win,
  });
  assert.equal(r.bias_dir, "short");
  assert.equal(r.leader, "MES1!");
});

test("evidence carries citeable engine paths + the numbers", () => {
  const r = computeSmtLeader({
    primary: "MNQ1!", secondary: "MES1!",
    primaryEngine: highSym({ ref: 30615, high: 30650, atr: 50 }),
    secondaryEngine: highSym({ ref: 7565, high: 7560, atr: 12 }),
    context: "short", ...win,
  });
  const ev = r.evidence["MNQ1!"];
  assert.ok(/engine\.levels\[\d+\]/.test(ev.reference_cite));
  assert.ok(/engine\.swings\[\d+\]/.test(ev.pivot_cite));
  assert.equal(ev.atr_cite, "engine.quality.atr_14");
  assert.equal(ev.reference, 30615);
  assert.equal(ev.window_extreme, 30650);
  assert.equal(typeof ev.strength, "number");
});

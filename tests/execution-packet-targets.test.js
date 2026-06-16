import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "../app/main/strategy/walkers/execution-packet.js";
const { selectTp1, selectTp2, nearestIntradayTarget } = __test;

const ctx = (over = {}) => ({
  market: "MNQ1!",
  pillar1: { untakenTargets: { above: [], below: [] } },
  pillar3: { structuralStops: [] },
  ...over,
});

test("TP2 = real terminal draw, NOT a nearer session draw (June-9 trend-runner fix)", () => {
  // Short. Beyond TP1 (29302.5) sits the real engine level PDL 28821 AND a
  // nearer stale session draw 29113.75. The runner must aim at PDL, never the
  // session draw that would chop it short (corpus −16R fix).
  const c = ctx({
    pillar1: { untakenTargets: { above: [], below: [
      { price: 28821, name: "PDL" },                              // real level (far)
      { price: 29113.75, name: "AS.L", source: "session_draw" },  // stale draw (nearer)
    ] } },
  });
  const tp2 = selectTp2(c, "short", 29467.25, 29526, { price: 29302.5 });
  assert.equal(tp2.price, 28821);
});

test("persistent session draw becomes TP2 behind a nearer intraday swing TP1 (long)", () => {
  // Session-history draws ride in untakenTargets tagged source:'session_draw'
  // → runner class. A nearer 1m swing takes TP1; the draw runs to TP2.
  const c = ctx({
    pillar3: { structuralStops: [{ kind: "swing_high", price: 30800, swept: false }] },
    pillar1: {
      untakenTargets: { above: [{ price: 30896, name: "NYPM.H", source: "session_draw" }], below: [] },
    },
  });
  const tp1 = selectTp1(c, "long", 30727.75, 30688.75); // risk 39
  const tp2 = selectTp2(c, "long", 30727.75, 30688.75, tp1);
  assert.equal(tp1.price, 30800); // nearest intraday liquidity
  assert.equal(tp2.price, 30896); // session draw beyond it (the runner)
  assert.ok(tp2.price > tp1.price);
});

test("a recent session LEVEL (not a session_draw) stays TP1-eligible", () => {
  // The brief's recent session levels are plain 'level' class — a 1.5–2R swing
  // yields to them (unchanged behavior). entry 30700, stop 30680 (risk 20).
  const c = ctx({
    pillar3: { structuralStops: [{ kind: "swing_high", price: 30730, swept: false }] }, // 1.5R swing
    pillar1: { untakenTargets: { above: [{ price: 30740, name: "AS.H" }], below: [] } }, // level, 2R
  });
  const tp1 = selectTp1(c, "long", 30700, 30680);
  assert.equal(tp1.price, 30740); // the qualifying level wins over the sub-2R swing
});

test("session draw is the only nearby draw → it takes TP1 when nothing closer", () => {
  const c = ctx({
    pillar1: { untakenTargets: { above: [{ price: 30896, name: "NYPM.H", source: "session_draw" }], below: [] } },
  });
  const tp1 = selectTp1(c, "long", 30727.75, 30688.75); // no intraday swing
  assert.equal(tp1.price, 30896); // the draw clears the floor and is all we have
});

test("intraday swing is NOT reached past a nearer sub-1.5R level (June-11 PM chop guard)", () => {
  // entry 29183.5, stop 29117.25 (risk 66.25). The nearest target PDH 29251 is
  // a LEVEL at only 1.02R; a farther 1m swing 29302 clears the floor (1.79R).
  // The fallback must NOT skip the nearer level to reach the farther swing —
  // that surfaced two stop-out re-entries into the June-11 PM chop. It returns
  // PDH so the packet reports tp1_below_1_5r and blocks.
  const c = ctx({
    pillar3: { structuralStops: [{ kind: "swing_high", price: 29302, swept: false }] },
    pillar1: { untakenTargets: { above: [{ price: 29251, name: "PDH" }], below: [] } },
  });
  const tp1 = selectTp1(c, "long", 29183.5, 29117.25);
  assert.equal(tp1.price, 29251);
  assert.ok(tp1.rMultiple < 1.5);
});

test("a farther session draw IS reached past a nearer sub-1.5R swing (runner logic kept)", () => {
  // entry 30789.25, stop 30765 (risk 24.25). The nearest 30800 swing is only
  // 0.44R; the 30896 session draw (htf class) clears the floor at 4.40R. Reaching
  // past a too-close target to the HTF/session draw IS allowed — the model's
  // purpose (June 15). Only farther INTRADAY swings are off-limits.
  const c = ctx({
    pillar3: { structuralStops: [{ kind: "swing_high", price: 30800, swept: false }] },
    pillar1: { untakenTargets: { above: [{ price: 30896, name: "NYPM.H", source: "session_draw" }], below: [] } },
  });
  const tp1 = selectTp1(c, "long", 30789.25, 30765);
  assert.equal(tp1.price, 30896);
});

test("nearestIntradayTarget: the first intraday objective, never the session draw (green-light ref)", () => {
  // entry 30718.5, stop 30670.25 (risk 48.25). The 30800 swing clears 1.5R
  // (1.69R); the 30896 session draw is farther and is HTF class. The green-light
  // reference must be the intraday objective (30800), not the draw.
  const c = ctx({
    pillar3: { structuralStops: [{ kind: "swing_high", price: 30800, swept: false }] },
    pillar1: { untakenTargets: { above: [{ price: 30896, name: "NYPM.H", source: "session_draw" }], below: [] } },
  });
  const ref = nearestIntradayTarget(c, "long", 30718.5, 30670.25);
  assert.equal(ref.price, 30800);
});

test("nearestIntradayTarget: null when the only overhead draw is a session draw", () => {
  // No intraday swing, no plain level — just the session draw. No intraday
  // objective → null (the backtest green-light then falls back to TP1).
  const c = ctx({
    pillar1: { untakenTargets: { above: [{ price: 30896, name: "NYPM.H", source: "session_draw" }], below: [] } },
  });
  assert.equal(nearestIntradayTarget(c, "long", 30727.75, 30688.75), null);
});

test("psych fallback when the overhead pool is empty (MNQ 50 → TP1, 100 → TP2)", () => {
  const c = ctx({}); // no intraday, no levels, no draws
  const tp1 = selectTp1(c, "long", 31090, 31070); // risk 20; 31100 is only 0.5R, skip it
  const tp2 = selectTp2(c, "long", 31090, 31070, tp1);
  assert.equal(tp1.price, 31150); // nearest grid level clearing 1.5R (minor)
  assert.equal(tp2.price % 100, 0); // a major level
  assert.ok(tp2.price > tp1.price);
});

test("nothing clears the floor → nearest returned (so tp1_below_1_5r can fire, not missing_tp1)", () => {
  const c = ctx({
    pillar1: { untakenTargets: { above: [{ price: 30705, name: "PDH" }], below: [] } },
  });
  const tp1 = selectTp1(c, "long", 30700, 30680); // 30705 is 0.25R — below floor, but it's all we have
  assert.equal(tp1.price, 30705);
  assert.ok(tp1.rMultiple < 1.5);
});

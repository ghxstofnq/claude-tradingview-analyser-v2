import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "../app/main/strategy/walkers/execution-packet.js";
const { selectTp1, selectTp2 } = __test;

const ctx = (over = {}) => ({
  market: "MNQ1!",
  pillar1: { untakenTargets: { above: [], below: [] } },
  pillar3: { structuralStops: [] },
  ...over,
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

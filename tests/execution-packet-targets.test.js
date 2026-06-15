import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "../app/main/strategy/walkers/execution-packet.js";
const { selectTp1, selectTp2 } = __test;

const ctx = (over = {}) => ({
  market: "MNQ1!",
  pillar1: { untakenTargets: { above: [], below: [] }, htfTargets: { above: [], below: [] } },
  pillar3: { structuralStops: [] },
  ...over,
});

test("HTF 4H swing becomes TP2 behind a nearer intraday swing TP1 (long)", () => {
  const c = ctx({
    pillar3: { structuralStops: [{ kind: "swing_high", price: 30800, swept: false }] },
    pillar1: {
      untakenTargets: { above: [], below: [] },
      htfTargets: { above: [{ price: 30896, source: "htf_swing", tf: "h4" }], below: [] },
    },
  });
  const tp1 = selectTp1(c, "long", 30727.75, 30688.75); // risk 39
  const tp2 = selectTp2(c, "long", 30727.75, 30688.75, tp1);
  assert.equal(tp1.price, 30800);   // nearest intraday liquidity
  assert.equal(tp2.price, 30896);   // HTF draw beyond it
  assert.ok(tp2.price > tp1.price);
});

test("opposing FVG (only nearby draw): near edge = TP1, far edge = TP2 off one gap", () => {
  const fvg = (top, bottom, ce, edge, price) => ({ price, source: "fvg_fill", edge, zone: `${bottom}-${top}` });
  const c = ctx({
    pillar1: {
      untakenTargets: { above: [], below: [] },
      htfTargets: {
        above: [fvg(31000, 30900, 30950, "near", 30900), fvg(31000, 30900, 30950, "ce", 30950), fvg(31000, 30900, 30950, "far", 31000)],
        below: [],
      },
    },
  });
  const tp1 = selectTp1(c, "long", 30700, 30680); // risk 20; near edge R10 clears the floor
  const tp2 = selectTp2(c, "long", 30700, 30680, tp1);
  assert.equal(tp1.price, 30900); // near edge (shallowest clearing the floor when far)
  assert.equal(tp2.price, 31000); // same gap's far edge (full fill)
});

test("FVG edge escalates when price is close: near edge sub-1.5R → TP1 steps to CE", () => {
  const fvg = (edge, price) => ({ price, source: "fvg_fill", edge, zone: "30900-31000" });
  const c = ctx({
    pillar1: {
      untakenTargets: { above: [], below: [] },
      htfTargets: { above: [fvg("near", 30900), fvg("ce", 30950), fvg("far", 31000)], below: [] },
    },
  });
  // entry just below the gap → near edge (30900) is only 0.5R; must step deeper.
  const tp1 = selectTp1(c, "long", 30890, 30870); // risk 20
  const tp2 = selectTp2(c, "long", 30890, 30870, tp1);
  assert.equal(tp1.price, 30950); // CE — nearest edge clearing 1.5R
  assert.equal(tp2.price, 31000); // far edge runner
});

test("psych fallback when the overhead pool is empty (MNQ 50 → TP1, 100 → TP2)", () => {
  const c = ctx({}); // no intraday, no htf, no levels
  const tp1 = selectTp1(c, "long", 31090, 31070); // risk 20; 31100 is only 0.5R, skip it
  const tp2 = selectTp2(c, "long", 31090, 31070, tp1);
  assert.equal(tp1.price, 31150); // nearest grid level clearing 1.5R (minor)
  assert.equal(tp2.price % 100, 0); // a major level
  assert.ok(tp2.price > tp1.price);
});

test("nothing clears the floor → nearest returned (so tp1_below_1_5r can fire, not missing_tp1)", () => {
  const c = ctx({
    pillar1: { untakenTargets: { above: [{ price: 30705, name: "PDH" }], below: [] }, htfTargets: { above: [], below: [] } },
  });
  const tp1 = selectTp1(c, "long", 30700, 30680); // 30705 is 0.25R — below floor, but it's all we have
  assert.equal(tp1.price, 30705);
  assert.ok(tp1.rMultiple < 1.5);
});

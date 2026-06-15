import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHtfTargets, fvgEdges } from "../app/main/strategy/walkers/htf-targets.js";

test("fvgEdges — bearish FVG above expands to near/CE/far (ascending for a long approach) with a zone id", () => {
  const e = fvgEdges({ top: 31000, bottom: 30900, ce: 30950, dir: "bear" }, "above");
  assert.deepEqual(e.map((x) => [x.edge, x.price]), [["near", 30900], ["ce", 30950], ["far", 31000]]);
  assert.equal(e[0].source, "fvg_fill");
  assert.ok(e.every((x) => x.zone === "30900-31000")); // same gap linkable
});

test("fvgEdges — bullish FVG below expands near=top / far=bottom (short approach, descending)", () => {
  const e = fvgEdges({ top: 30600, bottom: 30500, ce: 30550, dir: "bull" }, "below");
  assert.deepEqual(e.map((x) => [x.edge, x.price]), [["near", 30600], ["ce", 30550], ["far", 30500]]);
});

test("extractHtfTargets — HTF swing highs (unswept) + fresh bearish FVG fills above price", () => {
  const engineByTf = {
    h4: {
      swings: [
        { price: 30896, is_high: true, swept: false, kind: "HH" },
        { price: 30700, is_high: true, swept: true, kind: "LH" },   // swept → excluded
        { price: 30500, is_high: false, swept: false, kind: "HL" }, // a low → goes below
      ],
      fvgs: [
        { top: 31000, bottom: 30900, ce: 30950, dir: "bear", state: "fresh" },        // opposing for a long ✓
        { top: 30980, bottom: 30880, ce: 30930, dir: "bear", state: "invalidated" },  // not fresh → excluded
        { top: 30600, bottom: 30550, ce: 30575, dir: "bull", state: "fresh" },        // same-dir → not an above target
      ],
    },
    h1: { swings: [], fvgs: [] },
  };
  const { above, below } = extractHtfTargets(engineByTf, { price: 30750 });
  const ap = above.map((t) => t.price).sort((a, b) => a - b);
  assert.ok(ap.includes(30896));                                   // unswept 4H swing high
  assert.ok(ap.includes(30900) && ap.includes(30950) && ap.includes(31000)); // fresh bearish FVG edges
  assert.ok(!ap.includes(30700));                                 // swept swing excluded
  assert.ok(!ap.includes(30880));                                 // invalidated FVG excluded
  assert.ok(below.some((t) => t.price === 30500));               // 4H swing low below
});

test("filled / inverted FVG excluded; only fresh counts", () => {
  for (const state of ["filled", "inverted", "invalidated"]) {
    const eByTf = { h4: { swings: [], fvgs: [{ top: 31000, bottom: 30900, ce: 30950, dir: "bear", state }] }, h1: {} };
    assert.equal(extractHtfTargets(eByTf, { price: 30750 }).above.length, 0, `state=${state} should be excluded`);
  }
});

test("missing engine_by_tf / price → empty", () => {
  assert.deepEqual(extractHtfTargets(undefined, { price: 100 }), { above: [], below: [] });
  assert.deepEqual(extractHtfTargets({ h4: {} }, {}), { above: [], below: [] });
});

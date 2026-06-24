import { test } from "node:test";
import assert from "node:assert/strict";
import { isSignificantArray } from "../cli/lib/lanto-significance.js";

// Rubric §6 (lanto-prep-rubric.md): an array may anchor the draw or a vote only
// if it is displacive AND took liquidity AND near price AND not a `tiny` zone —
// unless it is exceptionally displacive AND took MAJOR liquidity.
// price 100, atr 10 → NEAR window is |distance| <= 2*atr = 20.
const OPTS = { price: 100, atr: 10 };
const base = { size_quality: "normal", disp_score: 0.6, took_liq: true, distance_to_ce: 5 };

test("normal displacive + took-liq + near → significant", () => {
  const r = isSignificantArray({ ...base }, OPTS);
  assert.equal(r.significant, true, JSON.stringify(r.reasons));
});

test("tiny zone → not significant", () => {
  const r = isSignificantArray({ ...base, size_quality: "tiny" }, OPTS);
  assert.equal(r.significant, false);
  assert.ok(r.reasons.includes("tiny"), JSON.stringify(r.reasons));
});

test("far from price → not significant", () => {
  const r = isSignificantArray({ ...base, distance_to_ce: 50 }, OPTS);
  assert.equal(r.significant, false);
  assert.ok(r.reasons.includes("far"), JSON.stringify(r.reasons));
});

test("weak displacement → not significant", () => {
  const r = isSignificantArray({ ...base, disp_score: 0.3 }, OPTS);
  assert.equal(r.significant, false);
  assert.ok(r.reasons.includes("weak_displacement"), JSON.stringify(r.reasons));
});

test("did not take liquidity → not significant", () => {
  const r = isSignificantArray({ ...base, took_liq: false }, OPTS);
  assert.equal(r.significant, false);
  assert.ok(r.reasons.includes("no_liquidity"), JSON.stringify(r.reasons));
});

test("exceptional tiny: very-high disp + took MAJOR liquidity → significant", () => {
  const r = isSignificantArray(
    { ...base, size_quality: "tiny", disp_score: 0.9, took_major_liq: true },
    OPTS,
  );
  assert.equal(r.significant, true, JSON.stringify(r.reasons));
});

test("tiny + very-high disp but NOT major liquidity → not significant", () => {
  const r = isSignificantArray(
    { ...base, size_quality: "tiny", disp_score: 0.9, took_major_liq: false },
    OPTS,
  );
  assert.equal(r.significant, false);
  assert.ok(r.reasons.includes("tiny"), JSON.stringify(r.reasons));
});

test("computes distance from ce when distance_to_ce is absent", () => {
  // ce 130, price 100, atr 10 → distance 30 > 20 → far
  const r = isSignificantArray({ size_quality: "normal", disp_score: 0.6, took_liq: true, ce: 130 }, OPTS);
  assert.equal(r.significant, false);
  assert.ok(r.reasons.includes("far"), JSON.stringify(r.reasons));
});

test("unreadable atr → fail-open near check (does not falsely reject)", () => {
  const r = isSignificantArray({ ...base, distance_to_ce: 9999 }, { price: 100, atr: 0 });
  // with atr 0 the near window is unusable; must not crash and must not reject on `far`
  assert.ok(!r.reasons.includes("far"), JSON.stringify(r.reasons));
});

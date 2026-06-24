import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDraw } from "../cli/lib/lanto-draw.js";

// Rubric §5 + §7: the draw is the nearest SIGNIFICANT, UNTAKEN, CITED liquidity
// target (level or array) in the bias direction. No resolvable cite → ineligible.
// price 100, atr 10 → near window 2*atr = 20.
const OPTS = { price: 100, atr: 10, direction: "bull" };
const level = (name, price, cite) => ({ kind: "level", name, price, cite });
const arr = (price, cite, over = {}) => ({
  kind: "array", name: "FVG", price, cite, dir: "bull",
  disp_score: 0.7, took_liq: true, size_quality: "normal", distance_to_ce: price - 100, ...over,
});

test("picks the nearest cited significant level in the bias direction", () => {
  const d = selectDraw([level("NYAM.H", 110, "p1.a"), level("PDH", 118, "p1.b")], OPTS);
  assert.equal(d.name, "NYAM.H");
  assert.equal(d.price, 110);
  assert.equal(d.cite, "p1.a");
});

test("rejects an uncitable array even when it is nearest (the MES draw)", () => {
  const d = selectDraw([arr(105, null, { size_quality: "tiny" }), level("NYAM.H", 115, "p1.a")], OPTS);
  assert.equal(d.name, "NYAM.H"); // the tiny null-cite array is rejected
});

test("rejects a tiny array (significance gate)", () => {
  const d = selectDraw([arr(106, "p.fvg", { size_quality: "tiny" })], OPTS);
  assert.equal(d, null);
});

test("a significant cited array IS eligible as a draw", () => {
  const d = selectDraw([arr(108, "p.fvg")], OPTS);
  assert.equal(d.cite, "p.fvg");
  assert.equal(d.kind, "array");
});

test("no eligible candidate → null", () => {
  const d = selectDraw([level("NYAM.H", 110, null), arr(105, null)], OPTS);
  assert.equal(d, null);
});

test("direction filter: bear keeps only below-price targets", () => {
  const d = selectDraw(
    [level("NYAM.H", 115, "above"), level("NYAM.L", 92, "below")],
    { price: 100, atr: 10, direction: "bear" },
  );
  assert.equal(d.name, "NYAM.L");
});

test("far level (beyond near window) is ineligible", () => {
  const d = selectDraw([level("PDH", 140, "p1.b")], OPTS); // 40 away > 20
  assert.equal(d, null);
});

test("no direction → nearest eligible either side", () => {
  const d = selectDraw(
    [level("AS.H", 112, "a"), level("AS.L", 95, "b")],
    { price: 100, atr: 10, direction: null },
  );
  assert.equal(d.name, "AS.L"); // |95-100|=5 < |112-100|=12
});

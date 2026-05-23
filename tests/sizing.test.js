import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeFor, dayOfWeek } from "../cli/lib/sizing.js";

test("A+ Tue returns full size", () => {
  const s = sizeFor({ grade: "A+", dow: "Tue" });
  assert.equal(s.contracts, 2);
  assert.equal(s.r_unit, 1.0);
});

test("A+ Mon reduced", () => {
  const s = sizeFor({ grade: "A+", dow: "Mon" });
  assert.equal(s.contracts, 1);
  assert.equal(s.r_unit, 0.5);
  assert.match(s.label, /reduced/);
});

test("A+ Fri reduced", () => {
  const s = sizeFor({ grade: "A+", dow: "Fri" });
  assert.equal(s.contracts, 1);
});

test("B Wed at half of A+ allocation", () => {
  const s = sizeFor({ grade: "B", dow: "Wed" });
  assert.equal(s.contracts, 1);
  assert.equal(s.r_unit, 0.5);
});

test("B Mon → no-trade equivalent", () => {
  const s = sizeFor({ grade: "B", dow: "Mon" });
  assert.equal(s.contracts, 0);
});

test("no-trade always returns 0 contracts", () => {
  const s = sizeFor({ grade: "no-trade", dow: "Tue" });
  assert.equal(s.contracts, 0);
  assert.equal(s.label, "no-trade");
});

test("dayOfWeek returns a 3-letter weekday", () => {
  const dow = dayOfWeek(new Date("2026-05-26T15:00:00Z"));    // Tuesday
  assert.equal(dow, "Tue");
});

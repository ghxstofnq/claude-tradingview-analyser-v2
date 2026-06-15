import { test } from "node:test";
import assert from "node:assert/strict";
import { psychGridFor, psychLevelsAbove, psychLevelsBelow } from "../app/main/strategy/walkers/psych-levels.js";

test("psychGridFor — per-instrument minor/major; uncalibrated → null", () => {
  assert.deepEqual(psychGridFor("MNQ1!"), { minor: 50, major: 100 });
  assert.deepEqual(psychGridFor("MES1!"), { minor: 5, major: 10 });
  assert.equal(psychGridFor("CL1!"), null);
});

test("psychLevelsAbove — minor-grid levels strictly above price, ascending, tagged", () => {
  const v = psychLevelsAbove("MNQ1!", 31090, 3);
  assert.deepEqual(v.map((x) => x.price), [31100, 31150, 31200]);
  // 31100 and 31200 are multiples of 100 → "major"; 31150 → "minor".
  assert.equal(v[0].grid, "major");
  assert.equal(v[1].grid, "minor");
  assert.equal(v[2].grid, "major");
  assert.equal(v[0].source, "psych");
});

test("psychLevelsBelow — strictly below, descending", () => {
  const v = psychLevelsBelow("MES1!", 7207, 2);
  assert.deepEqual(v.map((x) => x.price), [7205, 7200]);
  assert.equal(v[0].grid, "minor"); // 7205 → /5 not /10
  assert.equal(v[1].grid, "major"); // 7200 → /10
});

test("uncalibrated symbol → empty", () => {
  assert.deepEqual(psychLevelsAbove("CL1!", 100, 3), []);
  assert.deepEqual(psychLevelsBelow("CL1!", 100, 3), []);
});

test("price exactly on a grid level is excluded (strictly above/below)", () => {
  const a = psychLevelsAbove("MNQ1!", 31100, 2);
  assert.deepEqual(a.map((x) => x.price), [31150, 31200]);
  const b = psychLevelsBelow("MNQ1!", 31100, 2);
  assert.deepEqual(b.map((x) => x.price), [31050, 31000]);
});

// tests/evidence-helpers.test.js — the Evidence panel curator. Pure; real fields
// only (name/price/state/cite/distance) — no fabricated series or rule text.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { curateLevel } from "../app/renderer/src/shell/palette/evidence.helpers.js";

describe("curateLevel", () => {
  it("computes distance + direction from a real level and last close", () => {
    const r = curateLevel({ name: "PWH", price: 30967.75, state: "untaken", cite: "brief.PWH.price" }, 30900);
    assert.equal(r.name, "PWH");
    assert.equal(r.price, 30967.75);
    assert.equal(r.state, "untaken");
    assert.equal(r.cite, "brief.PWH.price");
    assert.equal(Math.round(r.distance * 100) / 100, 67.75);
    assert.equal(r.direction, "above");
  });
  it("direction is 'below' when the level is under price", () => {
    assert.equal(curateLevel({ name: "PWL", price: 30800 }, 30900).direction, "below");
  });
  it("null close → distance null + dash direction (never guessed)", () => {
    const r = curateLevel({ name: "PWH", price: 30967.75 }, null);
    assert.equal(r.distance, null);
    assert.equal(r.direction, "—");
  });
  it("null level → null", () => { assert.equal(curateLevel(null, 100), null); });
  it("defaults state to untaken when absent", () => {
    assert.equal(curateLevel({ name: "X", price: 1 }, 1).state, "untaken");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAddAccept } from "../app/main/trades.js";

describe("isAddAccept", () => {
  it("true when payload is tagged as an add", () => {
    assert.equal(isAddAccept({ tranche_role: "add" }), true);
  });
  it("false for a normal anchor accept", () => {
    assert.equal(isAddAccept({ tranche_role: "anchor" }), false);
    assert.equal(isAddAccept({}), false);
    assert.equal(isAddAccept(null), false);
  });
});

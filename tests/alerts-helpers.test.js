// Unit tests for the pure alert helpers in app/renderer/src/hooks/useAlerts.js.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeArmed } from "../app/renderer/src/hooks/useAlerts.js";

describe("normalizeArmed", () => {
  it("preserves the alert id (needed to disarm — old code dropped it)", () => {
    const out = normalizeArmed({ armed: [{ id: "a1", price: 21000.5, label: "PDH" }] });
    assert.deepEqual(out, [{ id: "a1", price: 21000.5, label: "PDH" }]);
  });

  it("drops alerts with no id (can't be disarmed)", () => {
    const out = normalizeArmed({ armed: [{ price: 21000, label: "x" }, { id: "a2", price: 21010, label: "y" }] });
    assert.deepEqual(out.map((a) => a.id), ["a2"]);
  });

  it("drops non-finite prices and coerces numeric strings", () => {
    const out = normalizeArmed({ armed: [
      { id: "a1", price: "21,000.25", label: "" },   // string kept as-is here (already numeric-ish) — see note
      { id: "a2", price: "nope", label: "" },
    ] });
    // "21,000.25" is NOT a finite Number() → dropped; only clean numerics survive.
    assert.deepEqual(out.map((a) => a.id), []);
    const out2 = normalizeArmed({ armed: [{ id: "a3", price: "21010", label: "z" }] });
    assert.deepEqual(out2, [{ id: "a3", price: 21010, label: "z" }]);
  });

  it("returns [] for missing / malformed payloads", () => {
    assert.deepEqual(normalizeArmed(null), []);
    assert.deepEqual(normalizeArmed({}), []);
    assert.deepEqual(normalizeArmed({ armed: "x" }), []);
  });

  it("defaults a missing label to empty string", () => {
    const out = normalizeArmed({ armed: [{ id: "a1", price: 21000 }] });
    assert.equal(out[0].label, "");
  });
});

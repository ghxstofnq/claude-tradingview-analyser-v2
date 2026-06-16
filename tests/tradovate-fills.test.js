// tests/tradovate-fills.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roundTripUsd } from "../app/main/execution/tradovate-fills.js";

describe("roundTripUsd", () => {
  it("MNQ long loser (the verified test round-trip): buy 30374.75 → 30374.00, 40c → -$60", () => {
    assert.equal(roundTripUsd({ side: "buy", entry: 30374.75, exit: 30374.0, qty: 40, symbol: "MNQU6" }), -60);
  });
  it("MNQ long winner: buy 30000 → 30010, 1c → +$20 ($2/pt)", () => {
    assert.equal(roundTripUsd({ side: "buy", entry: 30000, exit: 30010, qty: 1, symbol: "MNQU6" }), 20);
  });
  it("MES short winner: sell 7600 → 7590, 1c → +$50 ($5/pt)", () => {
    assert.equal(roundTripUsd({ side: "sell", entry: 7600, exit: 7590, qty: 1, symbol: "MESU6" }), 50);
  });
  it("short loser: sell 100 → 110, 2c MNQ → -$40", () => {
    assert.equal(roundTripUsd({ side: "sell", entry: 100, exit: 110, qty: 2, symbol: "MNQU6" }), -40);
  });
});

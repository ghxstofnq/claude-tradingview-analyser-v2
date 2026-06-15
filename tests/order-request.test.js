// tests/order-request.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrderRequest } from "../app/renderer/src/execution/orderRequest.js";

const setup = { side: "long", entry: 21842.5, stop: 21824.0, tp1: 21871.0 };
const sizing = { contracts: 3, actualRisk: 111, withinTolerance: true };
const guards = { perTradeMax: 250, dailyLimit: 600 };

describe("buildOrderRequest", () => {
  it("maps a setup + sizing into the canonical placeOrder/guardrail payload", () => {
    const r = buildOrderRequest({ setup, sizing, guards, account: "paper", symbol: "MNQ1!", type: "market" });
    assert.equal(r.side, "long");
    assert.equal(r.type, "market");
    assert.equal(r.symbol, "MNQ1!");
    assert.equal(r.account, "paper");
    assert.equal(r.contracts, 3);
    assert.equal(r.entry, 21842.5);
    assert.equal(r.stop, 21824.0);
    assert.equal(r.tp, 21871.0);
    assert.equal(r.hasStop, true);
    assert.deepEqual(r.sizing, sizing);
    assert.deepEqual(r.guards, guards);
  });
  it("defaults type to market", () => {
    assert.equal(buildOrderRequest({ setup, sizing, guards, account: "paper", symbol: "MNQ1!" }).type, "market");
  });
  it("flags hasStop=false when there is no usable stop", () => {
    const r = buildOrderRequest({ setup: { side: "long", entry: 21842.5, tp1: 21871 }, sizing, guards, account: "paper", symbol: "MNQ1!" });
    assert.equal(r.hasStop, false);
  });
  it("flags hasStop=false when entry equals stop (zero distance)", () => {
    const r = buildOrderRequest({ setup: { side: "long", entry: 21842.5, stop: 21842.5, tp1: 21871 }, sizing, guards, account: "paper", symbol: "MNQ1!" });
    assert.equal(r.hasStop, false);
  });
});

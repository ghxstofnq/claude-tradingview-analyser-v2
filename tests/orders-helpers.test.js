// tests/orders-helpers.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDrawOption, formatStopSource, routingLabel, blockMessage } from "../app/renderer/src/Orders.helpers.js";

describe("orders helpers", () => {
  it("formatDrawOption: name · price · R", () => {
    assert.equal(formatDrawOption({ name: "NYAM.H", price: 21120, rr: 4 }), "NYAM.H · 21120 · 4R");
    assert.equal(formatDrawOption({ name: "EQH pool", price: 21150.25, rr: null }), "EQH pool · 21150.25");
  });
  it("formatStopSource maps kind to label", () => {
    assert.equal(formatStopSource("leg_low"), "leg low");
    assert.equal(formatStopSource("swing_high"), "swing high");
    assert.equal(formatStopSource("session_level_low"), "session level");
    assert.equal(formatStopSource("typed"), "typed");
    assert.equal(formatStopSource(null), "—");
  });
  it("routingLabel from account gate", () => {
    assert.equal(routingLabel({ confirmed: { id: "9256021", type: "paper" }, gate: { route: true } }), "paper · 9256021");
    assert.equal(routingLabel({ confirmed: null, gate: { route: false, needsConfirm: true } }), "confirm account");
    assert.equal(routingLabel({ confirmed: { id: "1", type: "live" }, gate: { route: false } }), "live blocked");
  });
  it("routingLabel surfaces a pending Tradovate switch by name", () => {
    assert.equal(
      routingLabel({ active: { id: "D54476869", type: "live", broker: "tradovate" }, confirmed: { id: "9256021", type: "paper" }, gate: { needsConfirm: true } }),
      "confirm Tradovate · D54476869",
    );
    assert.equal(
      routingLabel({ confirmed: { id: "D54476869", type: "live", broker: "tradovate" }, gate: { route: true } }),
      "tradovate · D54476869",
    );
  });
  it("blockMessage is human", () => {
    assert.match(blockMessage("no_stop"), /stop/i);
    assert.match(blockMessage("stop_wrong_side"), /side/i);
    assert.match(blockMessage("no_size"), /size|\$50/i);
    assert.equal(blockMessage(null), "");
  });
});

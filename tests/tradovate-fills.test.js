// tests/tradovate-fills.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconstructLastRoundTrip } from "../app/main/execution/tradovate-fills.js";

// executions are newest-first (as Tradovate returns them).
describe("reconstructLastRoundTrip", () => {
  it("LONG round-trip — buy then sell — correct side + sign (the bug: this was recorded as sell/-42)", () => {
    const execs = [
      { instrument: "MNQU6", side: "sell", qty: 7, price: 30366.75, time: 1781649391 },
      { instrument: "MNQU6", side: "buy", qty: 7, price: 30363.75, time: 1781649365 },
    ];
    const rt = reconstructLastRoundTrip(execs, "MNQU6", 2);
    assert.equal(rt.side, "buy");
    assert.equal(rt.qty, 7);
    assert.equal(rt.entry, 30363.75);
    assert.equal(rt.exit, 30366.75);
    assert.equal(rt.usd, 42); // +$42 (price went up on a long), NOT -42
  });

  it("SHORT round-trip — sell then buy — profit when price falls", () => {
    const execs = [
      { instrument: "MESU6", side: "buy", qty: 1, price: 7590, time: 200 },
      { instrument: "MESU6", side: "sell", qty: 1, price: 7600, time: 100 },
    ];
    const rt = reconstructLastRoundTrip(execs, "MESU6", 5);
    assert.equal(rt.side, "sell");
    assert.equal(rt.entry, 7600);
    assert.equal(rt.exit, 7590);
    assert.equal(rt.usd, 50); // sold 7600, bought 7590, 1c MES $5/pt → +$50
  });

  it("multi-fill open (VWAP entry), single close", () => {
    const execs = [
      { instrument: "MNQU6", side: "sell", qty: 7, price: 110, time: 300 },
      { instrument: "MNQU6", side: "buy", qty: 4, price: 101, time: 200 },
      { instrument: "MNQU6", side: "buy", qty: 3, price: 100, time: 100 },
    ];
    const rt = reconstructLastRoundTrip(execs, "MNQU6", 2);
    assert.equal(rt.side, "buy");
    assert.equal(rt.qty, 7);
    assert.equal(rt.entry, Math.round((4 * 101 + 3 * 100) / 7 * 100) / 100); // VWAP 100.57
    assert.equal(rt.exit, 110);
    assert.equal(rt.usd, (7 * 110 - (4 * 101 + 3 * 100)) * 2); // (770-704)*2 = 132
  });

  it("ignores other instruments + earlier closed trips", () => {
    const execs = [
      { instrument: "MNQU6", side: "sell", qty: 1, price: 200, time: 400 },
      { instrument: "MNQU6", side: "buy", qty: 1, price: 190, time: 300 },
      { instrument: "MESU6", side: "sell", qty: 1, price: 999, time: 250 },
      { instrument: "MNQU6", side: "sell", qty: 1, price: 50, time: 200 }, // older trip — not included
    ];
    const rt = reconstructLastRoundTrip(execs, "MNQU6", 2);
    assert.equal(rt.entry, 190);
    assert.equal(rt.exit, 200);
    assert.equal(rt.usd, 20); // only the most recent MNQU6 round-trip
  });

  it("incomplete (net never returns to zero) → null", () => {
    assert.equal(reconstructLastRoundTrip([{ instrument: "MNQU6", side: "buy", qty: 1, price: 100, time: 1 }], "MNQU6", 2), null);
  });
  it("no fills for the instrument → null", () => {
    assert.equal(reconstructLastRoundTrip([{ instrument: "ESU6", side: "buy", qty: 1, price: 1, time: 1 }], "MNQU6", 2), null);
  });
});

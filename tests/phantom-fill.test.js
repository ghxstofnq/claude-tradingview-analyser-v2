// Regression for the 2026-07-02 live phantom fill: a bearish setup was accepted
// but its order failed to place (symbol-less packet → null order ids), yet the
// grader still marked it FILLED against price bars — a journal position with
// nothing at the broker. The fix: a failed order writes an INVALIDATED outcome
// so foldOpenTrades closes the trade and tickTrades can never fill it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { foldOpenTrades, tickTrades } from "../cli/lib/trade-outcomes.js";
import { __test as bc } from "../app/main/bar-close.js";

const ACCEPT = { type: "accept", id: "T-1", side: "short", entry: 29819, stop: 29934, invalidation: 29934, tp1: 29274, size: { contracts: 1 } };
// A bar whose range includes the short entry (29819) but not the stop/invalidation (29934) — a clean fill.
const fillBar = { open: 29822, high: 29825, low: 29815, close: 29817, ts: "2026-07-02T15:03:00.000Z" };

describe("phantom fill (failed order must not fill)", () => {
  it("CONTROL: an accepted setup with no failure marker DOES get filled (the bug)", () => {
    const open = foldOpenTrades([ACCEPT]);
    assert.equal(open.length, 1);
    const { transitions } = tickTrades(open, fillBar);
    assert.ok(transitions.some((t) => t.status === "FILLED"), "an accept alone phantom-fills when price crosses entry");
  });

  it("FIX: a failed order writes INVALIDATED → trade is closed → never filled", () => {
    const events = [ACCEPT, { type: "outcome", id: "T-1", status: "INVALIDATED", source: "order-place-failed" }];
    const open = foldOpenTrades(events);
    assert.equal(open.length, 0, "an invalidated trade is not in the open set");
    const { transitions } = tickTrades(open, fillBar);
    assert.equal(transitions.length, 0, "no FILLED transition for a failed-order trade");
  });

  it("FIX: missing-symbol invalidation also closes the trade", () => {
    const events = [ACCEPT, { type: "outcome", id: "T-1", status: "INVALIDATED", source: "missing-symbol" }];
    assert.equal(foldOpenTrades(events).length, 0);
  });
});

describe("symbol propagation (root cause of the failed order)", () => {
  const packet = { model: "MSS", side: "short", entry: { price: 29819 }, stop: { price: 29934 }, tp1: { price: 29274 } };
  it("normalizes the exchange-prefixed event symbol to the canonical form", () => {
    const p = bc.deterministicPacketToSurfacePayload(packet, { symbol: "CME_MINI:MNQ1!", ts: "2026-07-02T15:02:00.000Z" });
    assert.equal(p.symbol, "MNQ1!");
  });
  it("prefers a symbol already carried on the packet", () => {
    const p = bc.deterministicPacketToSurfacePayload({ ...packet, symbol: "MES1!" }, { symbol: "CME_MINI:MNQ1!" });
    assert.equal(p.symbol, "MES1!");
  });
  it("null when nothing supplies a symbol (so the order guard can block it)", () => {
    const p = bc.deterministicPacketToSurfacePayload(packet, {});
    assert.equal(p.symbol, null);
  });
});

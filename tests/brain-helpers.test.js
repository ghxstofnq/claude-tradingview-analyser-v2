// Unit tests for app/renderer/src/Brain.helpers.js — turning the deterministic
// chain's per-bar verdict into plain-English BRAIN prose (no Claude in the loop).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { walkerTruthToProse } from "../app/renderer/src/Brain.helpers.js";

describe("walkerTruthToProse", () => {
  it("renders a fired packet with model/side/grade/entry/stop/tp1", () => {
    const out = walkerTruthToProse({
      finalVerdict: "trade",
      bestPacket: {
        model: "MSS", side: "long", grade: "A+",
        entry: { price: 21322.5 },
        stop: { price: 21285, kind: "swing_low" },
        tp1: { price: 21385, rMultiple: 4.2 },
      },
    });
    assert.match(out, /A\+ MSS LONG/);
    assert.match(out, /entry 21322\.5/);
    assert.match(out, /stop 21285 \(swing_low\)/);
    assert.match(out, /TP1 21385 \(4\.2R\)/);
  });

  it("renders a no-trade with its reason and the active walker stages", () => {
    const out = walkerTruthToProse({
      finalVerdict: "no_trade",
      noTradeReason: "bias bearish but price has not tapped the 4H FVG",
      walkers: [
        { model: "MSS", side: "short", stage: "await_tap" },
        { model: "Trend", side: "short", stage: "await_confirmation" },
      ],
    });
    assert.match(out, /No trade/);
    assert.match(out, /not tapped the 4H FVG/);
    assert.match(out, /2 walkers/);
    assert.match(out, /MSS SHORT @ await_tap/);
    assert.match(out, /Trend SHORT @ await_confirmation/);
  });

  it("falls back to blockers when there is no reason string", () => {
    const out = walkerTruthToProse({ finalVerdict: "no_trade", blockers: ["missing_ltf_bias", "missing_htf_ltf_alignment"], walkers: [] });
    assert.match(out, /No trade/);
    assert.match(out, /missing_ltf_bias/);
  });

  it("surfaces a chain error verbatim", () => {
    const out = walkerTruthToProse({ chain_error: "walker chain did not produce truth this bar" });
    assert.match(out, /walker chain did not produce truth/);
  });

  it("tolerates flat packet fields (entry as a bare number, no stop kind)", () => {
    const out = walkerTruthToProse({ bestPacket: { model: "Inversion", side: "short", grade: "B", entry: 29792, stop: 29811.75, tp1: 29302.5 } });
    assert.match(out, /B Inversion SHORT/);
    assert.match(out, /entry 29792/);
    assert.match(out, /stop 29811\.75/);
    assert.match(out, /TP1 29302\.5/);
  });

  it("returns a safe fallback for null / empty truth", () => {
    assert.match(walkerTruthToProse(null), /no verdict/i);
    assert.match(walkerTruthToProse({}), /no/i);
  });
});

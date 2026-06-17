// tests/execution-guardrails.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrder } from "../app/main/execution/guardrails.js";

const ok = { contracts: 3, actualRisk: 111, withinTolerance: true };
const guards = { perTradeMax: 250, dailyLimit: 600 };

describe("checkOrder", () => {
  it("passes a valid order with a stop, in-tolerance size, under max, under daily loss", () => {
    assert.deepEqual(checkOrder({ hasStop: true, sizing: ok, guards, dayState: { realizedLossUsd: 0 } }), { ok: true });
  });
  it("blocks when there is no stop", () => {
    const r = checkOrder({ hasStop: false, sizing: ok, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "NO_STOP");
  });
  it("blocks SIZE only when nothing can be sized (contracts < 1)", () => {
    const r = checkOrder({ hasStop: true, sizing: { contracts: 0, actualRisk: 0, withinTolerance: false }, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "SIZE");
  });
  it("allows a rounded-down off-target size (contracts >= 1, under the cap)", () => {
    // The round-down case: 1c @ $210 for a $300 target is off-tolerance but
    // under the $250 cap → take it (the SIZE skip this fix removes).
    const r = checkOrder({ hasStop: true, sizing: { contracts: 1, actualRisk: 210, withinTolerance: false }, guards, dayState: { realizedLossUsd: 0 } });
    assert.deepEqual(r, { ok: true });
  });
  it("blocks when computed risk exceeds the per-trade max", () => {
    const r = checkOrder({ hasStop: true, sizing: { contracts: 6, actualRisk: 300, withinTolerance: true }, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "OVER_MAX");
  });
  it("OVER_MAX fires on the tranche shape (riskUsd field, no actualRisk)", () => {
    // tranche sizePacket returns { contracts, riskUsd, withinTolerance } — the
    // cap must still bite, otherwise round-down could over-risk on auto.
    const r = checkOrder({ hasStop: true, sizing: { contracts: 1, riskUsd: 1000, withinTolerance: false }, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "OVER_MAX");
  });
  it("blocks new entries once the daily loss limit is reached", () => {
    const r = checkOrder({ hasStop: true, sizing: ok, guards, dayState: { realizedLossUsd: 600 } });
    assert.equal(r.ok, false); assert.equal(r.code, "DAILY_HALT");
  });
});

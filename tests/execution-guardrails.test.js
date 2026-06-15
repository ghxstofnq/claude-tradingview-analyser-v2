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
  it("blocks when no whole-micro size fits within tolerance", () => {
    const r = checkOrder({ hasStop: true, sizing: { contracts: 0, actualRisk: 0, withinTolerance: false }, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "SIZE");
  });
  it("blocks when computed risk exceeds the per-trade max", () => {
    const r = checkOrder({ hasStop: true, sizing: { contracts: 6, actualRisk: 300, withinTolerance: true }, guards, dayState: { realizedLossUsd: 0 } });
    assert.equal(r.ok, false); assert.equal(r.code, "OVER_MAX");
  });
  it("blocks new entries once the daily loss limit is reached", () => {
    const r = checkOrder({ hasStop: true, sizing: ok, guards, dayState: { realizedLossUsd: 600 } });
    assert.equal(r.ok, false); assert.equal(r.code, "DAILY_HALT");
  });
});

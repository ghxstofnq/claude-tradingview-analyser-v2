// tests/execution-guardrails.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrder, openLossFromUpnl } from "../app/main/execution/guardrails.js";

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

// audit Phase 3 — the daily halt must be PREDICTIVE, not realized-only. A new
// order whose worst-case loss would push the day past the prop-firm daily limit
// must block BEFORE it fires, even when realized loss is still under the limit.
describe("checkOrder — predictive daily-loss gate", () => {
  it("blocks $599 realized + $250 new-order risk (a possible $849 day)", () => {
    const r = checkOrder({ hasStop: true, sizing: { contracts: 1, actualRisk: 250 }, guards, dayState: { realizedLossUsd: 599 } });
    assert.equal(r.ok, false); assert.equal(r.code, "DAILY_HALT");
  });
  it("blocks on realized + open drawdown + new-order risk combined", () => {
    // 300 realized + 200 open drawdown + 150 risk = 650 ≥ 600 → block.
    const r = checkOrder({ hasStop: true, sizing: { contracts: 1, actualRisk: 150 }, guards, dayState: { realizedLossUsd: 300, openLossUsd: 200 } });
    assert.equal(r.ok, false); assert.equal(r.code, "DAILY_HALT");
  });
  it("reads open drawdown under unrealizedLossUsd / openDrawdownUsd aliases too", () => {
    const base = { hasStop: true, sizing: { contracts: 1, actualRisk: 150 }, guards };
    const a = checkOrder({ ...base, dayState: { realizedLossUsd: 300, unrealizedLossUsd: 200 } });
    const b = checkOrder({ ...base, dayState: { realizedLossUsd: 300, openDrawdownUsd: 200 } });
    assert.equal(a.code, "DAILY_HALT");
    assert.equal(b.code, "DAILY_HALT");
  });
  it("open PROFIT (negative loss) does not add to the projection", () => {
    // Same magnitude: a +300 open profit must NOT block where a -300 drawdown does.
    const base = { hasStop: true, sizing: { contracts: 1, actualRisk: 150 }, guards };
    const profit = checkOrder({ ...base, dayState: { realizedLossUsd: 400, openLossUsd: -300 } });
    const draw = checkOrder({ ...base, dayState: { realizedLossUsd: 400, openLossUsd: 300 } });
    assert.deepEqual(profit, { ok: true });          // 400 + 0 + 150 = 550 < 600
    assert.equal(draw.code, "DAILY_HALT");            // 400 + 300 + 150 = 850 ≥ 600
  });
  it("signed open PnL aliases count negative PnL as open loss and ignore profit", () => {
    const base = { hasStop: true, sizing: { contracts: 1, actualRisk: 150 }, guards };
    const loss = checkOrder({ ...base, dayState: { realizedLossUsd: 300, uPnlUsd: -200 } });
    const profit = checkOrder({ ...base, dayState: { realizedLossUsd: 400, uPnlUsd: 300 } });
    assert.equal(loss.code, "DAILY_HALT");           // 300 + 200 + 150 = 650 ≥ 600
    assert.deepEqual(profit, { ok: true });          // 400 + 0 + 150 = 550 < 600
  });
  it("does not false-block when the projected day stays under the limit", () => {
    const r = checkOrder({ hasStop: true, sizing: { contracts: 1, actualRisk: 100 }, guards, dayState: { realizedLossUsd: 300, openLossUsd: 0 } });
    assert.deepEqual(r, { ok: true });               // 300 + 0 + 100 = 400 < 600
  });
});

describe("openLossFromUpnl — signed PnL → positive drawdown", () => {
  it("a drawdown (negative uPnl) becomes a positive loss", () => {
    assert.equal(openLossFromUpnl(-200), 200);
  });
  it("a profit (positive uPnl) is 0 loss", () => {
    assert.equal(openLossFromUpnl(150), 0);
  });
  it("non-finite / missing uPnl is 0 (fail-safe)", () => {
    assert.equal(openLossFromUpnl(undefined), 0);
    assert.equal(openLossFromUpnl(null), 0);
    assert.equal(openLossFromUpnl(NaN), 0);
    assert.equal(openLossFromUpnl("nope"), 0);
  });
});

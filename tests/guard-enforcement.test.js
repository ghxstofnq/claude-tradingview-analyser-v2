// tests/guard-enforcement.test.js — the new enforced guards (maxContracts /
// maxTrades / maxConsec), the day-count helpers, buildDayState fail-closed shape,
// and the automationMode fail-closed coercion. Pure; no broker calls.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrder } from "../app/main/execution/guardrails.js";
import { dayTradeCount, dayConsecutiveLossStreak, buildDayState } from "../app/main/execution/fills.js";
import { mergeExecConfig, DEFAULT_EXEC_CONFIG } from "../app/main/execution/config.js";

const good = { contracts: 3, actualRisk: 100, withinTolerance: true };

describe("checkOrder — maxContracts / maxTrades / maxConsec", () => {
  it("OVER_CONTRACTS above the cap; at the cap passes", () => {
    assert.equal(checkOrder({ hasStop: true, sizing: { ...good, contracts: 5 }, guards: { maxContracts: 4 }, dayState: {} }).code, "OVER_CONTRACTS");
    assert.deepEqual(checkOrder({ hasStop: true, sizing: { ...good, contracts: 4 }, guards: { maxContracts: 4 }, dayState: {} }), { ok: true });
  });
  it("MAX_TRADES at/over the cap; under passes", () => {
    assert.equal(checkOrder({ hasStop: true, sizing: good, guards: { maxTrades: 4 }, dayState: { tradeCount: 4 } }).code, "MAX_TRADES");
    assert.deepEqual(checkOrder({ hasStop: true, sizing: good, guards: { maxTrades: 4 }, dayState: { tradeCount: 3 } }), { ok: true });
  });
  it("TRADE_COUNT_UNKNOWN when the cap is set but no count is supplied (fail-closed)", () => {
    assert.equal(checkOrder({ hasStop: true, sizing: good, guards: { maxTrades: 4 }, dayState: {} }).code, "TRADE_COUNT_UNKNOWN");
  });
  it("MAX_CONSEC + CONSEC_UNKNOWN, symmetric", () => {
    assert.equal(checkOrder({ hasStop: true, sizing: good, guards: { maxConsec: 3 }, dayState: { consecLosses: 3 } }).code, "MAX_CONSEC");
    assert.deepEqual(checkOrder({ hasStop: true, sizing: good, guards: { maxConsec: 3 }, dayState: { consecLosses: 2 } }), { ok: true });
    assert.equal(checkOrder({ hasStop: true, sizing: good, guards: { maxConsec: 3 }, dayState: {} }).code, "CONSEC_UNKNOWN");
  });
  it("opt-out: null caps skip the checks regardless of counts", () => {
    assert.deepEqual(checkOrder({ hasStop: true, sizing: { ...good, contracts: 99 }, guards: { maxContracts: null, maxTrades: null, maxConsec: null }, dayState: {} }), { ok: true });
  });
  it("ordering: an over-cap size blocks before the day-count logic runs", () => {
    assert.equal(checkOrder({ hasStop: true, sizing: { ...good, contracts: 9 }, guards: { maxContracts: 4, maxTrades: 4 }, dayState: {} }).code, "OVER_CONTRACTS");
  });
});

describe("fills counts", () => {
  const f = (usd, ts, acct = "paper") => ({ ts, account: acct, actual: { usd } });
  it("dayTradeCount counts closed round-trips (account-scoped)", () => {
    const fills = [f(100, "t1"), f(-50, "t2"), f(20, "t3", "other")];
    assert.equal(dayTradeCount(fills), 3);
    assert.equal(dayTradeCount(fills, "paper"), 2);
  });
  it("dayConsecutiveLossStreak trails from the most recent, resets on a win, ts-ordered", () => {
    assert.equal(dayConsecutiveLossStreak([f(-1, "t1"), f(5, "t2"), f(-1, "t3"), f(-1, "t4")]), 2);
    assert.equal(dayConsecutiveLossStreak([f(-1, "t1"), f(-1, "t2"), f(5, "t3")]), 0);
    assert.equal(dayConsecutiveLossStreak([f(-1, "t3"), f(5, "t1"), f(-1, "t2")]), 2); // sorted: win,loss,loss
    assert.equal(dayConsecutiveLossStreak([]), 0);
  });
  it("buildDayState: +openNow counts the in-flight entry; null fills ⇒ undefined counts (fail-closed)", () => {
    const s = buildDayState({ fills: [f(-10, "t1")], openNow: 1 });
    assert.equal(s.tradeCount, 2);
    assert.equal(s.consecLosses, 1);
    const bad = buildDayState({ fills: null, openNow: 1 });
    assert.equal(bad.tradeCount, undefined);
    assert.equal(bad.consecLosses, undefined);
  });
});

describe("automationMode coercion (fail-closed)", () => {
  it("coerces unknown/corrupt/undefined mode to manual — never auto", () => {
    assert.equal(mergeExecConfig(DEFAULT_EXEC_CONFIG, { automationMode: "bogus" }).automationMode, "manual");
    assert.equal(mergeExecConfig(DEFAULT_EXEC_CONFIG, { automationMode: undefined }).automationMode, "manual");
  });
  it("preserves the three real modes", () => {
    for (const m of ["manual", "suggest", "auto"]) {
      assert.equal(mergeExecConfig(DEFAULT_EXEC_CONFIG, { automationMode: m }).automationMode, m);
    }
  });
  it("new guard caps backfill onto an old on-disk config", () => {
    const merged = mergeExecConfig(DEFAULT_EXEC_CONFIG, { guards: { perTradeMax: 300 } });
    assert.equal(merged.guards.maxTrades, 4);
    assert.equal(merged.guards.perTradeMax, 300);
  });
});

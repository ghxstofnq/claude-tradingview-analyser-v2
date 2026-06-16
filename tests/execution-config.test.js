import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readExecConfig, DEFAULT_EXEC_CONFIG, mergeExecConfig } from "../app/main/execution/config.js";

describe("exec config defaults", () => {
  it("defaults are backtest-exact", () => {
    assert.equal(DEFAULT_EXEC_CONFIG.automationMode, "manual");
    assert.equal(DEFAULT_EXEC_CONFIG.maxAdds, 5);
    assert.equal(DEFAULT_EXEC_CONFIG.combinedCapUsd, null);
    assert.equal(DEFAULT_EXEC_CONFIG.guards.perTradeMax, 250);
    assert.equal(DEFAULT_EXEC_CONFIG.guards.dailyLimit, 600);
    assert.equal(DEFAULT_EXEC_CONFIG.guards.defaultRisk, 120);
  });

  it("readExecConfig returns defaults when no file", () => {
    const cfg = readExecConfig();
    assert.equal(typeof cfg.automationMode, "string");
    assert.equal(cfg.maxAdds >= 0, true);
    assert.equal(typeof cfg.guards, "object");
  });
});

describe("mergeExecConfig (pure deep-merge of guards)", () => {
  it("shallow-merges top-level keys", () => {
    const out = mergeExecConfig({ automationMode: "manual", maxAdds: 5, guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 } }, { automationMode: "auto" });
    assert.equal(out.automationMode, "auto");
    assert.equal(out.maxAdds, 5);
  });
  it("deep-merges the guards sub-object (does not wipe siblings)", () => {
    const base = { guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 } };
    const out = mergeExecConfig(base, { guards: { defaultRisk: 300 } });
    assert.equal(out.guards.defaultRisk, 300);
    assert.equal(out.guards.perTradeMax, 250);
    assert.equal(out.guards.dailyLimit, 600);
  });
  it("preserves guards when patch omits them", () => {
    const base = { guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 } };
    const out = mergeExecConfig(base, { paperAccountId: "9256021" });
    assert.equal(out.guards.perTradeMax, 250);
    assert.equal(out.paperAccountId, "9256021");
  });
});

describe("exec config — arming fields", () => {
  it("defaults: confirmedAccount null, liveHost null, paperHost set", () => {
    assert.equal(DEFAULT_EXEC_CONFIG.confirmedAccount, null);
    assert.equal(DEFAULT_EXEC_CONFIG.liveHost, null);
    assert.equal(DEFAULT_EXEC_CONFIG.paperHost, "https://papertrading.tradingview.com");
  });
  it("confirmedAccount persists through a merge (not wiped by an unrelated patch)", () => {
    const base = mergeExecConfig(DEFAULT_EXEC_CONFIG, { confirmedAccount: { id: "L-1", type: "live", name: "X" } });
    const out = mergeExecConfig(base, { maxAdds: 4 });
    assert.equal(out.confirmedAccount.id, "L-1");
    assert.equal(out.maxAdds, 4);
  });
});

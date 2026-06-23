import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runTrancheManager } from "../app/main/execution/tranche-manager.js";

// Build a deps double that records calls. Defaults describe a healthy auto
// session with no open trades. Scale-in removed 2026-06-23 — one position only.
function makeDeps(over = {}) {
  const calls = { accept: [], openTrancheOrders: [], recordSkip: [] };
  const deps = {
    readExecConfig: () => ({ automationMode: "auto", guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 } }),
    readJournal: async () => ({ events: [], open: [] }),
    sizePacket: () => ({ contracts: 1, riskUsd: 120, withinTolerance: true }),
    consecutiveLossStreak: () => 0,
    dayRealizedLossUsd: () => 0,
    checkOrder: () => ({ ok: true }),
    accept: async (payload) => { calls.accept.push(payload); return { id: "T-0009" }; },
    openTrancheOrders: async (a) => { calls.openTrancheOrders.push(a); return { stopOrderId: 1, limitOrderId: 2 }; },
    recordSkip: async (r) => { calls.recordSkip.push(r); },
    accountRoutable: () => ({ route: true }),
    autoAllowed: () => true,
    ...over,
  };
  return { deps, calls };
}

const anchorPacket = { side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: 120 };
const openAnchor = [{ id: "T-0001", tranche_role: "anchor", side: "long", entry: 100, tp1: 110, ts: new Date(0).toISOString() }];

describe("runTrancheManager", () => {
  it("manual mode → no-op, no accept", async () => {
    const { deps, calls } = makeDeps({ readExecConfig: () => ({ automationMode: "manual", guards: {} }) });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "manual");
    assert.equal(calls.accept.length, 0);
  });

  it("no packet → none", async () => {
    const { deps } = makeDeps();
    const r = await runTrancheManager({ bestPacket: null, price: 100 }, deps);
    assert.equal(r.action, "none");
  });

  it("auto, no open trade → opens an anchor + brackets", async () => {
    const { deps, calls } = makeDeps();
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "open_anchor");
    assert.equal(calls.accept[0].tranche_role, "anchor");
    assert.equal(calls.openTrancheOrders.length, 1);
    assert.equal(calls.openTrancheOrders[0].contracts, 1);
  });

  it("auto, a position already open → skip:active, no accept (no scale-in adds)", async () => {
    const { deps, calls } = makeDeps({ readJournal: async () => ({ events: [], open: openAnchor }) });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 106 }, deps);
    assert.equal(r.action, "skip:active");
    assert.equal(calls.accept.length, 0);
    assert.equal(calls.recordSkip.length, 1);
  });

  it("guardrail block → records skip, no accept", async () => {
    const { deps, calls } = makeDeps({ checkOrder: () => ({ ok: false, code: "OVER_MAX" }) });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "blocked:OVER_MAX");
    assert.equal(calls.accept.length, 0);
    assert.equal(calls.recordSkip.length, 1);
  });
});

describe("runTrancheManager respects the account gate + live-auto-pause", () => {
  it("blocks auto when the account gate says do not route", async () => {
    const { deps, calls } = makeDeps({ accountRoutable: () => ({ route: false, reason: "account_switch" }) });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "blocked:account_switch");
    assert.equal(calls.accept.length, 0);
  });
  it("blocks auto when live-auto is paused on boot", async () => {
    const { deps, calls } = makeDeps({ autoAllowed: () => false });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "blocked:live_auto_paused");
    assert.equal(calls.accept.length, 0);
  });
});

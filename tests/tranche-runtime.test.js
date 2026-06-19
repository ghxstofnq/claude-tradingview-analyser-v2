import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runTrancheManager, openTrancheNow } from "../app/main/execution/tranche-manager.js";

// Build a deps double that records calls. Defaults describe a healthy auto
// session with no open trades.
function makeDeps(over = {}) {
  const calls = { accept: [], openTrancheOrders: [], recordSkip: [], markGreenLight: [] };
  const deps = {
    readExecConfig: () => ({ automationMode: "auto", maxAdds: 5, combinedCapUsd: null, guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 } }),
    readJournal: async () => ({ events: [], open: [] }),
    hasGreenLight: () => false,
    markGreenLight: async (id) => { calls.markGreenLight.push(id); },
    sizePacket: () => ({ contracts: 1, riskUsd: 120, withinTolerance: true }),
    openRiskUsd: () => 0,
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
const greenAnchorOpen = [{ id: "T-0001", tranche_role: "anchor", side: "long", entry: 100, tp1: 110, ts: new Date(0).toISOString() }];

describe("runTrancheManager", () => {
  it("manual mode → no-op, no accept", async () => {
    const { deps, calls } = makeDeps({ readExecConfig: () => ({ automationMode: "manual", maxAdds: 5, guards: {} }) });
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

  it("auto, green-lit anchor + same-side packet → opens an add", async () => {
    const { deps, calls } = makeDeps({
      readJournal: async () => ({ events: [], open: greenAnchorOpen }),
      hasGreenLight: () => true,
    });
    const r = await runTrancheManager({ bestPacket: { ...anchorPacket, event_ts: new Date(60 * 60000).toISOString() }, price: 106 }, deps);
    assert.equal(r.action, "open_add");
    assert.equal(calls.accept[0].tranche_role, "add");
  });

  it("latches green-light via marker when price first reaches 50%", async () => {
    const { deps, calls } = makeDeps({
      readJournal: async () => ({ events: [], open: greenAnchorOpen }),
      hasGreenLight: () => false,
    });
    await runTrancheManager({ bestPacket: { ...anchorPacket, event_ts: new Date(60 * 60000).toISOString() }, price: 106 }, deps);
    assert.deepEqual(calls.markGreenLight, ["T-0001"]);
  });

  it("guardrail block → records skip, no accept", async () => {
    const { deps, calls } = makeDeps({ checkOrder: () => ({ ok: false, code: "OVER_MAX" }) });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "blocked:OVER_MAX");
    assert.equal(calls.accept.length, 0);
    assert.equal(calls.recordSkip.length, 1);
  });

  it("anchor-auto-adds mode, no open → surface (human takes anchor), no accept", async () => {
    const { deps, calls } = makeDeps({ readExecConfig: () => ({ automationMode: "anchor-auto-adds", maxAdds: 5, guards: {} }) });
    const r = await runTrancheManager({ bestPacket: anchorPacket, price: 100 }, deps);
    assert.equal(r.action, "surface");
    assert.equal(calls.accept.length, 0);
  });

  it("skip:dup → records skip, no accept", async () => {
    const { deps, calls } = makeDeps({
      readJournal: async () => ({ events: [], open: greenAnchorOpen }),
      hasGreenLight: () => true,
    });
    const dupPacket = { ...anchorPacket, event_ts: new Date(0).toISOString() }; // same ts as anchor → dup
    const r = await runTrancheManager({ bestPacket: dupPacket, price: 106 }, deps);
    assert.match(r.action, /^skip:/);
    assert.equal(calls.accept.length, 0);
    assert.equal(calls.recordSkip.length, 1);
  });
});

describe("openTrancheNow (manual ADD path)", () => {
  it("guardrail ok → accepts (tagged add) + opens standalone bracket", async () => {
    const { deps, calls } = makeDeps();
    const r = await openTrancheNow({ packet: anchorPacket, role: "add" }, deps);
    assert.equal(r.ok, true);
    assert.equal(calls.accept[0].tranche_role, "add");
    assert.equal(calls.openTrancheOrders.length, 1);
  });
  it("guardrail block → no accept", async () => {
    const { deps, calls } = makeDeps({ checkOrder: () => ({ ok: false, code: "SIZE" }) });
    const r = await openTrancheNow({ packet: anchorPacket }, deps);
    assert.equal(r.ok, false);
    assert.equal(calls.accept.length, 0);
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

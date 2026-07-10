import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrder } from "../app/main/execution/guardrails.js";
import { planTrancheAction, runTrancheManager, tradovateOrderFromPacket } from "../app/main/execution/tranche-manager.js";
import { bracketDisposition } from "../app/main/execution/tranche-exec.js";

// B1: the ambiguous-submit fix. A fetch-failed / timed-out entry POST is NO
// LONGER classified as a clean reject (which invalidated the trade) — it is
// `recovery`, so the caller holds it for the boot reconciler instead of possibly
// abandoning a real live position.
describe("bracketDisposition (ambiguous-submit fix)", () => {
  const ok = (id) => ({ ok: true, status: 200, body: JSON.stringify({ id }) });

  it("ambiguous entry (status 0, fetch failed) → recovery, NOT rejected", () => {
    const d = bracketDisposition([{ ok: false, status: 0, body: "fetch failed" }]);
    assert.equal(d.disposition, "recovery");
    assert.equal(d.submit, "ambiguous");
  });
  it("5xx entry → recovery (fail-closed: the order may have landed)", () => {
    assert.equal(bracketDisposition([{ ok: false, status: 503 }]).disposition, "recovery");
  });
  it("clean 4xx entry → rejected", () => {
    const d = bracketDisposition([{ ok: false, status: 400, body: "bad" }]);
    assert.equal(d.disposition, "rejected");
    assert.equal(d.submit, "rejected");
  });
  it("filled entry with a failed stop leg → naked", () => {
    const d = bracketDisposition([ok(10), { ok: false, status: 200 }, ok(12)]);
    assert.equal(d.disposition, "naked");
  });
  it("filled entry + working stop → ok with the stop order id", () => {
    const d = bracketDisposition([ok(10), ok(11), ok(12)]);
    assert.equal(d.disposition, "ok");
    assert.equal(d.stopOrderId, 11);
    assert.equal(d.limitOrderId, 12);
  });
});

describe("tradovateOrderFromPacket (auto → Tradovate bracket routing)", () => {
  it("maps a long packet → buy market order with stop/target bracket + chart symbol", () => {
    const o = tradovateOrderFromPacket({ symbol: "MNQ1!", side: "long", entry: 100, stop: 95, tp1: 110 }, 3);
    assert.deepEqual(o, { symbol: "MNQ1!", side: "buy", type: "market", contracts: 3, stopLoss: 95, takeProfit: 110, currentAsk: 100, currentBid: 100 });
  });
  it("maps a short packet → sell", () => {
    assert.equal(tradovateOrderFromPacket({ side: "short", entry: 100, stop: 105, tp1: 90 }, 2).side, "sell");
  });
  it("accepts buy/sell sides verbatim", () => {
    assert.equal(tradovateOrderFromPacket({ side: "buy" }, 1).side, "buy");
    assert.equal(tradovateOrderFromPacket({ side: "sell" }, 1).side, "sell");
  });
  it("A+ rides to TP2 on the native bracket", () => {
    assert.equal(tradovateOrderFromPacket({ side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: 120 }, 1).takeProfit, 120);
  });
  it("A+ with no TP2 room banks at TP1", () => {
    assert.equal(tradovateOrderFromPacket({ side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: null }, 1).takeProfit, 110);
  });
  it("B banks at TP1 even when a TP2 exists", () => {
    assert.equal(tradovateOrderFromPacket({ side: "long", grade: "B", entry: 100, stop: 95, tp1: 110, tp2: 120 }, 1).takeProfit, 110);
  });
});

const anchorPacket = { side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: 120 };
const base = { bestPacket: anchorPacket, openTranches: [], mode: "auto", lossHalt: false };
const openAnchor = [{ id: "T-0001", tranche_role: "anchor", side: "long", entry: 100, tp1: 110 }];

// Scale-in removed 2026-06-23 — one position at a time, never an add.
describe("planTrancheAction", () => {
  it("no packet → none", () => {
    assert.equal(planTrancheAction({ ...base, bestPacket: null }).action, "none");
  });
  it("loss halt → blocked:halt", () => {
    assert.equal(planTrancheAction({ ...base, lossHalt: true }).action, "blocked:halt");
  });
  it("auto, no open trade → open_anchor", () => {
    assert.equal(planTrancheAction(base).action, "open_anchor");
  });
  it("manual, no open trade → surface (human takes the anchor)", () => {
    assert.equal(planTrancheAction({ ...base, mode: "manual" }).action, "surface");
  });
  it("auto, a position already open, same side → skip:active (no adds)", () => {
    assert.equal(planTrancheAction({ ...base, openTranches: openAnchor }).action, "skip:active");
  });
  it("auto, a position already open, opposite side → skip:active (no reverse stacking)", () => {
    assert.equal(planTrancheAction({ ...base, openTranches: openAnchor, bestPacket: { ...anchorPacket, side: "short" } }).action, "skip:active");
  });
  it("manual, a position already open → skip:active", () => {
    assert.equal(planTrancheAction({ ...base, mode: "manual", openTranches: openAnchor }).action, "skip:active");
  });
});

describe("runTrancheManager guardrail integration", () => {
  it("auto-fire includes open drawdown in the predictive daily-loss gate", async () => {
    const skips = [];
    const result = await runTrancheManager({ bestPacket: { ...anchorPacket, symbol: "MNQ1!" } }, {
      readExecConfig: () => ({ automationMode: "auto", guards: { perTradeMax: 1000, dailyLimit: 600, defaultRisk: 250 } }),
      accountRoutable: () => ({ route: true }),
      autoAllowed: () => true,
      readJournal: async () => ({ events: [], open: [] }),
      consecutiveLossStreak: () => 0,
      sizePacket: () => ({ contracts: 1, riskUsd: 250, withinTolerance: true }),
      dayRealizedLossUsd: () => 300,
      openLossUsd: async () => 50,
      checkOrder,
      recordSkip: async (reason) => { skips.push(reason); },
      accept: async () => { throw new Error("accept should not run when daily halt blocks"); },
      openTrancheOrders: async () => { throw new Error("orders should not open when daily halt blocks"); },
    });

    assert.equal(result.action, "blocked:DAILY_HALT");
    assert.equal(result.gate.code, "DAILY_HALT");
    assert.deepEqual(skips, ["blocked:DAILY_HALT"]);
  });

  it("auto-fire blocks (fail-closed) when the trade store is unreadable", async () => {
    const skips = [];
    const result = await runTrancheManager({ bestPacket: { ...anchorPacket, symbol: "MNQ1!" } }, {
      readExecConfig: () => ({ automationMode: "auto", guards: { perTradeMax: 1000, dailyLimit: 600 } }),
      accountRoutable: () => ({ route: true }),
      autoAllowed: () => true,
      readJournal: async () => ({ events: [], open: [] }),
      consecutiveLossStreak: () => 0,
      dayFillsReadable: () => false, // genuine store read error
      sizePacket: () => ({ contracts: 1, riskUsd: 250, withinTolerance: true }),
      dayRealizedLossUsd: () => 0,
      openLossUsd: async () => 0,
      checkOrder,
      recordSkip: async (reason) => { skips.push(reason); },
      accept: async () => { throw new Error("accept must not run when the store is unreadable"); },
      openTrancheOrders: async () => { throw new Error("orders must not open"); },
    });
    assert.equal(result.action, "blocked:FILLS_UNREADABLE");
    assert.deepEqual(skips, ["blocked:FILLS_UNREADABLE"]);
  });

  it("suggest mode never fires — returns suggest before the account gate, no accept/order", async () => {
    let accepted = false;
    const r = await runTrancheManager({ bestPacket: { ...anchorPacket, symbol: "MNQ1!" } }, {
      readExecConfig: () => ({ automationMode: "suggest", guards: {} }),
      accountRoutable: () => { throw new Error("suggest must not reach the account gate"); },
      accept: async () => { accepted = true; return { id: "x" }; },
      openTrancheOrders: async () => { throw new Error("no order fires in suggest"); },
      recordSkip: async () => {},
    });
    assert.equal(r.action, "suggest");
    assert.equal(accepted, false);
  });
});

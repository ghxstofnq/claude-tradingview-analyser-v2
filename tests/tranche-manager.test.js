import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrder } from "../app/main/execution/guardrails.js";
import { planTrancheAction, runTrancheManager, tradovateOrderFromPacket } from "../app/main/execution/tranche-manager.js";

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
});

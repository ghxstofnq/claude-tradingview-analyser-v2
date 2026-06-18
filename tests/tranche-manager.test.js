import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planTrancheAction, tradovateOrderFromPacket } from "../app/main/execution/tranche-manager.js";

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
});

const anchorPacket = { side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: 120 };
const base = {
  bestPacket: anchorPacket, openTranches: [], price: 100, mode: "auto",
  maxAdds: 5, combinedCapUsd: null, openRiskUsd: 0, addRiskUsd: 120,
  addsDisabled: false, lossHalt: false, takenLog: [],
};
const greenAnchor = [{ id: "T-0001", tranche_role: "anchor", side: "long", greenLight: true, entry: 100, tp1: 110 }];

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
  it("anchor-auto-adds, no open trade → surface (human takes anchor)", () => {
    assert.equal(planTrancheAction({ ...base, mode: "anchor-auto-adds" }).action, "surface");
  });
  it("manual, no open trade → surface", () => {
    assert.equal(planTrancheAction({ ...base, mode: "manual" }).action, "surface");
  });
  it("open anchor (green-lit), same side, auto → open_add", () => {
    assert.equal(planTrancheAction({ ...base, openTranches: greenAnchor, price: 106 }).action, "open_add");
  });
  it("open anchor not green-lit → skip:not_greenlit", () => {
    const open = [{ ...greenAnchor[0], greenLight: false }];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 101 }).action, "skip:not_greenlit");
  });
  it("opposite-side packet while long open → skip:opposite", () => {
    assert.equal(planTrancheAction({ ...base, openTranches: greenAnchor, price: 106, bestPacket: { ...anchorPacket, side: "short" } }).action, "skip:opposite");
  });
  it("breaker on → blocked:breaker for an add", () => {
    assert.equal(planTrancheAction({ ...base, openTranches: greenAnchor, price: 106, addsDisabled: true }).action, "blocked:breaker");
  });
  it("at max adds → blocked:max_adds", () => {
    const open = [greenAnchor[0], ...Array(5).fill(0).map((_, i) => ({ id: `add${i}`, side: "long" }))];
    assert.equal(planTrancheAction({ ...base, openTranches: open, price: 106 }).action, "blocked:max_adds");
  });
  it("dup within window → skip:dup", () => {
    const takenLog = [{ side: "long", tp1: 110, ms: Date.now() }];
    assert.equal(planTrancheAction({ ...base, openTranches: greenAnchor, price: 106, takenLog, bestPacket: { ...anchorPacket, event_ts: new Date().toISOString() } }).action, "skip:dup");
  });
  it("combined cap hit → blocked:cap", () => {
    assert.equal(planTrancheAction({ ...base, openTranches: greenAnchor, price: 106, combinedCapUsd: 200, openRiskUsd: 120, addRiskUsd: 120 }).action, "blocked:cap");
  });
  it("anchor-auto-adds, green-lit add → open_add (adds auto in this mode)", () => {
    assert.equal(planTrancheAction({ ...base, mode: "anchor-auto-adds", openTranches: greenAnchor, price: 106 }).action, "open_add");
  });
  it("manual, green-lit add → surface (human accepts adds in manual)", () => {
    assert.equal(planTrancheAction({ ...base, mode: "manual", openTranches: greenAnchor, price: 106 }).action, "surface");
  });
});

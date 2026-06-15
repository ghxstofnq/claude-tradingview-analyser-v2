import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { brokerActionsForTranche, brokerActionsForTransition } from "../app/main/execution/tranche-exec.js";

describe("brokerActionsForTranche (open)", () => {
  it("entry market + standalone stop + standalone tp (B → tp1)", () => {
    const a = brokerActionsForTranche({ side: "long", grade: "B", contracts: 2, entry: 100, stop: 95, tp1: 110, tp2: 120, symbol: "MNQ1!" });
    assert.deepEqual(a.map((x) => x.kind), ["entry", "stop", "limit"]);
    assert.equal(a[2].price, 110); // B targets TP1
    assert.equal(a[1].side, "sell"); // exit side opposite a long
    assert.equal(a[0].contracts, 2);
  });
  it("A+ tranche targets TP2 on the resting limit", () => {
    const a = brokerActionsForTranche({ side: "long", grade: "A+", contracts: 1, entry: 100, stop: 95, tp1: 110, tp2: 120, symbol: "MNQ1!" });
    assert.equal(a[2].price, 120);
  });
  it("A+ with no TP2 room falls back to TP1 on the limit", () => {
    const a = brokerActionsForTranche({ side: "long", grade: "A+", contracts: 1, entry: 100, stop: 95, tp1: 110, tp2: null, symbol: "MNQ1!" });
    assert.equal(a[2].price, 110);
  });
  it("short tranche exits are buy orders", () => {
    const a = brokerActionsForTranche({ side: "short", grade: "B", contracts: 1, entry: 100, stop: 105, tp1: 90, tp2: 80, symbol: "MNQ1!" });
    assert.equal(a[1].side, "buy");
    assert.equal(a[2].side, "buy");
  });
});

describe("brokerActionsForTransition (manage)", () => {
  it("A+ TP1_HIT → modify that tranche's stop to break-even (entry)", () => {
    const a = brokerActionsForTransition({ status: "TP1_HIT", grade: "A+", entry: 100, stopOrderId: 42 });
    assert.deepEqual(a, [{ kind: "modify_stop", orderId: 42, price: 100 }]);
  });
  it("B TP1_HIT → no broker action (resting limit already exits)", () => {
    assert.deepEqual(brokerActionsForTransition({ status: "TP1_HIT", grade: "B" }), []);
  });
  it("STOPPED → cancel the sibling resting limit", () => {
    assert.deepEqual(brokerActionsForTransition({ status: "STOPPED", siblingOrderId: 7 }), [{ kind: "cancel", orderId: 7 }]);
  });
  it("TP2_HIT → cancel the sibling resting stop", () => {
    assert.deepEqual(brokerActionsForTransition({ status: "TP2_HIT", siblingOrderId: 9 }), [{ kind: "cancel", orderId: 9 }]);
  });
  it("CLOSED_EOD → market close the tranche qty + cancel both resting orders", () => {
    const a = brokerActionsForTransition({ status: "CLOSED_EOD", side: "long", contracts: 1, symbol: "MNQ1!", stopOrderId: 1, limitOrderId: 2 });
    assert.equal(a[0].kind, "close");
    assert.deepEqual(a.slice(1).map((x) => x.kind), ["cancel", "cancel"]);
  });
  it("unknown status → no action", () => {
    assert.deepEqual(brokerActionsForTransition({ status: "FILLED" }), []);
  });
});

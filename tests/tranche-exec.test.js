import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { brokerActionsForTranche, brokerActionsForTransition, planTrancheExit, applyTrancheExit } from "../app/main/execution/tranche-exec.js";

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
  it("runner TP1_HIT → modify that tranche's stop to break-even (entry)", () => {
    const a = brokerActionsForTransition({ status: "TP1_HIT", runner: true, entry: 100, stopOrderId: 42 });
    assert.deepEqual(a, [{ kind: "modify_stop", orderId: 42, price: 100 }]);
  });
  it("non-runner (B) TP1_HIT → cancel the orphaned stop sibling", () => {
    assert.deepEqual(brokerActionsForTransition({ status: "TP1_HIT", runner: false, siblingOrderId: 11 }), [{ kind: "cancel", orderId: 11 }]);
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

describe("planTrancheExit (journal lookup + sibling selection)", () => {
  const events = [
    { type: "accept", id: "T-1", side: "long", grade: "A+", entry: 100, tp1: 110, tp2: 120, size: { contracts: 1 }, symbol: "MNQ1!" },
    { type: "tranche_orders", setup_id: "T-1", stopOrderId: 11, limitOrderId: 22 },
  ];
  const bEvents = [
    { type: "accept", id: "T-2", side: "long", grade: "B", entry: 100, tp1: 110, tp2: 120, size: { contracts: 1 }, symbol: "MNQ1!" },
    { type: "tranche_orders", setup_id: "T-2", stopOrderId: 31, limitOrderId: 42 },
  ];
  it("returns null when the tranche has no standalone orders (manual trade)", () => {
    const manual = [{ type: "accept", id: "T-9", side: "long", grade: "B", entry: 100 }];
    assert.equal(planTrancheExit({ id: "T-9", status: "STOPPED" }, manual), null);
  });
  it("STOPPED → cancel the limit sibling", () => {
    const p = planTrancheExit({ id: "T-1", status: "STOPPED" }, events);
    assert.deepEqual(p.actions, [{ kind: "cancel", orderId: 22 }]);
  });
  it("TP2_HIT → cancel the stop sibling", () => {
    const p = planTrancheExit({ id: "T-1", status: "TP2_HIT" }, events);
    assert.deepEqual(p.actions, [{ kind: "cancel", orderId: 11 }]);
  });
  it("A+ runner TP1_HIT → modify the stop to break-even (keep the TP2 limit)", () => {
    const p = planTrancheExit({ id: "T-1", status: "TP1_HIT" }, events);
    assert.deepEqual(p.actions, [{ kind: "modify_stop", orderId: 11, price: 100 }]);
  });
  it("B TP1_HIT → cancel the orphaned stop (the limit filled at TP1)", () => {
    const p = planTrancheExit({ id: "T-2", status: "TP1_HIT" }, bEvents);
    assert.deepEqual(p.actions, [{ kind: "cancel", orderId: 31 }]);
  });
  it("latest tranche_orders marker wins (after a BE replacement)", () => {
    const withReplace = [...events, { type: "tranche_orders", setup_id: "T-1", stopOrderId: 33, limitOrderId: 22 }];
    const p = planTrancheExit({ id: "T-1", status: "STOPPED" }, withReplace);
    assert.deepEqual(p.actions, [{ kind: "cancel", orderId: 22 }]);
    assert.equal(p.orders.stopOrderId, 33);
  });
});

describe("applyTrancheExit (DI execution)", () => {
  const events = [
    { type: "accept", id: "T-1", side: "long", grade: "A+", entry: 100, tp1: 110, tp2: 120, size: { contracts: 1 }, symbol: "MNQ1!" },
    { type: "tranche_orders", setup_id: "T-1", stopOrderId: 11, limitOrderId: 22 },
  ];
  function makeDeps() {
    const calls = { cancel: [], flatten: [], place: [], record: [] };
    return {
      calls,
      readEvents: async () => events,
      cancelOrder: async (id) => { calls.cancel.push(id); },
      flatten: async (s) => { calls.flatten.push(s); },
      placeStandalone: async (o) => { calls.place.push(o); return 99; },
      recordTrancheOrders: async (o) => { calls.record.push(o); },
    };
  }
  it("STOPPED cancels the limit sibling", async () => {
    const d = makeDeps();
    await applyTrancheExit({ id: "T-1", status: "STOPPED" }, d);
    assert.deepEqual(d.calls.cancel, [22]);
  });
  it("A+ TP1_HIT cancels the old stop, places a BE stop, records the new id", async () => {
    const d = makeDeps();
    await applyTrancheExit({ id: "T-1", status: "TP1_HIT" }, d);
    assert.deepEqual(d.calls.cancel, [11]);
    assert.equal(d.calls.place[0].type, "stop");
    assert.equal(d.calls.place[0].price, 100);
    assert.equal(d.calls.record[0].stopOrderId, 99);
  });
  it("non-standalone trade → no broker calls", async () => {
    const d = makeDeps();
    d.readEvents = async () => [{ type: "accept", id: "T-9", side: "long", grade: "B", entry: 100 }];
    const r = await applyTrancheExit({ id: "T-9", status: "STOPPED" }, d);
    assert.equal(r.skipped, true);
    assert.equal(d.calls.cancel.length, 0);
  });
});

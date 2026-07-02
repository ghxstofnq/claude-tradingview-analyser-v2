// Regression for audit C12/C13/C24: a bracket must be atomic (no naked entry),
// a stop-move must confirm the new stop before cancelling the old, and broker
// rejections must not be silent.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateBracketResults, applyTrancheExit } from "../app/main/execution/tranche-exec.js";

const ok = (id) => ({ ok: true, status: 200, body: JSON.stringify({ id }) });
const rejected = (status = 400) => ({ ok: false, status, body: "rejected" });

describe("evaluateBracketResults (C13)", () => {
  it("entry ok + stop ok + limit ok → not naked", () => {
    const r = evaluateBracketResults([ok(1), ok(2), ok(3)]);
    assert.equal(r.naked, false);
    assert.equal(r.stopOrderId, 2);
    assert.equal(r.limitOrderId, 3);
  });
  it("entry ok but stop REJECTED → naked", () => {
    const r = evaluateBracketResults([ok(1), rejected(), ok(3)]);
    assert.equal(r.naked, true);
    assert.equal(r.stopOrderId, null);
  });
  it("entry ok, stop ok:true but no id came back → naked", () => {
    const r = evaluateBracketResults([ok(1), { ok: true, status: 200, body: "no-id" }, ok(3)]);
    assert.equal(r.naked, true);
  });
  it("a 401 on any leg flags auth loss", () => {
    assert.equal(evaluateBracketResults([rejected(401), ok(2), ok(3)]).authLost, true);
    assert.equal(evaluateBracketResults([ok(1), ok(2), ok(3)]).authLost, false);
  });
  it("entry itself rejected → not naked (nothing to protect)", () => {
    assert.equal(evaluateBracketResults([rejected(), rejected(), rejected()]).naked, false);
  });
});

describe("applyTrancheExit stop-move safety (C12)", () => {
  const events = [
    { type: "accept", id: "T-1", side: "long", grade: "A+", entry: 100, tp1: 110, tp2: 120, size: { contracts: 1 }, symbol: "MNQ1!" },
    { type: "tranche_orders", setup_id: "T-1", stopOrderId: 11, limitOrderId: 22 },
  ];
  function deps(placeReturns) {
    const calls = { cancel: [], place: [], flatten: [], record: [], errors: [] };
    return {
      calls,
      readEvents: async () => events,
      cancelOrder: async (id) => { calls.cancel.push(id); },
      flatten: async (s) => { calls.flatten.push(s); },
      placeStandalone: async (o) => { calls.place.push(o); return placeReturns; },
      recordTrancheOrders: async (o) => { calls.record.push(o); },
      emitError: (o) => { calls.errors.push(o); },
    };
  }
  it("BE move places the new stop BEFORE cancelling the old, then records it", async () => {
    const d = deps(99);
    await applyTrancheExit({ id: "T-1", status: "TP1_HIT" }, d);
    assert.equal(d.calls.place.length, 1);          // new stop placed
    assert.deepEqual(d.calls.cancel, [11]);         // old stop cancelled after
    assert.equal(d.calls.record[0].stopOrderId, 99);
  });
  it("if the new stop fails to place, keep the ORIGINAL stop and do NOT flatten", async () => {
    const d = deps(null); // placement returns no id
    const r = await applyTrancheExit({ id: "T-1", status: "TP1_HIT" }, d);
    assert.deepEqual(d.calls.cancel, [], "must NOT cancel the live stop when the replacement failed");
    assert.deepEqual(d.calls.flatten, [], "must NOT flatten — the original stop still protects the runner, and flatten would orphan the TP limit");
    assert.equal(r.error, "modify_stop_failed");
    assert.equal(r.stopKept, true);
    assert.equal(d.calls.errors.length, 1);
  });
});

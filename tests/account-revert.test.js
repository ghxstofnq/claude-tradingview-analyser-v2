// tests/account-revert.test.js — revert-to-SIM pure decision + fail-closed rules
// + post-revert routing/UI invariants. No broker calls, no order placement.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { paperConfirmTarget, revertSimDecision, resolveAccountGate } from "../app/main/execution/account-gate.js";
import { realAccountView } from "../app/renderer/src/Account.helpers.js";

describe("paperConfirmTarget", () => {
  it("reuses an already-paper active account verbatim (routes immediately)", () => {
    const active = { id: "P1", type: "paper", broker: "paper" };
    assert.equal(paperConfirmTarget({ active, config: {} }), active);
  });
  it("synthesizes a paper target from a live active — never the live id", () => {
    const t = paperConfirmTarget({ active: { id: "LIVE9", type: "live", broker: "tradovate" }, config: { paperAccountId: "P7", paperHost: "h" } });
    assert.equal(t.type, "paper");
    assert.equal(t.id, "P7");
    assert.notEqual(t.id, "LIVE9");
  });
  it("null paperAccountId → id null, still paper", () => {
    const t = paperConfirmTarget({ active: { type: "live", broker: "tradovate" }, config: {} });
    assert.equal(t.type, "paper");
    assert.equal(t.id, null);
  });
});

describe("revertSimDecision (fail-closed)", () => {
  const live = { type: "live", broker: "tradovate", id: "L1" };
  it("reverting from live + open position + no force → block live_position_open (no write)", () => {
    const d = revertSimDecision({ active: live, confirmed: live, positionOpen: true, force: false });
    assert.equal(d.block, true);
    assert.equal(d.reason, "live_position_open");
    assert.equal(d.writePatch, undefined);
  });
  it("position read failed (null) + no force → block position_read_failed (never assume flat)", () => {
    const d = revertSimDecision({ active: live, confirmed: live, positionOpen: null, force: false });
    assert.equal(d.block, true);
    assert.equal(d.reason, "position_read_failed");
  });
  it("force overrides the block, warns of a stranded position, writes ONLY confirmedAccount", () => {
    const d = revertSimDecision({ active: live, confirmed: live, positionOpen: true, force: true });
    assert.equal(d.block, false);
    assert.equal(d.warned, "live_position_open_stranded");
    assert.equal(d.clearAutoResumed, true);
    assert.deepEqual(Object.keys(d.writePatch), ["confirmedAccount"]); // guards/liveHost untouched
  });
  it("reverting from paper never blocks (already sim, zero risk)", () => {
    const paper = { type: "paper", broker: "paper", id: "P1" };
    const d = revertSimDecision({ active: paper, confirmed: paper, positionOpen: true, force: false });
    assert.equal(d.block, false);
  });
  it("post-revert invariant: gate routes + UI shows paper", () => {
    const paperActive = { id: "P1", type: "paper", broker: "paper" };
    const confirmed = paperConfirmTarget({ active: paperActive, config: {} });
    assert.equal(resolveAccountGate({ active: paperActive, confirmed }).route, true);
    assert.equal(realAccountView({ active: paperActive, confirmed }).live, false);
  });
});

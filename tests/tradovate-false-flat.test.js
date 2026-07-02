// Regression for audit C11: a transient Tradovate read failure must NOT be
// read as a closed position (which booked a phantom fill and abandoned the
// live position). Book only on a debounced, confirmed flat, and never twice.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planTradovateFillTransition, roundTripKey } from "../app/main/execution/tradovate-fills.js";

describe("planTradovateFillTransition (C11)", () => {
  it("read failure with an open trade → skip, never infer flat", () => {
    const p = planTradovateFillTransition({ readOk: false, hasPosition: false, hasOpenTrade: true, flatReads: 0 });
    assert.equal(p.action, "skip_read_error");
    assert.equal(p.flatReads, 0, "a failed read must not advance the flat counter");
  });

  it("position present → track and reset the flat counter", () => {
    const p = planTradovateFillTransition({ readOk: true, hasPosition: true, hasOpenTrade: true, flatReads: 1 });
    assert.equal(p.action, "track_open");
    assert.equal(p.flatReads, 0);
  });

  it("a single confirmed flat is NOT enough to book — it waits for confirmation", () => {
    const p = planTradovateFillTransition({ readOk: true, hasPosition: false, hasOpenTrade: true, flatReads: 0 });
    assert.equal(p.action, "await_confirm");
    assert.equal(p.flatReads, 1);
  });

  it("two consecutive confirmed flats → reached_flat (book)", () => {
    const p = planTradovateFillTransition({ readOk: true, hasPosition: false, hasOpenTrade: true, flatReads: 1 });
    assert.equal(p.action, "reached_flat");
  });

  it("an error read BETWEEN two flats resets nothing but also can't count — no phantom close", () => {
    // flat(1) → error(skip, still 1) → flat would need to reach 2
    let s = planTradovateFillTransition({ readOk: true, hasPosition: false, hasOpenTrade: true, flatReads: 0 });
    assert.equal(s.action, "await_confirm"); // flatReads now 1
    s = planTradovateFillTransition({ readOk: false, hasPosition: false, hasOpenTrade: true, flatReads: s.flatReads });
    assert.equal(s.action, "skip_read_error");
    assert.equal(s.flatReads, 1, "error did not advance toward a close");
  });

  it("flat with nothing open → idle", () => {
    assert.equal(planTradovateFillTransition({ readOk: true, hasPosition: false, hasOpenTrade: false, flatReads: 0 }).action, "idle");
  });
});

describe("roundTripKey (dedup)", () => {
  it("same round-trip → same key (no double booking)", () => {
    const rt = { closeMs: 1781649391000, qty: 7, entry: 100, exit: 110 };
    assert.equal(roundTripKey(rt, "MNQU6"), roundTripKey(rt, "MNQU6"));
  });
  it("different close → different key", () => {
    assert.notEqual(
      roundTripKey({ closeMs: 1, qty: 1, entry: 1, exit: 2 }, "MNQU6"),
      roundTripKey({ closeMs: 2, qty: 1, entry: 1, exit: 2 }, "MNQU6"),
    );
  });
});

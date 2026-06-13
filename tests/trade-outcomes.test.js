import { test } from "node:test";
import assert from "node:assert/strict";
import { tickTrades, foldOpenTrades, closeTradesAtEod } from "../cli/lib/trade-outcomes.js";

const baseLong = {
  id: "T-1", side: "long", state: "pending_entry",
  entry: 100, stop: 95, tp1: 110, tp2: 120, invalidation: 90,
};

// ── 4:00 PM forced close (user ruling 2026-06-13) ──────────────────────
test("closeTradesAtEod: filled long closes at the bar close with signed R", () => {
  const trade = { ...baseLong, state: "filled" };            // risk 5
  const out = closeTradesAtEod([trade], { close: 107.5, ts: "16:00" }); // +7.5 = +1.5R
  assert.equal(out.transitions[0].status, "CLOSED_EOD");
  assert.equal(out.transitions[0].exit, 107.5);
  assert.equal(out.transitions[0].r_realized, 1.5);
  assert.equal(out.updated[0].state, "closed");
  assert.equal(out.updated[0].outcome, "CLOSED_EOD");
});

test("closeTradesAtEod: filled long underwater books a partial loss, not -1R", () => {
  const out = closeTradesAtEod([{ ...baseLong, state: "filled" }], { close: 98, ts: "16:00" }); // -2 = -0.4R
  assert.equal(out.transitions[0].r_realized, -0.4);
});

test("closeTradesAtEod: a resting (unfilled) order is cancelled, not exited", () => {
  const out = closeTradesAtEod([{ ...baseLong, state: "pending_entry" }], { close: 103, ts: "16:00" });
  assert.equal(out.transitions[0].status, "EXPIRED_EOD");
  assert.equal(out.transitions[0].exit, undefined);
  assert.equal(out.updated[0].state, "closed");
});

test("closeTradesAtEod: a runner (TP1 hit, stop at BE) books R off the ORIGINAL risk", () => {
  // After TP1, stop moved to entry (100) and orig_stop retained (95, risk 5).
  const runner = { ...baseLong, state: "filled", tp1_hit: true, stop: 100, orig_stop: 95 };
  const out = closeTradesAtEod([runner], { close: 115, ts: "16:00" }); // +15 / 5 = +3R
  assert.equal(out.transitions[0].r_realized, 3);
});

test("foldOpenTrades: CLOSED_EOD / EXPIRED_EOD remove the trade from the open set", () => {
  const open = foldOpenTrades([
    { type: "accept", id: "A", side: "long", entry: 100, stop: 95, tp1: 110, tp2: 120 },
    { type: "outcome", id: "A", status: "FILLED" },
    { type: "outcome", id: "A", status: "CLOSED_EOD", exit: 104 },
    { type: "accept", id: "B", side: "long", entry: 100, stop: 95, tp1: 110, tp2: 120 },
    { type: "outcome", id: "B", status: "EXPIRED_EOD" },
  ]);
  assert.equal(open.length, 0);
});

test("foldOpenTrades: TP1_HIT retains orig_stop for a later EOD close", () => {
  const open = foldOpenTrades([
    { type: "accept", id: "A", side: "long", entry: 100, stop: 95, tp1: 110, tp2: 120 },
    { type: "outcome", id: "A", status: "FILLED" },
    { type: "outcome", id: "A", status: "TP1_HIT" },
  ]);
  assert.equal(open[0].orig_stop, 95);
  assert.equal(open[0].stop, 100); // moved to break-even
});

test("pending → FILLED when bar crosses entry", () => {
  const out = tickTrades([baseLong], { high: 101, low: 99, ts: "T" });
  assert.equal(out.transitions[0].status, "FILLED");
  assert.equal(out.updated[0].state, "filled");
});

test("pending → INVALIDATED when bar crosses invalidation", () => {
  const out = tickTrades([baseLong], { high: 92, low: 89, ts: "T" });
  assert.equal(out.transitions[0].status, "INVALIDATED");
});

test("filled long → TP1_HIT pulls stop to break-even", () => {
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { high: 111, low: 105, ts: "T" });
  assert.equal(out.transitions[0].status, "TP1_HIT");
  assert.equal(out.transitions[0].r_realized, 2);
  assert.equal(out.updated[0].stop, 100);
  assert.equal(out.updated[0].tp1_hit, true);
});

test("filled long → STOPPED when bar.low ≤ stop", () => {
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { high: 101, low: 94, ts: "T" });
  assert.equal(out.transitions[0].status, "STOPPED");
});

test("same-bar entry-and-stop → FILLED then STOPPED (conservative)", () => {
  const out = tickTrades([baseLong], { high: 102, low: 94, ts: "T" });
  assert.equal(out.transitions[0].status, "FILLED");
  assert.equal(out.transitions[1].status, "STOPPED");
  assert.equal(out.updated[0].state, "closed");
});

test("filled long → TP1+TP2 same bar both fire", () => {
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { high: 125, low: 105, ts: "T" });
  assert.equal(out.transitions[0].status, "TP1_HIT");
  assert.equal(out.transitions[1].status, "TP2_HIT");
  assert.equal(out.updated[0].state, "closed");
});

test("filled long → same-bar TP1+stop, open close to TP1 → favor TP1", () => {
  // Open near TP1, so price likely went up first.
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { open: 109, high: 112, low: 94, ts: "T" });
  assert.equal(out.transitions[0].status, "TP1_HIT");
  // After TP1, stop moves to BE (entry=100). Bar.low 94 IS below BE, so... well
  // we don't fire stop in same bar after TP1 (current behavior). Just verify TP1.
});

test("filled long → same-bar TP1+stop, open close to stop → favor STOPPED", () => {
  // Open near stop, so price likely went down first.
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { open: 96, high: 112, low: 94, ts: "T" });
  assert.equal(out.transitions[0].status, "STOPPED");
  assert.equal(out.updated[0].outcome, "STOPPED");
});

test("filled long → same-bar TP1+stop, no bar.open → fall back to STOPPED", () => {
  // Conservative fallback when open is absent (e.g. very old bar event).
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { high: 112, low: 94, ts: "T" });
  assert.equal(out.transitions[0].status, "STOPPED");
});

test("filled long → bar gaps below stop → STOPPED regardless of TP1 reach", () => {
  // Bar opens BELOW stop (gap down). Even if it later rallies into TP1
  // range, the stop already triggered on the gap. Don't credit TP1.
  const trade = { ...baseLong, state: "filled" };
  const out = tickTrades([trade], { open: 92, high: 112, low: 91, ts: "T" });
  assert.equal(out.transitions[0].status, "STOPPED");
  assert.equal(out.updated[0].outcome, "STOPPED");
});

test("filled short → bar gaps above stop → STOPPED regardless of TP1 reach", () => {
  const trade = { ...baseLong, side: "short", state: "filled",
    entry: 100, stop: 105, tp1: 90, tp2: 80, invalidation: 110 };
  const out = tickTrades([trade], { open: 108, high: 109, low: 88, ts: "T" });
  assert.equal(out.transitions[0].status, "STOPPED");
});

test("pending → same-bar FILLED + TP1_HIT (rapid breakout)", () => {
  // Bar crosses entry AND tp1 in one print — common on a breakout
  // candle. Was untested. tickTrades' pending-state branch transitions
  // pending → filled, then the next iteration through filled should
  // catch TP1. But we only run ONE iteration per call, so TP1 fires
  // on the NEXT bar. Current behavior: only FILLED transition.
  const out = tickTrades([baseLong], { open: 99, high: 112, low: 99, ts: "T" });
  // Pending state only fires FILLED in this iteration — TP1 needs a
  // subsequent bar (or a refold + re-tick).
  assert.equal(out.transitions[0].status, "FILLED");
  assert.equal(out.updated[0].state, "filled");
  assert.equal(out.transitions.length, 1, "only FILLED fires in pending-state iteration");
});

test("rMultiple returns null on entry===stop (no division by zero)", () => {
  const trade = { ...baseLong, state: "filled", entry: 100, stop: 100 };
  const out = tickTrades([trade], { high: 112, low: 100, ts: "T" });
  // TP1 fires; r_realized should be null, not 0 (silent lie) or Infinity.
  assert.equal(out.transitions[0].r_realized, null);
});

test("short symmetric — pending → FILLED when bar.low ≤ entry", () => {
  const short = { ...baseLong, side: "short", entry: 100, stop: 105, tp1: 90, tp2: 80, invalidation: 110 };
  const out = tickTrades([short], { high: 101, low: 99, ts: "T" });
  assert.equal(out.transitions[0].status, "FILLED");
});

test("short filled → TP1_HIT when bar.low ≤ tp1", () => {
  const short = { ...baseLong, side: "short", state: "filled", entry: 100, stop: 105, tp1: 90, tp2: 80, invalidation: 110 };
  const out = tickTrades([short], { high: 95, low: 88, ts: "T" });
  assert.equal(out.transitions[0].status, "TP1_HIT");
  assert.equal(out.transitions[0].r_realized, 2);
});

test("foldOpenTrades collapses an event log", () => {
  const events = [
    { type: "accept", id: "T-1", side: "long", entry: 100, stop: 95, tp1: 110, tp2: 120, invalidation: 90 },
    { type: "outcome", id: "T-1", status: "FILLED" },
    { type: "accept", id: "T-2", side: "short", entry: 50, stop: 55, tp1: 40, tp2: 30, invalidation: 60 },
    { type: "outcome", id: "T-2", status: "STOPPED" },
  ];
  const open = foldOpenTrades(events);
  assert.equal(open.length, 1);
  assert.equal(open[0].id, "T-1");
  assert.equal(open[0].state, "filled");
});

test("foldOpenTrades — TP1_HIT pulls stop to entry but trade stays open", () => {
  const events = [
    { type: "accept", id: "T-1", side: "long", entry: 100, stop: 95, tp1: 110, tp2: 120, invalidation: 90 },
    { type: "outcome", id: "T-1", status: "FILLED" },
    { type: "outcome", id: "T-1", status: "TP1_HIT" },
  ];
  const open = foldOpenTrades(events);
  assert.equal(open.length, 1);
  assert.equal(open[0].stop, 100);     // moved to break-even
  assert.equal(open[0].tp1_hit, true);
});

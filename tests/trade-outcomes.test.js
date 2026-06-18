import { test } from "node:test";
import assert from "node:assert/strict";
import { tickTrades, foldOpenTrades, closeTradesAtEod, consecutiveLossStreak, closeTradesAtBrokerExit } from "../cli/lib/trade-outcomes.js";

// Symbol-root matcher used in production (MNQ1! / MNQU6 → MNQ).
const rootOf = (s) => (String(s || "").toUpperCase().match(/(MNQ|MES)/) || [])[1] || null;

// A+ so the runner path (TP1 → BE → TP2) is exercised; tp2 120 sits beyond
// tp1 110. A B-grade trade banks fully at TP1 (covered separately below).
const baseLong = {
  id: "T-1", side: "long", state: "pending_entry", grade: "A+",
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

test("foldOpenTrades: an A+ TP1_HIT arms a runner and retains orig_stop", () => {
  const open = foldOpenTrades([
    { type: "accept", id: "A", side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: 120 },
    { type: "outcome", id: "A", status: "FILLED" },
    { type: "outcome", id: "A", status: "TP1_HIT" },
  ]);
  assert.equal(open[0].orig_stop, 95);
  assert.equal(open[0].stop, 100); // moved to break-even
});

// consecutiveLossStreak — the live 3-loss halt input (user ruling 2026-06-13).
test("consecutiveLossStreak: 3 stops in a row → 3", () => {
  const ev = [
    { type: "outcome", id: "a", status: "STOPPED", ts: "01" },
    { type: "outcome", id: "b", status: "STOPPED", ts: "02" },
    { type: "outcome", id: "c", status: "STOPPED", ts: "03" },
  ];
  assert.equal(consecutiveLossStreak(ev), 3);
});

test("consecutiveLossStreak: a win resets the streak", () => {
  const ev = [
    { type: "outcome", id: "a", status: "STOPPED", ts: "01" },
    { type: "outcome", id: "b", status: "STOPPED", ts: "02" },
    { type: "outcome", id: "c", status: "TP1_HIT", ts: "03" },
    { type: "outcome", id: "d", status: "STOPPED", ts: "04" },
  ];
  assert.equal(consecutiveLossStreak(ev), 1);
});

test("consecutiveLossStreak: a 16:00 close underwater counts; in profit doesn't", () => {
  assert.equal(consecutiveLossStreak([
    { type: "outcome", id: "a", status: "STOPPED", ts: "01" },
    { type: "outcome", id: "b", status: "CLOSED_EOD", r_realized: -0.4, ts: "02" },
  ]), 2);
  assert.equal(consecutiveLossStreak([
    { type: "outcome", id: "a", status: "STOPPED", ts: "01" },
    { type: "outcome", id: "b", status: "CLOSED_EOD", r_realized: 1.2, ts: "02" },
  ]), 0);
});

test("foldOpenTrades: a B TP1_HIT closes the trade (no runner)", () => {
  const open = foldOpenTrades([
    { type: "accept", id: "A", side: "long", grade: "B", entry: 100, stop: 95, tp1: 110, tp2: 120 },
    { type: "outcome", id: "A", status: "FILLED" },
    { type: "outcome", id: "A", status: "TP1_HIT" },
  ]);
  assert.equal(open.length, 0); // closed at TP1
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

test("filled A+ long → TP1_HIT arms the runner (stop to break-even, milestone R)", () => {
  const trade = { ...baseLong, state: "filled" }; // A+ → runs to TP2
  const out = tickTrades([trade], { high: 111, low: 105, ts: "T" });
  assert.equal(out.transitions[0].status, "TP1_HIT");
  assert.equal(out.transitions[0].r_realized, null); // milestone — R realized only at TP2/BE
  assert.equal(out.updated[0].stop, 100);
  assert.equal(out.updated[0].tp1_hit, true);
});

test("filled B long → TP1_HIT closes the full position (no runner)", () => {
  const trade = { ...baseLong, grade: "B", state: "filled" };
  const out = tickTrades([trade], { high: 111, low: 105, ts: "T" });
  assert.equal(out.transitions[0].status, "TP1_HIT");
  assert.equal(out.transitions[0].r_realized, 2); // banked at TP1
  assert.equal(out.updated[0].state, "closed");
  assert.equal(out.updated[0].outcome, "TP1_HIT");
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

test("short filled (B) → TP1_HIT banks at TP1 when bar.low ≤ tp1", () => {
  const short = { ...baseLong, grade: "B", side: "short", state: "filled", entry: 100, stop: 105, tp1: 90, tp2: 80, invalidation: 110 };
  const out = tickTrades([short], { high: 95, low: 88, ts: "T" });
  assert.equal(out.transitions[0].status, "TP1_HIT");
  assert.equal(out.transitions[0].r_realized, 2);
  assert.equal(out.updated[0].state, "closed");
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

test("foldOpenTrades — an A+ TP1_HIT pulls stop to entry but trade stays open", () => {
  const events = [
    { type: "accept", id: "T-1", side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, tp2: 120, invalidation: 90 },
    { type: "outcome", id: "T-1", status: "FILLED" },
    { type: "outcome", id: "T-1", status: "TP1_HIT" },
  ];
  const open = foldOpenTrades(events);
  assert.equal(open.length, 1);
  assert.equal(open[0].stop, 100);     // moved to break-even
  assert.equal(open[0].tp1_hit, true);
});

// ── Real broker exit reconcile (user ruling 2026-06-18) ────────────────
test("closeTradesAtBrokerExit: matching open short closes at the real fill with signed R", () => {
  // short, risk 81.75 (entry 30402, stop 30483.75); real exit 30340 = +0.76R
  const t = { id: "T-1", symbol: "MNQ1!", side: "short", state: "filled", entry: 30402, stop: 30483.75 };
  const out = closeTradesAtBrokerExit([t], { instrument: "MNQU6", exit: 30340, side: "short", rootOf });
  assert.equal(out.transitions.length, 1);
  assert.equal(out.transitions[0].status, "CLOSED_BROKER");
  assert.equal(out.transitions[0].exit, 30340);
  assert.equal(out.transitions[0].r_realized, 0.76);
  assert.equal(out.updated[0].state, "closed");
  assert.equal(out.updated[0].outcome, "CLOSED_BROKER");
});

test("closeTradesAtBrokerExit: a BE-stop tap books ~0R off ORIGINAL risk, not the original-stop loss", () => {
  // TP1 already armed the runner: orig_stop retained, live stop at entry (BE).
  const t = { id: "T-1", symbol: "MNQ1!", side: "short", state: "filled", entry: 30402, stop: 30402, orig_stop: 30483.75, tp1_hit: true };
  const out = closeTradesAtBrokerExit([t], { instrument: "MNQU6", exit: 30402, side: "short", rootOf });
  assert.equal(out.transitions[0].r_realized, 0);   // scratch, not -1
});

test("closeTradesAtBrokerExit: an opposite-side manual scalp does NOT close the open setup", () => {
  const t = { id: "T-1", symbol: "MNQ1!", side: "short", state: "filled", entry: 30402, stop: 30483.75 };
  const out = closeTradesAtBrokerExit([t], { instrument: "MNQU6", exit: 30340, side: "long", rootOf });
  assert.equal(out.transitions.length, 0);
  assert.equal(out.updated[0].state, "filled");     // still open
});

test("closeTradesAtBrokerExit: a different-root round-trip (MES) leaves an MNQ trade open", () => {
  const t = { id: "T-1", symbol: "MNQ1!", side: "short", state: "filled", entry: 30402, stop: 30483.75 };
  const out = closeTradesAtBrokerExit([t], { instrument: "MESU6", exit: 7540, side: "short", rootOf });
  assert.equal(out.transitions.length, 0);
});

test("closeTradesAtBrokerExit: a symbol-less legacy trade matches on side alone", () => {
  const t = { id: "T-1", side: "short", state: "filled", entry: 30402, stop: 30483.75 };
  const out = closeTradesAtBrokerExit([t], { instrument: "MNQU6", exit: 30340, side: "short", rootOf });
  assert.equal(out.transitions.length, 1);
  assert.equal(out.transitions[0].status, "CLOSED_BROKER");
});

test("foldOpenTrades treats CLOSED_BROKER as terminal", () => {
  const events = [
    { type: "accept", id: "T-1", symbol: "MNQ1!", side: "short", entry: 30402, stop: 30483.75 },
    { type: "outcome", status: "FILLED", id: "T-1" },
    { type: "outcome", status: "CLOSED_BROKER", id: "T-1", exit: 30340, r_realized: 0.76 },
  ];
  assert.equal(foldOpenTrades(events).length, 0);
});

test("consecutiveLossStreak: a CLOSED_BROKER below water counts as a loss; a scratch resets", () => {
  assert.equal(consecutiveLossStreak([
    { type: "outcome", status: "CLOSED_BROKER", ts: "1", r_realized: -1 },
    { type: "outcome", status: "CLOSED_BROKER", ts: "2", r_realized: -0.5 },
  ]), 2);
  assert.equal(consecutiveLossStreak([
    { type: "outcome", status: "CLOSED_BROKER", ts: "1", r_realized: -1 },
    { type: "outcome", status: "CLOSED_BROKER", ts: "2", r_realized: 0 },   // BE scratch resets
  ]), 0);
});

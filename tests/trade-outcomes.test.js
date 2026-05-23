import { test } from "node:test";
import assert from "node:assert/strict";
import { tickTrades, foldOpenTrades } from "../cli/lib/trade-outcomes.js";

const baseLong = {
  id: "T-1", side: "long", state: "pending_entry",
  entry: 100, stop: 95, tp1: 110, tp2: 120, invalidation: 90,
};

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

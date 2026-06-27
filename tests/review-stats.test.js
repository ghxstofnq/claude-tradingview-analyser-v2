// Slice 4 — computeStats rolls up per-session Lanto faithfulness (faithful /
// faithful_rate) using the same pure helper the SESSION ledger uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats } from "../app/main/review.js";

const pillars = (p1, p2, p3) => [
  { name: "Pillar 1", verdict: `${p1} · gate` },
  { name: "Pillar 2", verdict: `${p2} · gate` },
  { name: "Pillar 3", verdict: `${p3} · confirmation` },
];

const faithfulMss = {
  model: "MSS", side: "short", entry: 21000, stop: 21030, tp1: 20900, tp1_cite: "PWL",
  stop_cite: "swing_high", grade: "B", pillar_breakdown: pillars("PASS", "PASS", "PASS"),
  executionPacket: { entry: { rawPayload: {
    confirm_close: true, confirm_dir: "bear", ce_held: true, chop_15m: false, source: "engine" } } },
};

const deviationInv = {
  model: "Inversion", side: "long", entry: 29862.75, stop: 29726.75, tp1: 30699.75,
  tp1_cite: "session_history", stop_cite: "bars.last_5_bars[extreme]", grade: "B",
  pillar_breakdown: pillars("PASS", "PASS", "PASS"),
  executionPacket: { entry: { rawPayload: {
    confirm_close: true, confirm_dir: "bull", ce_held: true, chop_15m: false,
    source: "violation_close_bridge" } } },
};

test("computeStats rolls up faithful count + rate over gradable setups", () => {
  const s = computeStats([faithfulMss, deviationInv], []);
  assert.equal(s.setups, 2);
  assert.equal(s.gradable, 2);
  assert.equal(s.faithful, 1);          // MSS faithful; Inversion deviates (stop)
  assert.equal(s.faithful_rate, 0.5);
});

test("no gradable setups -> faithful_rate null, no throw", () => {
  const s = computeStats([{ type: "tranche_skip" }], []);
  assert.equal(s.gradable, 0);
  assert.equal(s.faithful, 0);
  assert.equal(s.faithful_rate, null);
});

// Slice 1 — per-trade Lanto faithfulness verdict (pure helper).
// Every status must trace to a real field on the setup / executionPacket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFaithfulness } from "../app/renderer/src/Review.helpers.js";

const pillars = (p1, p2, p3) => [
  { name: "Pillar 1", verdict: `${p1} · deterministic context gate`, elements: [] },
  { name: "Pillar 2", verdict: `${p2} · deterministic quality gate`, elements: [] },
  { name: "Pillar 3", verdict: `${p3} · confirmation`, elements: [] },
];

// A — clean MSS short: all gates pass, structural stop, named draw, engine confirm.
const cleanMss = {
  model: "MSS", side: "short", entry: 21000, stop: 21030, tp1: 20900, tp1_cite: "PWL",
  stop_cite: "swing_high", grade: "A+",
  pillar_breakdown: pillars("PASS", "PASS", "PASS"),
  executionPacket: { model_class: "Reversal", entry: { rawPayload: {
    confirm_close: true, confirm_dir: "bear", ce_held: true, chop_15m: false, source: "engine" } } },
};

// B — the real 2026-06-24 Inversion long (entry/stop/cites from the live record).
const inv0624 = {
  model: "Inversion", side: "long", entry: 29862.75, stop: 29726.75, tp1: 30699.75,
  tp1_cite: "session_history", stop_cite: "bars.last_5_bars[extreme]", grade: "B",
  pillar_breakdown: pillars("PASS", "PASS", "PASS"),
  executionPacket: { model_class: "Continuation", entry: { rawPayload: {
    confirm_close: true, confirm_dir: "bull", ce_held: true, chop_15m: false,
    source: "violation_close_bridge", zone_top: 29851, zone_bottom: 29849.25 } } },
};

// C — non-setup record (tranche_skip) — nothing to grade.
const skip = { type: "tranche_skip", reason: "one position at a time" };

// D — quality passes but 15m is chop → price-action soft.
const choppy = {
  ...cleanMss,
  executionPacket: { entry: { rawPayload: {
    confirm_close: true, confirm_dir: "bear", ce_held: true, chop_15m: true, source: "engine" } } },
};

// E — Pillar 3 fails → entry-model deviation.
const noConfirm = { ...cleanMss, pillar_breakdown: pillars("PASS", "PASS", "FAIL") };

test("clean MSS short is fully faithful", () => {
  const f = computeFaithfulness(cleanMss);
  assert.deepEqual(f.marks, ["pass", "pass", "pass"]);
  assert.equal(f.stop.status, "pass");
  assert.equal(f.draw.status, "pass");
  assert.equal(f.summary.faithful, true);
  assert.equal(f.summary.deviations, 0);
});

test("06-24 Inversion: entry soft (bridge), stop deviation (swing-extreme), draw soft (session_history)", () => {
  const f = computeFaithfulness(inv0624);
  assert.equal(f.bias.status, "pass");
  assert.equal(f.priceAction.status, "pass");
  assert.equal(f.entryModel.status, "soft");        // violation_close_bridge
  assert.equal(f.stop.status, "deviation");          // Inversion + non-zone cite
  assert.match(f.stop.detail, /136pt/);              // |29862.75 - 29726.75|
  assert.equal(f.draw.status, "soft");               // session_history, not a named draw
  assert.equal(f.summary.faithful, false);
  assert.equal(f.summary.deviations, 1);
  assert.equal(f.summary.softs, 2);
});

test("non-setup record grades to all 'na', not a fabricated pass", () => {
  const f = computeFaithfulness(skip);
  assert.deepEqual(f.marks, ["na", "na", "na"]);
  assert.equal(f.summary.gradable, false);
  assert.equal(f.summary.faithful, false);
});

test("15m chop downgrades price-action to soft", () => {
  const f = computeFaithfulness(choppy);
  assert.equal(f.priceAction.status, "soft");
});

test("failed Pillar 3 is an entry-model deviation", () => {
  const f = computeFaithfulness(noConfirm);
  assert.equal(f.entryModel.status, "deviation");
});

test("missing brief never throws; bias still grades from Pillar 1", () => {
  const f = computeFaithfulness(cleanMss, null, null);
  assert.equal(f.bias.status, "pass");
});

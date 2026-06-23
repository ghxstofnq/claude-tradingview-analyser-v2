import { test } from "node:test";
import assert from "node:assert/strict";
import { smtLeaderEvidence } from "../cli/lib/smt-leader-evidence.js";

const pair = { primary: "MNQ1!", secondary: "MES1!" };

test("smtLeaderEvidence: a divergence result carries leader + bias_dir + cite paths", () => {
  const smt = {
    divergence: true, bias_dir: "short", leader: "MES1!", gap: 1.12, band: 0.25,
    reason: "smt_divergence", context: "high",
    strengths: { "MNQ1!": 0.7, "MES1!": -0.42 },
    criteria: { data_present: true, pivots_confirmed: true, signs_oppose: true, gap_cleared: true },
    evidence: { "MNQ1!": { pivot_cite: "engine.swings[3]" }, "MES1!": { pivot_cite: "engine.swings[5]" } },
  };
  const e = smtLeaderEvidence(smt, pair);
  assert.equal(e.method, "smt");
  assert.equal(e.leader, "MES1!");
  assert.equal(e.bias_dir, "short");
  assert.equal(e.divergence, true);
  assert.equal(e.reason, "smt_divergence");
  assert.equal(e.primary_pivot_path, "pair.symbols.MNQ1!.engine.swings");
  assert.equal(e.secondary_pivot_path, "pair.symbols.MES1!.engine.swings");
});

test("smtLeaderEvidence: no-divergence → leader null, reason preserved (caller defaults primary)", () => {
  const smt = { divergence: false, bias_dir: null, leader: null, gap: 0.1, reason: "no_divergence_measured", evidence: {} };
  const e = smtLeaderEvidence(smt, pair);
  assert.equal(e.leader, null);
  assert.equal(e.divergence, false);
  assert.equal(e.reason, "no_divergence_measured");
  assert.equal(e.primary_pivot_path, null);
});

test("smtLeaderEvidence: unreadable → leader null, smt_unreadable_data", () => {
  const smt = { divergence: false, bias_dir: null, leader: null, gap: null, reason: "smt_unreadable_data", evidence: {} };
  assert.equal(smtLeaderEvidence(smt, pair).reason, "smt_unreadable_data");
});

test("smtLeaderEvidence: null input → smt_no_result, leader null (never throws)", () => {
  const e = smtLeaderEvidence(null, pair);
  assert.equal(e.leader, null);
  assert.equal(e.reason, "smt_no_result");
});

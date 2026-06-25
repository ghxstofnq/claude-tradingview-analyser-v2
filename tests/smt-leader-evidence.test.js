import { test } from "node:test";
import assert from "node:assert/strict";
import { smtLeaderEvidence, displacementLeaderEvidence, buildLeaderEvidence } from "../cli/lib/smt-leader-evidence.js";

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

// --- Faithful displacement leader (GOFNQ_FAITHFUL_LEADER) ---

const disp = {
  leader: "MES1!", primary_disp_score: 0.79, secondary_disp_score: 0.97,
  margin: 0.18, threshold: 0.1, reason: "secondary_higher_disp_score",
};
const smtConf = { divergence: false, bias_dir: "short", leader: null, reason: "no_divergence_measured", evidence: {} };

test("displacementLeaderEvidence: carries leader + disp scores; SMT demoted to confirmation", () => {
  const e = displacementLeaderEvidence(disp, smtConf, pair);
  assert.equal(e.method, "displacement");
  assert.equal(e.leader, "MES1!");
  assert.equal(e.reason, "secondary_higher_disp_score");
  assert.equal(e.primary_disp_score, 0.79);
  assert.equal(e.secondary_disp_score, 0.97);
  assert.equal(e.margin, 0.18);
  // SMT is demoted: only its DIRECTION confirmation rides along, never its leader.
  assert.equal(e.smt_confirmation.bias_dir, "short");
  assert.equal(e.smt_confirmation.divergence, false);
  assert.equal(e.smt_confirmation.leader, undefined);
});

test("displacementLeaderEvidence: inconclusive → leader null (caller defaults primary)", () => {
  const inconclusive = { leader: null, primary_disp_score: 0.91, secondary_disp_score: 0.92, margin: 0.01, threshold: 0.1, reason: "inconclusive_margin_below_threshold" };
  const e = displacementLeaderEvidence(inconclusive, smtConf, pair);
  assert.equal(e.leader, null);
  assert.equal(e.reason, "inconclusive_margin_below_threshold");
});

test("displacementLeaderEvidence: null disp / null smt never throws", () => {
  const e = displacementLeaderEvidence(null, null, pair);
  assert.equal(e.method, "displacement");
  assert.equal(e.leader, null);
  assert.equal(e.reason, "no_result");
  assert.equal(e.smt_confirmation, null);
});

test("buildLeaderEvidence: faithful=true uses displacement; false uses smt", () => {
  const f = buildLeaderEvidence({ faithful: true, disp, smt: smtConf, primary: pair.primary, secondary: pair.secondary });
  assert.equal(f.method, "displacement");
  assert.equal(f.leader, "MES1!");
  const s = buildLeaderEvidence({ faithful: false, disp, smt: { divergence: true, leader: "MNQ1!", reason: "smt_divergence", evidence: {} }, primary: pair.primary, secondary: pair.secondary });
  assert.equal(s.method, "smt");
  assert.equal(s.leader, "MNQ1!");
});

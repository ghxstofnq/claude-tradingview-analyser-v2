// smt-leader-evidence.js — map a computeSmtLeader result into the bundle's
// pair.leader_evidence shape. Pure. Kept thin + separately tested because the
// analyze.js `--pair` path that calls it can't be exercised by the unit suite
// (it does a live CDP capture) — so the mapping logic is verified here instead.
//
// Carries `leader` + `reason` (the fields the deterministic finalizer + digest
// read) plus the full SMT evidence: bias_dir (the confirm/flip direction Lanto
// leans on, daily-bias §6), divergence, the per-symbol strengths/criteria, and
// cite-or-reject anchors. `leader: null` on no-divergence → the caller defaults
// to the primary (MNQ); never a silent wrong pick.

export function smtLeaderEvidence(smt, { primary, secondary } = {}) {
  if (!smt) {
    return { method: 'smt', leader: null, bias_dir: null, divergence: false, reason: 'smt_no_result' };
  }
  const ev = smt.evidence || {};
  const citeFor = (sym) => (ev[sym]?.pivot_cite ? `pair.symbols.${sym}.engine.swings` : null);
  return {
    method: 'smt',
    leader: smt.leader ?? null,            // null on no-divergence → caller defaults primary
    bias_dir: smt.bias_dir ?? null,        // short | long | null — confirms/flips the open-reaction (§6)
    divergence: !!smt.divergence,
    reason: smt.reason,                    // smt_divergence | no_divergence_measured | smt_unreadable_data
    gap: smt.gap ?? null,
    band: smt.band ?? null,
    context: smt.context ?? null,          // 'high' | 'low' — the side evaluated
    strengths: smt.strengths ?? {},
    criteria: smt.criteria ?? {},
    evidence: ev,
    primary_pivot_path: citeFor(primary),
    secondary_pivot_path: citeFor(secondary),
  };
}

// displacementLeaderEvidence — map a compute-leader.js (displacement / relative-
// strength) result into the bundle's pair.leader_evidence shape. This is the
// FAITHFUL leader behind GOFNQ_FAITHFUL_LEADER: Lanto picks the leading/stronger
// instrument at the open reaction (How-I-Develop-Daily-Bias 36:32/37:28), not
// SMT divergence — validated 2026-06-25 (9-session pair-leader fold: displacement
// 5/8 vs Lanto + MNQ-safe; divergence 4/8 + R-negative). Same `leader` + `reason`
// fields the finalizer/digest read. The divergence-SMT result is DEMOTED to an
// optional `smt_confirmation` overlay — it confirms the open-reaction DIRECTION
// (bias_dir) only, never the symbol pick. `leader: null` when inconclusive →
// caller defaults the primary (MNQ); never a silent wrong pick. Pure.
export function displacementLeaderEvidence(disp, smt, { primary, secondary } = {}) {
  const smt_confirmation = smt
    ? { method: 'smt', bias_dir: smt.bias_dir ?? null, divergence: !!smt.divergence, reason: smt.reason ?? null }
    : null;
  if (!disp) {
    return { method: 'displacement', leader: null, reason: 'no_result', smt_confirmation };
  }
  return {
    method: 'displacement',
    leader: disp.leader ?? null,
    reason: disp.reason ?? null,
    primary_disp_score: disp.primary_disp_score ?? null,
    secondary_disp_score: disp.secondary_disp_score ?? null,
    margin: disp.margin ?? null,
    threshold: disp.threshold ?? null,
    smt_confirmation,
  };
}

// buildLeaderEvidence — route between the faithful displacement leader (flag on)
// and the legacy divergence-SMT leader (flag off, default). Keeps analyze.js to a
// single call and makes the flag behavior unit-testable. Pure.
export function buildLeaderEvidence({ faithful, disp, smt, primary, secondary } = {}) {
  return faithful
    ? displacementLeaderEvidence(disp, smt, { primary, secondary })
    : smtLeaderEvidence(smt, { primary, secondary });
}

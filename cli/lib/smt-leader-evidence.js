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

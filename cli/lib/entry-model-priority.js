/**
 * entry-model-priority.js — pure resolver for which of MSS / Trend /
 * Inversion to walk first at entry_hunt time.
 *
 * Inputs: open-reaction phase facts (pillar2_verdict, htf_ltf_alignment,
 * ltf_bias) + engine-derived signals (failure_swings, most_recent_structure,
 * inverted_fvg_present, trend_reclaim_present).
 *
 * Output: { priority: 'MSS'|'Trend'|'Inversion'|'undecided', reason: str,
 *           cite: str }. The `cite` field names the path the LLM should
 * also include verbatim in `surface_ltf_bias.priority_reason`.
 *
 * Spec: docs/superpowers/specs/2026-05-26-strategy-chain-design.md §3.4
 */

export function computeEntryModelPriority({
  pillar2_verdict,
  htf_ltf_alignment,
  ltf_bias,
  failure_swings = [],
  most_recent_structure = null,
  inverted_fvg_present = false,
  trend_reclaim_present = false,
} = {}) {
  if (pillar2_verdict === 'poor') {
    return { priority: 'undecided', reason: 'pillar2 poor — quality gates trumps entry model', cite: 'pillar2_verdict' };
  }
  if (htf_ltf_alignment === 'divergent') {
    return { priority: 'MSS', reason: 'divergent — LTF reversal at HTF level', cite: 'htf_ltf_alignment=divergent' };
  }
  if (htf_ltf_alignment === 'aligned') {
    // A live/fresh direct-brief fold can resolve the open reaction after a
    // flipped, bias-side iFVG has already become the active reclaim. When that
    // current-bar reclaim-continuation evidence is present, it is the Trend
    // model itself — stale older failure_swings should not redirect it to MSS.
    if (trend_reclaim_present) {
      return { priority: 'Trend', reason: 'aligned + current Trend reclaim-continuation iFVG', cite: 'trend_reclaim_present' };
    }
    if (failure_swings.length > 0) {
      return { priority: 'MSS', reason: 'aligned + recent failure_swing (mss+sweep)', cite: 'failure_swings[0]' };
    }
    if (most_recent_structure?.event === 'bos' && most_recent_structure?.dir) {
      const dir = most_recent_structure.dir;
      const biasMatches = (ltf_bias === 'bullish' && dir === 'bull') || (ltf_bias === 'bearish' && dir === 'bear');
      if (biasMatches) {
        return { priority: 'Trend', reason: `aligned + BoS in bias direction (${dir})`, cite: 'most_recent_structure' };
      }
    }
    if (inverted_fvg_present) {
      return { priority: 'Inversion', reason: 'aligned + opposing FVG just flipped (state=inverted)', cite: 'fvgs[where state=inverted]' };
    }
    return { priority: 'undecided', reason: 'aligned but no obvious entry model signal', cite: 'none' };
  }
  return { priority: 'undecided', reason: 'alignment unclear', cite: 'htf_ltf_alignment' };
}

// compute-leader.js — pure function that decides which symbol of a pair was
// the "leader" during the NY open-reaction window. Leader = highest
// disp_score on a fresh FVG created inside the window.
//
// Hard rules:
//   - constraint #7 (no LLM arithmetic): all comparison is done here, never
//     in the prompt.
//   - constraint #6 (cite-or-reject): the verdict object includes the JSON
//     paths the caller should cite when writing the bundle.
//
// Output shape:
//   {
//     leader: 'MNQ1!' | 'MES1!' | null,
//     primary_disp_score: number,         // 0 if no qualifying FVGs
//     secondary_disp_score: number,
//     margin: number,                     // |primary - secondary|
//     threshold: number,                  // echoed for transparency
//     reason: 'primary_higher_disp_score'
//           | 'secondary_higher_disp_score'
//           | 'inconclusive_margin_below_threshold'
//           | 'no_fvgs_created_in_window'
//           | 'secondary_engine_missing',
//   }

const DEFAULT_THRESHOLD = 0.10;

function maxDispScoreInWindow(engine, windowStartMs, windowEndMs) {
  if (!engine || !Array.isArray(engine.fvgs)) return 0;
  let max = 0;
  for (const f of engine.fvgs) {
    if (!Number.isFinite(f.disp_score)) continue;
    if (!Number.isFinite(f.created_ms)) continue;
    if (f.created_ms < windowStartMs || f.created_ms >= windowEndMs) continue;
    if (f.disp_score > max) max = f.disp_score;
  }
  return max;
}

export function computeLeader({
  primary,
  secondary,
  primaryEngine,
  secondaryEngine,
  windowStartMs,
  windowEndMs,
  threshold = DEFAULT_THRESHOLD,
}) {
  if (!secondaryEngine) {
    return {
      leader: null,
      primary_disp_score: 0,
      secondary_disp_score: 0,
      margin: 0,
      threshold,
      reason: 'secondary_engine_missing',
    };
  }
  const p = maxDispScoreInWindow(primaryEngine, windowStartMs, windowEndMs);
  const s = maxDispScoreInWindow(secondaryEngine, windowStartMs, windowEndMs);
  const margin = Math.abs(p - s);

  if (p === 0 && s === 0) {
    return {
      leader: null,
      primary_disp_score: 0,
      secondary_disp_score: 0,
      margin: 0,
      threshold,
      reason: 'no_fvgs_created_in_window',
    };
  }
  if (margin < threshold) {
    return {
      leader: null,
      primary_disp_score: p,
      secondary_disp_score: s,
      margin,
      threshold,
      reason: 'inconclusive_margin_below_threshold',
    };
  }
  const leader = p > s ? primary : secondary;
  const reason = p > s ? 'primary_higher_disp_score' : 'secondary_higher_disp_score';
  return {
    leader,
    primary_disp_score: p,
    secondary_disp_score: s,
    margin,
    threshold,
    reason,
  };
}

// Rewrites ambiguous engine fields into semantically explicit names.
// Source: docs/superpowers/specs/2026-05-26-strategy-detector-design.md §Schema disambiguation

const FVG_STATE_SEMANTIC = {
  fresh:     'created_never_retested',
  ce_tapped: 'midpoint_tapped_at_least_once',
  taken:     'fully_traded_through',
  invalidated: 'invalidated',
};

export function disambiguateFvg(fvg) {
  if (!fvg) return fvg;
  return {
    ...fvg,
    state_semantic: FVG_STATE_SEMANTIC[fvg.state] ?? fvg.state,
    retested_since_creation: fvg.state !== 'fresh',
    displacement_at_creation: fvg.reacted === true,
    valid_as_zone: fvg.state !== 'taken' && fvg.state !== 'invalidated',
  };
}

export function disambiguateSessionLevel(lvl) {
  if (!lvl) return lvl;
  return {
    ...lvl,
    swept: lvl.taken === true,
    valid_as_target: lvl.taken !== true,
  };
}

export function disambiguateStructureEvent(ev) {
  if (!ev) return ev;
  return {
    ...ev,
    is_reclaimed: ev.reclaimed === true,
  };
}

// Derives candle 1 / candle 3 prices from an FVG's created_ms + the bars at the FVG's TF.
// FVG is a 3-candle pattern. candle 3 = bar at created_ms. candle 1 = bar at created_ms - 2 * tf_ms.
// Returns partial: candle1 or candle3 may be null if the matching bar isn't in the array.
// Callers (stop placement) pick the specific candle they need.
export function deriveFvgFormationCandles(fvg, barsAtTf, tfMs) {
  if (!fvg || !fvg.created_ms || !Array.isArray(barsAtTf) || !tfMs) return null;
  const c3Ms = fvg.created_ms;
  const c1Ms = fvg.created_ms - 2 * tfMs;
  const c3 = barsAtTf.find((b) => Math.abs(b.time * 1000 - c3Ms) < tfMs / 2);
  const c1 = barsAtTf.find((b) => Math.abs(b.time * 1000 - c1Ms) < tfMs / 2);
  if (!c1 && !c3) return null;
  return {
    candle1: c1 ? { time_ms: c1.time * 1000, low: c1.low, high: c1.high } : null,
    candle3: c3 ? { time_ms: c3.time * 1000, low: c3.low, high: c3.high } : null,
  };
}

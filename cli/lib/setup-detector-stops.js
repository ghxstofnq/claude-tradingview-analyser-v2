import { deriveFvgFormationCandles } from './setup-detector-schema.js';

// Returns the pivot with minimum absolute distance from `entry` that's on the correct
// side (below entry for long, above entry for short). Pivots span all tiers (HH/HL/LH/LL).
export function closestSwingPivot(pivots, { entry, side }) {
  if (!Array.isArray(pivots) || pivots.length === 0) return null;
  const filtered = pivots.filter((p) => {
    if (side === 'long')  return p.is_high === false && p.price < entry;
    if (side === 'short') return p.is_high === true  && p.price > entry;
    return false;
  });
  if (filtered.length === 0) return null;
  return filtered.reduce((best, cur) =>
    Math.abs(cur.price - entry) < Math.abs(best.price - entry) ? cur : best
  );
}

// Finds the bar index in barsAtTf that matches a target ms timestamp (within tfMs/2).
function findBarIndex(barsAtTf, targetMs, tfMs) {
  return barsAtTf.findIndex((b) => Math.abs(b.time * 1000 - targetMs) < tfMs / 2);
}

// Priority for FVG-based entries (MSS retrace, Trend pullback):
//   1. candle 1 low/high of the 3-candle FVG formation
//   2. closest swing pivot past entry
//   3. FVG bottom/top (fallback)
export function stopOptionsForFvgEntry({ fvg, side, barsAtTf, tf, tfMs, fvgIdx, pivots, entry }) {
  const options = [];
  const candles = deriveFvgFormationCandles(fvg, barsAtTf, tfMs);
  if (candles?.candle1) {
    const kind = side === 'long' ? 'fvg_candle1_low' : 'fvg_candle1_high';
    const value = side === 'long' ? candles.candle1.low : candles.candle1.high;
    const barIdx = findBarIndex(barsAtTf, candles.candle1.time_ms, tfMs);
    options.push({
      kind, value,
      cite: `bars_by_tf.${tf}.last_5_bars[${barIdx}].${side === 'long' ? 'low' : 'high'}`,
      rationale: `FVG candle 1 (first structure candle of the 3-candle formation, time_ms=${candles.candle1.time_ms})`,
    });
  }
  const pivot = closestSwingPivot(pivots, { entry, side });
  if (pivot) {
    options.push({
      kind: 'swing_pivot',
      value: pivot.price,
      cite: pivot.cite,
      rationale: `closest swing ${pivot.tier} pivot past entry`,
    });
  }
  const fallbackKind = side === 'long' ? 'fvg_bottom' : 'fvg_top';
  const fallbackValue = side === 'long' ? fvg.bottom : fvg.top;
  options.push({
    kind: fallbackKind,
    value: fallbackValue,
    cite: `engine_by_tf.${tf}.fvgs[${fvgIdx}].${side === 'long' ? 'bottom' : 'top'}`,
    rationale: 'FVG bottom/top — fallback when candle 1 and swing pivot unavailable',
  });
  return options;
}

// Priority for Inversion entries: stop = candle 3 low/high of the ORIGINAL FVG
// (the candle that defined the bottom/top of the original bear/bull gap before polarity flip).
export function stopOptionsForInversionEntry({ fvg, side, barsAtTf, tf, tfMs, fvgIdx, pivots, entry }) {
  const options = [];
  const candles = deriveFvgFormationCandles(fvg, barsAtTf, tfMs);
  if (candles?.candle3) {
    const kind = side === 'long' ? 'fvg_candle3_low' : 'fvg_candle3_high';
    const value = side === 'long' ? candles.candle3.low : candles.candle3.high;
    const barIdx = findBarIndex(barsAtTf, candles.candle3.time_ms, tfMs);
    options.push({
      kind, value,
      cite: `bars_by_tf.${tf}.last_5_bars[${barIdx}].${side === 'long' ? 'low' : 'high'}`,
      rationale: `candle 3 of the ORIGINAL FVG (defines invalidation of the polarity flip, time_ms=${candles.candle3.time_ms})`,
    });
  }
  const pivot = closestSwingPivot(pivots, { entry, side });
  if (pivot) {
    options.push({
      kind: 'swing_pivot',
      value: pivot.price,
      cite: pivot.cite,
      rationale: `closest swing ${pivot.tier} pivot past entry`,
    });
  }
  return options;
}

// Structure-based entries (MSS without FVG, BoS continuation): closest swing pivot only.
export function stopOptionsForStructureEntry({ side, pivots, entry }) {
  const pivot = closestSwingPivot(pivots, { entry, side });
  if (!pivot) return [];
  return [{
    kind: 'swing_pivot',
    value: pivot.price,
    cite: pivot.cite,
    rationale: `closest swing ${pivot.tier} pivot past entry`,
  }];
}

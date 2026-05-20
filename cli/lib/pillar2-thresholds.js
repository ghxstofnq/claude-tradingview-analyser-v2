/**
 * pillar2-thresholds.js — per-symbol Pillar 2 calibration.
 *
 * The only price-scale-dependent Pillar 2 threshold is the minimum
 * acceptable range (in price points). Body-ratio thresholds in
 * computeCandleStats are a normalised 0..1 value — identical across
 * instruments — and deliberately stay hardcoded there.
 *
 * Only MNQ is calibrated (40, from seed fixture 001). Uncalibrated
 * symbols return null; analyze.js then emits range_acceptable: null
 * ("uncalibrated — judge the range manually"). Add a symbol here once
 * a fixture for it has been hand-graded.
 */

const RANGE_MIN_BY_SYMBOL = {
  'MNQ1!': 40,
  'MNQ': 40,
};

/** "CME_MINI:MNQ1!" -> "MNQ1!"; trims, upper-cases. */
export function normalizeSymbol(raw) {
  if (typeof raw !== 'string') return '';
  const afterColon = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
  return afterColon.trim().toUpperCase();
}

/** { range_acceptable_min: number|null, symbol: string }. */
export function pillar2Thresholds(rawSymbol) {
  const symbol = normalizeSymbol(rawSymbol);
  const min = Object.prototype.hasOwnProperty.call(RANGE_MIN_BY_SYMBOL, symbol)
    ? RANGE_MIN_BY_SYMBOL[symbol]
    : null;
  return { range_acceptable_min: min, symbol };
}

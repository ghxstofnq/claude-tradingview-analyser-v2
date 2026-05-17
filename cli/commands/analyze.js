import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';

/**
 * Deterministic gate computations. Everything in here must be derivable
 * directly from the captured bundle fields — no LLM judgment, no
 * heuristics that approximate human discretion.
 *
 * Coverage today (with the user's current chart indicators):
 *   - session.*         clock-based session label + killzone time windows
 *   - price_context.*   spatial price-vs-pine-box checks
 *   - pillar1.*         session liquidity from ICT Killzones labels
 *                       (PDH/PDL/AS.H/AS.L/LO.H/LO.L/NYAM.H/NYAM.L)
 *                       with taken/untaken derived from bars.high/low
 *   - pillar2.*         range + candle-quality stats from bars
 *   - pillar3.*         most-recent ICT swing structure (ST/IT/LT × HL/LH/HH/LL)
 *                       ordered by Pine x-index; FVG counts classified by
 *                       Nephew_Sam_'s bgColor → bullish/bearish FVG/IFVG
 *
 * Still LLM-interpretive (documented in CLAUDE.md "Known gaps"):
 *   - HTF Pillar 2 displacement (needs HTF candles → multi-TF, next commit)
 *   - Entry-model selection (which of MSS / Trend / Inversion)
 *   - Confirmation candle quality / 10-15 min rule
 *
 * See docs/research/ai-trading-analysis.md rec #3 and
 * docs/strategy/trading-strategy-2026.md §2.2 + §7.
 */

// FVG color mapping (provided by user, source: Nephew_Sam_'s indicator).
// TradingView stores colors as ABGR ints; we mask alpha and key on the BGR low 3 bytes.
// RGB hex → stored low-3-bytes after `(color >>> 0) & 0x00ffffff`:
//   22ab94 (Bullish FVG)   → 0x94ab22
//   3179f5 (Bullish IFVG)  → 0xf57931
//   f7525f (Bearish FVG)   → 0x5f52f7
//   ffa726 (Bearish IFVG)  → 0x26a7ff
const FVG_BGR_TO_TYPE = {
  0x94ab22: 'bullish_fvg',
  0xf57931: 'bullish_ifvg',
  0x5f52f7: 'bearish_fvg',
  0x26a7ff: 'bearish_ifvg',
};
function classifyFvgColor(bgColor) {
  const bgr = (bgColor >>> 0) & 0x00ffffff;
  return FVG_BGR_TO_TYPE[bgr] || 'unknown';
}

// Session-level texts published by ICT Killzones & Pivots [TFO].
// Suffix convention: *H = a high (buy-side liquidity), *L = a low (sell-side liquidity).
// `key` is the citation-safe identifier; `label` preserves the indicator's original text.
const SESSION_LEVELS = [
  { key: 'PWH', label: 'PWH' },
  { key: 'PWL', label: 'PWL' },
  { key: 'PDH', label: 'PDH' },
  { key: 'PDL', label: 'PDL' },
  { key: 'AS_H', label: 'AS.H' },
  { key: 'AS_L', label: 'AS.L' },
  { key: 'LO_H', label: 'LO.H' },
  { key: 'LO_L', label: 'LO.L' },
  { key: 'NYAM_H', label: 'NYAM.H' },
  { key: 'NYAM_L', label: 'NYAM.L' },
  { key: 'NYPM_H', label: 'NYPM.H' },
  { key: 'NYPM_L', label: 'NYPM.L' },
];

// ICT swing structure label texts published by ICT Anchored Market Structures [LuxAlgo].
// `key` is the citation-safe identifier; `label` preserves the indicator's original text.
const STRUCTURE_POINTS = [
  { key: 'ST_HH', label: 'ST-HH' },
  { key: 'ST_HL', label: 'ST-HL' },
  { key: 'ST_LH', label: 'ST-LH' },
  { key: 'ST_LL', label: 'ST-LL' },
  { key: 'IT_HH', label: 'IT-HH' },
  { key: 'IT_HL', label: 'IT-HL' },
  { key: 'IT_LH', label: 'IT-LH' },
  { key: 'IT_LL', label: 'IT-LL' },
  { key: 'LT_HH', label: 'LT-HH' },
  { key: 'LT_HL', label: 'LT-HL' },
  { key: 'LT_LH', label: 'LT-LH' },
  { key: 'LT_LL', label: 'LT-LL' },
];

function computeGates({ quote, bars, pine, fvgBoxesVerbose }) {
  const last = quote?.last ?? null;

  // -- Session / time classification (purely from quote.time) --
  const ts = (quote?.time || 0) * 1000;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(ts)).map((p) => [p.type, p.value]),
  );
  const etHour = Number(parts.hour) % 24;
  const etMinute = Number(parts.minute);
  const weekday = parts.weekday;
  const etMinutesTotal = etHour * 60 + etMinute;
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const inRange = (start, end) => etMinutesTotal >= start && etMinutesTotal < end;
  const NY_OPEN_WINDOW = [9 * 60 + 30, 10 * 60];
  const NY_AM_KILLZONE = [8 * 60 + 30, 11 * 60];
  const NY_PM_KILLZONE = [13 * 60 + 30, 16 * 60];
  const LONDON_OPEN_KZ = [3 * 60, 5 * 60];
  const inNyOpenWindow = !isWeekend && inRange(...NY_OPEN_WINDOW);
  const inNyAmKillzone = !isWeekend && inRange(...NY_AM_KILLZONE);
  const inNyPmKillzone = !isWeekend && inRange(...NY_PM_KILLZONE);
  const inLondonOpenKillzone = !isWeekend && inRange(...LONDON_OPEN_KZ);
  const inAnyKillzone = inNyAmKillzone || inNyPmKillzone || inLondonOpenKillzone;
  let sessionLabel;
  if (isWeekend) sessionLabel = 'Weekend/Closed';
  else if (inNyAmKillzone) sessionLabel = inNyOpenWindow ? 'NY Open' : 'NY AM';
  else if (inNyPmKillzone) sessionLabel = 'NY PM';
  else if (inLondonOpenKillzone) sessionLabel = 'London Open';
  else if (etMinutesTotal >= 20 * 60 || etMinutesTotal < 3 * 60) sessionLabel = 'Asia';
  else sessionLabel = 'Inter-session';

  // -- Price-vs-pine-box context (inside-box checks) --
  const insideBoxes = [];
  const boxStudies = pine?.boxes?.studies || [];
  for (const study of boxStudies) {
    const zones = study.zones || [];
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (last != null && last >= z.low && last <= z.high) {
        insideBoxes.push({ study: study.name, zone_index: i, high: z.high, low: z.low });
      }
    }
  }

  // -- Pillar 1: session liquidity from ICT Killzones labels --
  const kzStudy = (pine?.labels?.studies || []).find((s) => /Killzones/i.test(s.name));
  const kzLabels = kzStudy?.labels || [];
  const sessionLevels = {};
  for (const { key, label: chartLabel } of SESSION_LEVELS) {
    const found = kzLabels.find((l) => l.text === chartLabel);
    if (!found || found.price == null) {
      sessionLevels[key] = { label: chartLabel, price: null, position_vs_price: null, taken: null };
      continue;
    }
    const price = found.price;
    const isHigh = /_H$|H$/.test(key);
    let taken = null;
    if (isHigh) taken = bars?.high != null && bars.high > price;
    else taken = bars?.low != null && bars.low < price;
    sessionLevels[key] = {
      label: chartLabel,
      price,
      position_vs_price:
        last == null ? null : price > last ? 'above' : price < last ? 'below' : 'at',
      taken,
    };
  }
  const lowKeys = SESSION_LEVELS.filter(({ key }) => /_L$|L$/.test(key) && !/H$/.test(key)).map((e) => e.key);
  const highKeys = SESSION_LEVELS.filter(({ key }) => /_H$|H$/.test(key)).map((e) => e.key);
  const untakenSellSideBelow = lowKeys
    .map((k) => ({ key: k, ...sessionLevels[k] }))
    .filter((s) => s && s.position_vs_price === 'below' && s.taken === false)
    .sort((a, b) => b.price - a.price);
  const untakenBuySideAbove = highKeys
    .map((k) => ({ key: k, ...sessionLevels[k] }))
    .filter((s) => s && s.position_vs_price === 'above' && s.taken === false)
    .sort((a, b) => a.price - b.price);

  // -- Pillar 3a: most-recent ICT swing structure points (by Pine x-index) --
  const amsStudy = (pine?.labels?.studies || []).find((s) => /Anchored/i.test(s.name));
  const amsLabels = amsStudy?.labels || [];
  const mostRecentStructure = {};
  for (const { key, label: chartLabel } of STRUCTURE_POINTS) {
    const matching = amsLabels.filter((l) => l.text === chartLabel && typeof l.x === 'number');
    if (matching.length === 0) {
      mostRecentStructure[key] = { label: chartLabel, price: null, x: null };
      continue;
    }
    matching.sort((a, b) => b.x - a.x);
    const top = matching[0];
    mostRecentStructure[key] = { label: chartLabel, price: top.price, x: top.x };
  }

  // -- Pillar 3b: FVG counts by direction (color-classified) --
  const fvgEmpty = () => ({
    bullish_fvg: 0, bullish_ifvg: 0,
    bearish_fvg: 0, bearish_ifvg: 0,
    unknown: 0,
  });
  const fvgByType = fvgEmpty();
  const fvgByTypeAbove = fvgEmpty();
  const fvgByTypeBelow = fvgEmpty();
  const fvgVerboseStudy = (fvgBoxesVerbose?.studies || []).find((s) => /FVG/i.test(s.name));
  if (fvgVerboseStudy && last != null) {
    for (const box of fvgVerboseStudy.all_boxes || []) {
      const type = classifyFvgColor(box.bgColor);
      fvgByType[type]++;
      if (last < box.low) fvgByTypeAbove[type]++;
      else if (last > box.high) fvgByTypeBelow[type]++;
    }
  }

  // -- Pillar 2: range + candle quality stats --
  const rangeValue = bars?.range ?? null;
  const barCount = bars?.bar_count ?? null;
  const rangePerBar = rangeValue != null && barCount ? rangeValue / barCount : null;
  // Heuristic threshold for MNQ 1m (calibrated to seed fixture).
  const rangeAcceptable = rangeValue != null && rangeValue >= 40;
  const last5 = bars?.last_5_bars || [];
  let avgBodyRatio = null;
  if (last5.length > 0) {
    const ratios = last5.map((b) => {
      const total = b.high - b.low;
      return total > 0 ? Math.abs(b.close - b.open) / total : 0;
    });
    avgBodyRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }
  let candleQuality = 'unknown';
  if (avgBodyRatio !== null) {
    if (avgBodyRatio >= 0.6) candleQuality = 'good';
    else if (avgBodyRatio >= 0.3) candleQuality = 'marginal';
    else candleQuality = 'poor';
  }

  return {
    session: {
      label: sessionLabel,
      timestamp_et: fmt.format(new Date(ts)),
      is_weekend: isWeekend,
      in_ny_open_window: inNyOpenWindow,
      in_killzone: inAnyKillzone,
      in_killzone_detail: {
        london_open: inLondonOpenKillzone,
        ny_am: inNyAmKillzone,
        ny_pm: inNyPmKillzone,
      },
    },
    price_context: {
      last,
      inside_boxes: insideBoxes,
    },
    pillar1: {
      session_levels: sessionLevels,
      untaken_sell_side_below: untakenSellSideBelow,
      untaken_buy_side_above: untakenBuySideAbove,
    },
    pillar2: {
      range_value: rangeValue,
      range_per_bar: rangePerBar,
      range_acceptable: rangeAcceptable,
      avg_body_ratio_last_5: avgBodyRatio,
      candle_quality_heuristic: candleQuality,
    },
    pillar3: {
      most_recent_structure: mostRecentStructure,
      fvg_by_type: fvgByType,
      fvg_by_type_above: fvgByTypeAbove,
      fvg_by_type_below: fvgByTypeBelow,
    },
  };
}

register('analyze', {
  description: 'Bundle current chart state, quote, OHLCV summary, indicator values, Pine drawings, and deterministic gates (session, liquidity, structure, FVG-by-direction) into one JSON object for ICT analysis by Claude.',
  handler: async () => {
    const [
      state,
      visibleRange,
      quote,
      bars,
      indicatorValues,
      lines,
      labels,
      tables,
      boxes,
      fvgBoxesVerbose,
    ] = await Promise.all([
      chart.getState(),
      chart.getVisibleRange(),
      data.getQuote(),
      data.getOhlcv({ summary: true }),
      data.getStudyValues(),
      data.getPineLines({ verbose: false }),
      data.getPineLabels({ verbose: true }),  // verbose: x-index unlocks structure-point ordering
      data.getPineTables(),
      data.getPineBoxes({ verbose: false }),
      data.getPineBoxes({ verbose: true, study_filter: 'FVG' }),  // for color-based direction classification
    ]);

    const pine = { lines, labels, tables, boxes };
    const gates = computeGates({ quote, bars, pine, fvgBoxesVerbose });

    return {
      timestamp: new Date().toISOString(),
      chart: state,
      visible_range: visibleRange,
      quote,
      bars,
      indicators: indicatorValues,
      pine,
      gates,
    };
  },
});

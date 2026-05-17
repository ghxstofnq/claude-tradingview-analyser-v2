import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';
import * as replay from '@tvmcp/core/replay';

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

/**
 * Compute body-ratio / engulfing / doji stats for the last 5 bars at some TF.
 * Strategy §7 step 3 specifically wants this on 5m/15m bars. Body-ratio also
 * computed for the chart's current TF as a live LTF gauge.
 *
 * Returns null when no bars are available.
 *
 * Engulfing: current candle's body fully covers the prior candle's body
 *   (regardless of direction; strategy uses "engulfing" loosely to mean
 *   "strong-bodied, decisive" rather than the strict reversal pattern).
 * Doji: body_ratio < 0.15 (catches "doji-like" candles, not just pure dojis).
 */
function computeCandleStats(last5) {
  if (!last5 || last5.length === 0) return null;
  const rawRatios = last5.map((b) => {
    const total = b.high - b.low;
    return total > 0 ? Math.abs(b.close - b.open) / total : 0;
  });
  const avg = rawRatios.reduce((a, b) => a + b, 0) / rawRatios.length;
  let quality;
  if (avg >= 0.6) quality = 'good';
  else if (avg >= 0.3) quality = 'marginal';
  else quality = 'poor';
  const dojiCount = rawRatios.filter((r) => r < 0.15).length;
  let engulfingCount = 0;
  for (let i = 1; i < last5.length; i++) {
    const prev = last5[i - 1];
    const cur = last5[i];
    const prevBodyHigh = Math.max(prev.open, prev.close);
    const prevBodyLow = Math.min(prev.open, prev.close);
    const curBodyHigh = Math.max(cur.open, cur.close);
    const curBodyLow = Math.min(cur.open, cur.close);
    if (curBodyHigh >= prevBodyHigh && curBodyLow <= prevBodyLow) {
      engulfingCount++;
    }
  }
  return {
    body_ratios_last_5: rawRatios.map((r) => Math.round(r * 100) / 100),
    avg_body_ratio_last_5: Math.round(avg * 100) / 100,
    candle_quality_heuristic: quality,
    engulfing_count_last_5: engulfingCount,
    doji_count_last_5: dojiCount,
  };
}

function computeGates({ quote, bars, pine, fvgBoxesVerbose, barsByTf, replayStatus }) {
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

  // CME Globex futures schedule (ET clock):
  //   Sunday 18:00 ET → Friday 17:00 ET, with a daily break 17:00-18:00 ET.
  // Saturday is entirely closed; Sunday is closed BEFORE 18:00 ET; Friday is
  // closed AFTER 17:00 ET. Plus the 1h daily settlement break on weekdays.
  const isSaturday = weekday === 'Sat';
  const isFridayAfterClose = weekday === 'Fri' && etMinutesTotal >= 17 * 60;
  const isSundayBeforeOpen = weekday === 'Sun' && etMinutesTotal < 18 * 60;
  const isDailyBreak =
    !isSaturday && !isFridayAfterClose && !isSundayBeforeOpen
    && etMinutesTotal >= 17 * 60 && etMinutesTotal < 18 * 60;
  const isMarketClosed = isSaturday || isFridayAfterClose || isSundayBeforeOpen || isDailyBreak;

  const inRange = (start, end) => etMinutesTotal >= start && etMinutesTotal < end;
  const NY_OPEN_WINDOW = [9 * 60 + 30, 10 * 60];
  const NY_AM_KILLZONE = [8 * 60 + 30, 11 * 60];
  const NY_PM_KILLZONE = [13 * 60 + 30, 16 * 60];
  const LONDON_OPEN_KZ = [3 * 60, 5 * 60];
  const inNyOpenWindow = !isMarketClosed && inRange(...NY_OPEN_WINDOW);
  const inNyAmKillzone = !isMarketClosed && inRange(...NY_AM_KILLZONE);
  const inNyPmKillzone = !isMarketClosed && inRange(...NY_PM_KILLZONE);
  const inLondonOpenKillzone = !isMarketClosed && inRange(...LONDON_OPEN_KZ);
  const inAnyKillzone = inNyAmKillzone || inNyPmKillzone || inLondonOpenKillzone;
  let sessionLabel;
  if (isMarketClosed) sessionLabel = 'Closed';
  else if (inNyAmKillzone) sessionLabel = inNyOpenWindow ? 'NY Open' : 'NY AM';
  else if (inNyPmKillzone) sessionLabel = 'NY PM';
  else if (inLondonOpenKillzone) sessionLabel = 'London Open';
  else if (etMinutesTotal >= 18 * 60 || etMinutesTotal < 3 * 60) sessionLabel = 'Asia';
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

  // -- Pillar 1c: explicit Bias labels (auto-populates if user adds a bias indicator) --
  // Scans every Pine label across all studies for text matching /bias/i. Strategy
  // §2.1 references "Bias Long" / "Bias Short" readouts; this gate catches them
  // wherever they live, without us hard-coding study names.
  const biasLabels = [];
  for (const study of pine?.labels?.studies || []) {
    for (const lbl of study.labels || []) {
      if (lbl.text && /bias/i.test(lbl.text)) {
        biasLabels.push({
          text: lbl.text,
          price: lbl.price,
          study: study.name,
          x: typeof lbl.x === 'number' ? lbl.x : null,
        });
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
  const currentTfStats = computeCandleStats(last5);
  // Strategy §7 step 3: "15m/5m candles mainly engulfing; not dominated by dojis/wicks"
  // — explicit per-TF stats so Pillar 2's candle check is on the right bars.
  const m5Stats = computeCandleStats(barsByTf?.m5?.last_5_bars);
  const m15Stats = computeCandleStats(barsByTf?.m15?.last_5_bars);

  // -- Pillar 3c: last-bar confirmation facts (single-bar discipline for strategy §5/§6) --
  let lastBar = null;
  let lastBarAgeSeconds = null;
  if (last5.length > 0) {
    const lb = last5[last5.length - 1];
    const totalRange = lb.high - lb.low;
    const bodySize = Math.abs(lb.close - lb.open);
    const bodyRatio = totalRange > 0 ? Math.round((bodySize / totalRange) * 100) / 100 : 0;
    let direction;
    if (bodyRatio < 0.1) direction = 'doji';
    else if (lb.close > lb.open) direction = 'bullish';
    else if (lb.close < lb.open) direction = 'bearish';
    else direction = 'doji';
    const closePosInRange =
      totalRange > 0 ? Math.round(((lb.close - lb.low) / totalRange) * 100) / 100 : 0.5;
    lastBar = {
      time: lb.time,
      open: lb.open,
      high: lb.high,
      low: lb.low,
      close: lb.close,
      body_ratio: bodyRatio,
      direction,
      range: Math.round(totalRange * 100) / 100,
      close_position_in_range: closePosInRange,
    };
    if (quote?.time && lb.time) lastBarAgeSeconds = quote.time - lb.time;
  }

  return {
    session: {
      label: sessionLabel,
      timestamp_et: fmt.format(new Date(ts)),
      is_weekend: isWeekend,
      is_market_closed: isMarketClosed,
      in_ny_open_window: inNyOpenWindow,
      in_killzone: inAnyKillzone,
      in_killzone_detail: {
        london_open: inLondonOpenKillzone,
        ny_am: inNyAmKillzone,
        ny_pm: inNyPmKillzone,
      },
      replay: replayStatus,
    },
    price_context: {
      last,
      inside_boxes: insideBoxes,
    },
    pillar1: {
      session_levels: sessionLevels,
      untaken_sell_side_below: untakenSellSideBelow,
      untaken_buy_side_above: untakenBuySideAbove,
      bias_labels: biasLabels,
    },
    pillar2: {
      range_value: rangeValue,
      range_per_bar: rangePerBar,
      range_acceptable: rangeAcceptable,
      // Current-TF stats (backwards-compat; also available in the structured form below).
      avg_body_ratio_last_5: currentTfStats?.avg_body_ratio_last_5 ?? null,
      candle_quality_heuristic: currentTfStats?.candle_quality_heuristic ?? 'unknown',
      // Full current-TF stats including ratios, engulfing, doji counts.
      current_tf: currentTfStats,
      // Strategy-aligned: 15m and 5m candle anatomy specifically.
      m5: m5Stats,
      m15: m15Stats,
    },
    pillar3: {
      most_recent_structure: mostRecentStructure,
      fvg_by_type: fvgByType,
      fvg_by_type_above: fvgByTypeAbove,
      fvg_by_type_below: fvgByTypeBelow,
      last_bar: lastBar,
      last_bar_age_seconds: lastBarAgeSeconds,
    },
  };
}

// Multi-timeframe set per strategy §2.1 (Daily / 4H / 1H), §3 (4H/1H/15m/5m),
// §7 step 6 (1m/5m). TradingView resolution strings → safe citation keys.
const HTF_LTF_TIMEFRAMES = [
  { tv: 'D',   key: 'daily' },
  { tv: '240', key: 'h4' },
  { tv: '60',  key: 'h1' },
  { tv: '15',  key: 'm15' },
  { tv: '5',   key: 'm5' },
  { tv: '1',   key: 'm1' },
];

// Studies we extract per-TF Pine surfaces for. Filters out noise from any
// other indicators that happen to be loaded.
const TRACKED_STUDY_PATTERNS = [
  /Killzones/i,
  /FVG/i,
  /Anchored/i,
  /Balanced Price Range|BPR/i,
];
const isTrackedStudy = (name) => TRACKED_STUDY_PATTERNS.some((re) => re.test(name || ''));

// Cap per-study entries to keep bundle size manageable. Top-N by recency
// (highest Pine x-index). 30 is plenty for HTF FVG / structure analysis.
const PER_STUDY_LIMIT = 30;

function trimBoxes(boxesResult) {
  const studies = (boxesResult?.studies || [])
    .filter((s) => isTrackedStudy(s.name))
    .map((s) => {
      const all = (s.all_boxes || []).slice().sort((a, b) => (b.x1 || 0) - (a.x1 || 0));
      return {
        name: s.name,
        total_boxes: s.total_boxes,
        showing: Math.min(all.length, PER_STUDY_LIMIT),
        all_boxes: all.slice(0, PER_STUDY_LIMIT),
      };
    });
  return { success: true, study_count: studies.length, studies };
}

function trimLabels(labelsResult) {
  const studies = (labelsResult?.studies || [])
    .filter((s) => isTrackedStudy(s.name))
    .map((s) => {
      const all = (s.labels || []).slice().sort((a, b) => (b.x || 0) - (a.x || 0));
      return {
        name: s.name,
        total_labels: s.total_labels,
        showing: Math.min(all.length, PER_STUDY_LIMIT),
        labels: all.slice(0, PER_STUDY_LIMIT),
      };
    });
  return { success: true, study_count: studies.length, studies };
}

/**
 * Switch the chart through each target timeframe; at each, fetch bars summary
 * + Pine boxes (verbose, for bgColor → FVG direction at HTF) + Pine labels
 * (verbose, for x-index ordering of HTF structure points). Restores the
 * original timeframe when done.
 *
 * Cost: ~2-3s per TF switch (chart redraws + Pine re-renders + 3 reads).
 * Total ~15-25s.
 * Strategy mandates this for Pillar 1a (HTF FVGs/structure) + Pillar 2 (HTF
 * displacement) + entry-model walkthroughs that reference HTF imbalances.
 *
 * Returns: { bars: {<key>: ...}, pine: {<key>: { boxes, labels }} }
 *
 * Implementation note: always call setTimeframe explicitly on every iteration
 * and on the final restore. Skipping based on "same as previous TF" has caused
 * "stuck on previous TF" bugs where reads return data at the wrong resolution.
 */
const TF_SETTLE_MS = 400;
async function captureMultiTf(originalTf) {
  const bars_by_tf = {};
  const pine_by_tf = {};
  for (const { tv, key } of HTF_LTF_TIMEFRAMES) {
    try {
      await chart.setTimeframe({ timeframe: tv });
      await new Promise((r) => setTimeout(r, TF_SETTLE_MS));
      const [bars, boxesVerbose, labelsVerbose] = await Promise.all([
        data.getOhlcv({ summary: true }),
        data.getPineBoxes({ verbose: true }),
        data.getPineLabels({ verbose: true }),
      ]);
      bars_by_tf[key] = { ...bars, tv_resolution: tv };
      pine_by_tf[key] = {
        tv_resolution: tv,
        boxes: trimBoxes(boxesVerbose),
        labels: trimLabels(labelsVerbose),
      };
    } catch (e) {
      bars_by_tf[key] = { error: e.message, tv_resolution: tv };
      pine_by_tf[key] = { error: e.message, tv_resolution: tv };
    }
  }
  // Restore original timeframe explicitly, regardless of the last iterated TF.
  try {
    await chart.setTimeframe({ timeframe: originalTf });
    await new Promise((r) => setTimeout(r, TF_SETTLE_MS));
  } catch (e) {
    // best-effort restore; fall through
  }
  return { bars_by_tf, pine_by_tf };
}

register('analyze', {
  description: 'Bundle current chart state, quote, multi-TF OHLCV summaries + Pine surfaces, indicator values, Pine drawings, and deterministic gates (session, liquidity, structure, FVG-by-direction) into one JSON object for ICT analysis by Claude.',
  options: {
    'current-tf-only': { type: 'boolean', description: 'Skip multi-TF capture (faster; no chart flashing)' },
    out: { type: 'string', description: 'Write bundle JSON to this path; stdout prints only {saved_to: <path>}. Use for bundles too large to pipe (>~60KB).' },
  },
  handler: async (opts) => {
    // 1. Capture chart state + replay status BEFORE any chart-switching,
    //    so we know the original TF and we record replay state at the
    //    moment of capture (multi-TF switching can disturb replay state).
    const state = await chart.getState();
    const originalTf = state.resolution;
    let replayStatus = { active: false, autoplay: false, current_date: null };
    try {
      const r = await replay.status();
      replayStatus = {
        active: r.is_replay_started === true,
        autoplay: r.is_autoplay_started === true,
        current_date: r.current_date || null,
      };
      if (replayStatus.active && replayStatus.autoplay) {
        process.stderr.write(
          'warning: replay autoplay is ON during analyze; chart bar position will drift during the multi-TF capture (10-15s). pause replay first for a stable snapshot.\n',
        );
      }
    } catch (e) {
      // replay API not available (no replay session active); leave defaults
    }

    // 2. Multi-TF bar + Pine collection (optional). Done FIRST so the
    //    original-TF extraction below happens after restore.
    const skipMultiTf = opts?.['current-tf-only'] === true;
    const { bars_by_tf, pine_by_tf } = skipMultiTf
      ? { bars_by_tf: null, pine_by_tf: null }
      : await captureMultiTf(originalTf);

    // 3. At the (restored) original TF, fetch everything else in parallel.
    const [
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
    const gates = computeGates({ quote, bars, pine, fvgBoxesVerbose, barsByTf: bars_by_tf, replayStatus });

    const bundle = {
      timestamp: new Date().toISOString(),
      chart: state,
      visible_range: visibleRange,
      quote,
      bars,
      bars_by_tf,
      indicators: indicatorValues,
      pine,
      pine_by_tf,
      gates,
    };

    // 4. Optional file output: write bundle to disk and print only the path.
    //    Lets the slash command Read the file instead of relying on Bash
    //    captured stdout, which has 30K-100K truncation limits depending on env.
    if (opts?.out) {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname, resolve } = await import('node:path');
      const absPath = resolve(opts.out);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, JSON.stringify(bundle, null, 2));
      return { saved_to: absPath, bytes: JSON.stringify(bundle).length };
    }
    return bundle;
  },
});

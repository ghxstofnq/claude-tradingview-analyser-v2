import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';

/**
 * Deterministic gate computations. Everything in here must be derivable
 * directly from the captured bundle fields — no LLM judgment, no
 * heuristics that approximate human discretion.
 *
 * Honest scope: with the user's current chart indicators (no explicit
 * Bias Long/Short label, no Asia/London H/L markers), only a SUBSET of
 * strategy §7's grade checklist can be made mechanical. The interpretive
 * gates (HTF bias direction, overnight liquidity, entry-model
 * identification, confirmation status) remain LLM-driven and live in
 * the slash command. The gates below cover the rest.
 *
 * See docs/research/ai-trading-analysis.md rec #3.
 */
function computeGates({ quote, bars, pine }) {
  // -- 1. Session / time classification (purely from quote.time) --
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
  const etHour = Number(parts.hour) % 24; // 24-hour clock
  const etMinute = Number(parts.minute);
  const weekday = parts.weekday;
  const etMinutesTotal = etHour * 60 + etMinute;
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  // Killzone windows (ET clock). Inclusive of start, exclusive of end.
  const inRange = (start, end) => etMinutesTotal >= start && etMinutesTotal < end;
  const NY_OPEN_WINDOW = [9 * 60 + 30, 10 * 60];           // 09:30–10:00 ET (Lanto's "first 15-30 min")
  const NY_AM_KILLZONE = [8 * 60 + 30, 11 * 60];           // 08:30–11:00 ET
  const NY_PM_KILLZONE = [13 * 60 + 30, 16 * 60];          // 13:30–16:00 ET
  const LONDON_OPEN_KZ = [3 * 60, 5 * 60];                 // 03:00–05:00 ET

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

  // -- 2. Price-vs-pine-box context (purely from quote.last + pine.boxes) --
  const last = quote?.last ?? null;
  const insideBoxes = [];
  const boxStudies = pine?.boxes?.studies || [];
  for (const study of boxStudies) {
    const zones = study.zones || [];
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (last != null && last >= z.low && last <= z.high) {
        insideBoxes.push({
          study: study.name,
          zone_index: i,
          high: z.high,
          low: z.low,
        });
      }
    }
  }

  // -- 3. FVG counts above/below price (specifically from FVG/iFVG study) --
  const fvgStudy = boxStudies.find((s) => /FVG/i.test(s.name));
  let fvgsAbove = 0, fvgsBelow = 0, fvgsInside = 0;
  let nearestFvgAbove = null, nearestFvgBelow = null;
  if (fvgStudy && last != null) {
    const zones = fvgStudy.zones || [];
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (last < z.low) {
        fvgsAbove++;
        if (!nearestFvgAbove || z.low < nearestFvgAbove.low) {
          nearestFvgAbove = { study: fvgStudy.name, zone_index: i, high: z.high, low: z.low };
        }
      } else if (last > z.high) {
        fvgsBelow++;
        if (!nearestFvgBelow || z.high > nearestFvgBelow.high) {
          nearestFvgBelow = { study: fvgStudy.name, zone_index: i, high: z.high, low: z.low };
        }
      } else {
        fvgsInside++;
      }
    }
  }

  // -- 4. Range / candle quality stats (purely from bars) --
  const rangeValue = bars?.range ?? null;
  const barCount = bars?.bar_count ?? null;
  const rangePerBar = rangeValue != null && barCount ? rangeValue / barCount : null;
  // Heuristic threshold for MNQ 1m: ≥40 points across the captured window is "acceptable".
  // Calibrated for the seed fixture (~100 bars). Adjust per symbol/timeframe as fixtures grow.
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
      fvgs_above: { count: fvgsAbove, nearest: nearestFvgAbove },
      fvgs_below: { count: fvgsBelow, nearest: nearestFvgBelow },
      fvgs_inside: fvgsInside,
    },
    pillar2: {
      range_value: rangeValue,
      range_per_bar: rangePerBar,
      range_acceptable: rangeAcceptable,
      avg_body_ratio_last_5: avgBodyRatio,
      candle_quality_heuristic: candleQuality,
    },
    // Note on what's NOT here and why (so future Claude sessions see the gap):
    // - HTF bias direction: no explicit Bias label is published by current chart indicators.
    //   Inferred-only; lives in slash-command output.
    // - Overnight liquidity untaken: requires Asia/London H/L markers; current chart does not load them.
    // - Entry-model identification (MSS / Trend / Inversion): interpretive; slash-command output.
    // - Confirmation status: interpretive; slash-command output.
    // - Final grade (A+ | B | no-trade): combines mechanical + interpretive; slash-command output.
  };
}

register('analyze', {
  description: 'Bundle current chart state, quote, OHLCV summary, indicator values, Pine drawings, and deterministic gates into one JSON object for ICT analysis by Claude.',
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
    ] = await Promise.all([
      chart.getState(),
      chart.getVisibleRange(),
      data.getQuote(),
      data.getOhlcv({ summary: true }),
      data.getStudyValues(),
      data.getPineLines({ verbose: false }),
      data.getPineLabels({ verbose: false }),
      data.getPineTables(),
      data.getPineBoxes({ verbose: false }),
    ]);

    const pine = { lines, labels, tables, boxes };
    const gates = computeGates({ quote, bars, pine });

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

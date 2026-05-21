import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';
import * as replay from '@tvmcp/core/replay';
import { findIctEngineRows, parseIctEngineTable } from '../lib/ict-engine-parser.js';
import { computeEngineGates } from '../lib/compute-engine-gates.js';
import { lastBarFacts } from '../lib/last-bar.js';

/**
 * tv analyze — bundles chart state, quote, multi-TF bars, and the ICT Engine
 * evidence table into one JSON object for /analyze.
 *
 * Two pre-computed gate groups (the LLM consumes them, never recomputes):
 *   gates.session — clock-based session / phase / killzone (computeSessionGate)
 *   gates.engine  — the 3-pillar gates derived from the ICT Engine table
 *                   (cli/lib/compute-engine-gates.js)
 *
 * The single data source is the ICT Engine indicator — see
 * docs/plans/2026-05-21-ict-engine-migration.md. The engine's evidence table
 * is parsed by cli/lib/ict-engine-parser.js; last-bar confirmation facts
 * (bar-derived, not engine-derived) by cli/lib/last-bar.js.
 */

/**
 * computeSessionGate — clock-based session gate. Indicator-independent:
 * every field derives purely from quote.time. LLMs are temporally blind by
 * default, so the ET clock, phase, and killzone countdown are pre-computed.
 * Phases match docs/plans/llm-driven-session.md and drive /analyze.
 */
export function computeSessionGate({ quote, replayStatus }) {
  // -- Session / time classification (purely from quote.time) --
  const ts = (quote?.time || 0) * 1000;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
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

  // -- Phase + temporal fields (LLM is temporally blind by default; pre-compute) --
  // Phases match docs/plans/llm-driven-session.md. Used by /analyze to choose
  // which work to do (pre-session grade → open-reaction → entry-hunt → post).
  const etSeconds = Number(parts.second || 0);
  let sessionPhase, phaseStartMin, nextKillzoneMin, nextKillzoneLabel;
  if (isMarketClosed) {
    sessionPhase = 'closed';
    phaseStartMin = 0; nextKillzoneMin = -1; nextKillzoneLabel = null;
  } else if (etMinutesTotal >= 3 * 60 && etMinutesTotal < 5 * 60) {
    sessionPhase = 'london_open';
    phaseStartMin = 3 * 60; nextKillzoneMin = 8 * 60 + 30; nextKillzoneLabel = 'NY AM';
  } else if (etMinutesTotal < 9 * 60 + 30) {
    sessionPhase = 'pre_session_ny_am';
    phaseStartMin = etMinutesTotal >= 5 * 60 ? 5 * 60 : 0;
    nextKillzoneMin = 8 * 60 + 30; nextKillzoneLabel = 'NY AM';
  } else if (etMinutesTotal < 9 * 60 + 45) {
    sessionPhase = 'open_reaction_ny_am';
    phaseStartMin = 9 * 60 + 30; nextKillzoneMin = 13 * 60 + 30; nextKillzoneLabel = 'NY PM';
  } else if (etMinutesTotal < 12 * 60) {
    sessionPhase = 'entry_hunt_ny_am';
    phaseStartMin = 9 * 60 + 45; nextKillzoneMin = 13 * 60 + 30; nextKillzoneLabel = 'NY PM';
  } else if (etMinutesTotal < 13 * 60) {
    sessionPhase = 'post_ny_am';
    phaseStartMin = 12 * 60; nextKillzoneMin = 13 * 60 + 30; nextKillzoneLabel = 'NY PM';
  } else if (etMinutesTotal < 13 * 60 + 30) {
    sessionPhase = 'pre_session_ny_pm';
    phaseStartMin = 13 * 60; nextKillzoneMin = 13 * 60 + 30; nextKillzoneLabel = 'NY PM';
  } else if (etMinutesTotal < 13 * 60 + 45) {
    sessionPhase = 'open_reaction_ny_pm';
    phaseStartMin = 13 * 60 + 30;
    nextKillzoneMin = 3 * 60 + 24 * 60;  // tomorrow's London Open
    nextKillzoneLabel = 'London Open (next day)';
  } else if (etMinutesTotal < 16 * 60) {
    sessionPhase = 'entry_hunt_ny_pm';
    phaseStartMin = 13 * 60 + 45;
    nextKillzoneMin = 3 * 60 + 24 * 60;
    nextKillzoneLabel = 'London Open (next day)';
  } else if (etMinutesTotal < 17 * 60) {
    sessionPhase = 'post_ny_pm';
    phaseStartMin = 16 * 60;
    nextKillzoneMin = 3 * 60 + 24 * 60;
    nextKillzoneLabel = 'London Open (next day)';
  } else {
    sessionPhase = 'inter_session';
    phaseStartMin = 17 * 60;
    nextKillzoneMin = 3 * 60 + 24 * 60;
    nextKillzoneLabel = 'London Open (next day)';
  }
  const minutesIntoPhase = Math.max(0, etMinutesTotal - phaseStartMin);
  // The phase machine names the killzone its phase leads toward; that start can
  // already be past (pre_session_ny_am spans the NY AM killzone's first hour).
  // When it has passed, advance to the next start today before wrapping +24h.
  const KILLZONE_STARTS = [
    { min: LONDON_OPEN_KZ[0], label: 'London Open' },
    { min: NY_AM_KILLZONE[0], label: 'NY AM' },
    { min: NY_PM_KILLZONE[0], label: 'NY PM' },
  ];
  let secondsToNextKillzone = null;
  if (nextKillzoneMin >= 0) {
    let targetMin = nextKillzoneMin;
    if (targetMin <= etMinutesTotal) {
      const upcoming = KILLZONE_STARTS.find((k) => k.min > etMinutesTotal);
      if (upcoming) {
        targetMin = upcoming.min;
        nextKillzoneLabel = upcoming.label;
      } else {
        targetMin = KILLZONE_STARTS[0].min + 24 * 60;
        nextKillzoneLabel = `${KILLZONE_STARTS[0].label} (next day)`;
      }
    }
    secondsToNextKillzone = (targetMin - etMinutesTotal) * 60 - etSeconds;
  }

  return {
    label: sessionLabel,
    timestamp_et: fmt.format(new Date(ts)),
    day_of_week: weekday,
    is_weekend: isWeekend,
    is_market_closed: isMarketClosed,
    in_ny_open_window: inNyOpenWindow,
    in_killzone: inAnyKillzone,
    in_killzone_detail: {
      london_open: inLondonOpenKillzone,
      ny_am: inNyAmKillzone,
      ny_pm: inNyPmKillzone,
    },
    phase: sessionPhase,
    minutes_into_phase: minutesIntoPhase,
    next_killzone_label: nextKillzoneLabel,
    seconds_to_next_killzone: secondsToNextKillzone,
    replay: replayStatus,
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

/**
 * Switch the chart through each target timeframe; at each, fetch the bars
 * summary + the ICT Engine table (the engine recomputes for whatever TF the
 * chart is on). Restores the original timeframe when done.
 *
 * Cost: ~2-3s per TF switch (chart redraws + engine re-renders + 2 reads).
 * Strategy mandates per-TF data for Pillar 1a (HTF FVGs/structure) + Pillar 2
 * (HTF displacement) + entry-model walkthroughs that reference HTF imbalances.
 *
 * Returns: { bars_by_tf, engine_by_tf } keyed by TF. engine_by_tf holds the
 * parsed ICT Engine evidence table for that TF (null if the engine is absent).
 *
 * Implementation note: always call setTimeframe explicitly on every iteration
 * and on the final restore. Skipping based on "same as previous TF" has caused
 * "stuck on previous TF" bugs where reads return data at the wrong resolution.
 */
const TF_SETTLE_MS = 400;
async function captureMultiTf(originalTf) {
  const bars_by_tf = {};
  const engine_by_tf = {};
  for (const { tv, key } of HTF_LTF_TIMEFRAMES) {
    try {
      await chart.setTimeframe({ timeframe: tv });
      await new Promise((r) => setTimeout(r, TF_SETTLE_MS));
      const [bars, tables] = await Promise.all([
        data.getOhlcv({ summary: true }),
        data.getPineTables(),
      ]);
      bars_by_tf[key] = { ...bars, tv_resolution: tv };
      engine_by_tf[key] = parseIctEngineTable(findIctEngineRows(tables));
    } catch (e) {
      bars_by_tf[key] = { error: e.message, tv_resolution: tv };
      engine_by_tf[key] = null;
    }
  }
  // Restore original timeframe explicitly, regardless of the last iterated TF.
  try {
    await chart.setTimeframe({ timeframe: originalTf });
    await new Promise((r) => setTimeout(r, TF_SETTLE_MS));
  } catch (e) {
    // best-effort restore; fall through
  }
  return { bars_by_tf, engine_by_tf };
}

register('analyze', {
  description: 'Bundle current chart state, quote, multi-TF OHLCV summaries, the parsed ICT Engine evidence table (per TF), and deterministic gates (session + engine-derived 3 pillars) into one JSON object for ICT analysis by Claude.',
  options: {
    'current-tf-only': { type: 'boolean', description: 'Skip multi-TF capture (faster; no chart flashing). All other data still captured.' },
    'pillar3-only': { type: 'boolean', description: 'Alias for --current-tf-only. Skips the multi-TF chart sweep but captures everything else. Bundle runtime ~0.4–0.6s. Used by the live-trading polling loop.' },
    'scan-tf': { type: 'string', description: 'Briefly switch chart to this TF (1, 5, 15, 60, 240, D) for the scan, then restore. Pairs with --pillar3-only for the polling cadence. ~2–3s of chart flashing per call.' },
    baseline: { type: 'string', description: 'Path to a previously-captured full bundle. Reuses its bars_by_tf and engine_by_tf instead of re-running the multi-TF chart sweep. Pairs with --pillar3-only for fast candidate evaluation that still has full HTF context. Emits baseline_meta so the consumer can see how old the cached HTF data is.' },
    out: { type: 'string', description: 'Write bundle JSON to this path; stdout prints only {saved_to: <path>}. Use for bundles too large to pipe (>~60KB).' },
  },
  handler: async (opts) => {
    // 0. Load baseline if provided. The baseline supplies HTF context
    //    (bars_by_tf + engine_by_tf) so we don't have to re-flash the chart
    //    through 6 TFs every call. Strategy §2.4 explicitly allows reusing
    //    HTF context intraday: HTF bias doesn't change minute-to-minute.
    let baseline = null;
    let baselineMeta = null;
    if (opts?.baseline) {
      const { readFileSync } = await import('node:fs');
      const { resolve: resolvePath } = await import('node:path');
      const absPath = resolvePath(opts.baseline);
      let text;
      try {
        text = readFileSync(absPath, 'utf8');
      } catch (e) {
        throw new Error(`baseline not readable at '${absPath}': ${e.message}`);
      }
      try {
        baseline = JSON.parse(text);
      } catch (e) {
        throw new Error(`baseline at '${absPath}' is not valid JSON: ${e.message}`);
      }
      if (!baseline.bars_by_tf || !baseline.engine_by_tf) {
        throw new Error(
          `baseline at '${absPath}' is missing bars_by_tf or engine_by_tf — it must have been captured with full tv analyze (not --pillar3-only or --current-tf-only).`,
        );
      }
      const baselineMs = baseline.timestamp ? Date.parse(baseline.timestamp) : NaN;
      baselineMeta = {
        path: absPath,
        captured_at: baseline.timestamp || null,
        age_seconds: Number.isFinite(baselineMs) ? Math.floor((Date.now() - baselineMs) / 1000) : null,
      };
    }

    // 0.5. --scan-tf support. Switch the chart to the requested TF before
    //      capturing anything, so the bundle reflects scan-tf data. Restored
    //      below after the bundle is built.
    const scanTf = opts?.['scan-tf'];
    let preScanTf = null;
    if (scanTf) {
      const initial = await chart.getState();
      preScanTf = initial.resolution;
      if (preScanTf !== scanTf) {
        await chart.setTimeframe({ timeframe: scanTf });
        await new Promise((r) => setTimeout(r, TF_SETTLE_MS));
      }
    }

    // 1. Capture chart state + replay status. Chart may already be at
    //    scan-tf (if --scan-tf was supplied above). Multi-TF switching
    //    happens below and can disturb replay state.
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

    // 2. Multi-TF bar + engine collection. Sources, in priority order:
    //    a) --baseline path:  reuse from that bundle (no chart-switching)
    //    b) --pillar3-only / --current-tf-only: skip entirely (nulls)
    //    c) Default: capture fresh via captureMultiTf
    const pillar3Only = opts?.['pillar3-only'] === true;
    const skipMultiTf = pillar3Only || opts?.['current-tf-only'] === true;
    let bars_by_tf, engine_by_tf;
    if (baseline) {
      bars_by_tf = baseline.bars_by_tf;
      engine_by_tf = baseline.engine_by_tf;
    } else if (skipMultiTf) {
      bars_by_tf = null;
      engine_by_tf = null;
    } else {
      const captured = await captureMultiTf(originalTf);
      bars_by_tf = captured.bars_by_tf;
      engine_by_tf = captured.engine_by_tf;
    }

    // 3. At the (restored) original TF, fetch the current-TF data: visible
    //    range, quote, bars, indicator data-window values, and the Pine
    //    tables (the ICT Engine emits its evidence table there).
    const [visibleRange, quote, bars, indicatorValues, tables] = await Promise.all([
      chart.getVisibleRange(),
      data.getQuote(),
      data.getOhlcv({ summary: true }),
      data.getStudyValues(),
      data.getPineTables(),
    ]);

    // 4. Parse the ICT Engine table at the current TF and build the gates.
    //    Last-bar confirmation facts are bar-derived (cli/lib/last-bar.js) so
    //    the LLM never does candle math (constraint #7).
    const engine = parseIctEngineTable(findIctEngineRows(tables));
    const cur = lastBarFacts(bars?.last_5_bars, quote?.time);
    const m5 = lastBarFacts(bars_by_tf?.m5?.last_5_bars, quote?.time);
    const m15 = lastBarFacts(bars_by_tf?.m15?.last_5_bars, quote?.time);
    const gates = {
      session: computeSessionGate({ quote, replayStatus }),
      engine: computeEngineGates({
        engine,
        engineByTf: engine_by_tf,
        last: quote?.last ?? null,
        lastBar: cur.bar,
        lastBarAgeSeconds: cur.age_seconds,
        m5LastBar: m5.bar,
        m15LastBar: m15.bar,
      }),
    };

    const bundle = {
      timestamp: new Date().toISOString(),
      chart: state,
      visible_range: visibleRange,
      quote,
      bars,
      bars_by_tf,
      indicators: indicatorValues,
      engine,
      engine_by_tf,
      gates,
      ...(baselineMeta ? { baseline_meta: baselineMeta } : {}),
    };

    // 4.5. Restore the pre-scan TF if we switched for --scan-tf. Best-effort;
    //      a failed restore leaves the chart on scan-tf which the next tick
    //      re-snaps.
    if (scanTf && preScanTf && preScanTf !== scanTf) {
      try {
        await chart.setTimeframe({ timeframe: preScanTf });
        await new Promise((r) => setTimeout(r, TF_SETTLE_MS));
      } catch (e) {
        process.stderr.write(`warning: failed to restore TF ${preScanTf} after --scan-tf ${scanTf}: ${e.message}\n`);
      }
    }

    // 5. Optional file output: write bundle to disk and print only the path.
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

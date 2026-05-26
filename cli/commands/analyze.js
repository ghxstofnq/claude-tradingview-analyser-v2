import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';
import * as replay from '@tvmcp/core/replay';
import { findIctEngineRows, parseIctEngineTable } from '../lib/ict-engine-parser.js';
import { computeEngineGates } from '../lib/compute-engine-gates.js';
import { lastBarFacts } from '../lib/last-bar.js';
import { computeLeader } from '../lib/compute-leader.js';
import { readPairDecision } from '../lib/pair-decision.js';
import { buildBriefDigest } from '../lib/brief-digest.js';

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

// Trim bars_by_tf and engine_by_tf to {m1, m5} only — used by --pillar3-only
// to keep the per-bar polling bundle small enough for one Read call.
// HTF (daily/h4/h1/m15) context lives in pillar1.md / pillar2.md from the
// brief, and Pillar 1 live signals are in gates.engine.pillar1.* — Claude
// doesn't need the raw HTF arrays on every bar.
const POLL_TFS_KEEP = ['m1', 'm5'];
function trimByTf(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of POLL_TFS_KEEP) if (k in obj) out[k] = obj[k];
  return out;
}
function slimForPolling(bundle) {
  if (bundle.engine_by_tf) bundle.engine_by_tf = trimByTf(bundle.engine_by_tf);
  if (bundle.bars_by_tf)   bundle.bars_by_tf   = trimByTf(bundle.bars_by_tf);
  if (bundle.pair?.symbols) {
    for (const sym of Object.keys(bundle.pair.symbols)) {
      const sub = bundle.pair.symbols[sym];
      if (sub.engine_by_tf) sub.engine_by_tf = trimByTf(sub.engine_by_tf);
      if (sub.bars_by_tf)   sub.bars_by_tf   = trimByTf(sub.bars_by_tf);
    }
  }
  return bundle;
}

// projectSlim — build the entry-hunt projection (~5-10 KB) written alongside
// the full --out file as <out>.slim.json when --pillar3-only is set. The
// per-bar handler points Claude at this slim instead of the full ~60 KB bundle,
// so Read returns it in one chunk (no chunking / no staleness drift).
//
// Keeps only what the entry-hunt loop consumes per the in-app Claude's own
// list: quote.last, last ~10 engine events of each kind, engine.quality,
// gates.session, gates.engine.{pillar1, pillar2, confirmation, price_context}.
// Drops bars/bars_by_tf/indicators/baseline_meta — session-memory bars.jsonl
// already carries bar context; indicator values are summarized into gates.
const SLIM_TAIL_N = 10;
function tailArr(a) { return Array.isArray(a) ? a.slice(-SLIM_TAIL_N) : a; }
function slimEngine(e) {
  if (e == null) return null;
  return {
    schema: e.schema,
    schema_supported: e.schema_supported,
    meta: e.meta,
    quality: e.quality,
    levels: e.levels,
    fvgs: tailArr(e.fvgs),
    bprs: tailArr(e.bprs),
    sweeps: tailArr(e.sweeps),
    swings: tailArr(e.swings),
    structures: tailArr(e.structures),
  };
}
function slimGates(g) {
  if (g == null) return null;
  const out = { session: g.session };
  if (g.engine) {
    out.engine = {
      meta: g.engine.meta,
      price_context: g.engine.price_context,
      pillar1: g.engine.pillar1,
      pillar2: g.engine.pillar2,
      confirmation: g.engine.confirmation,
    };
  }
  return out;
}
function slimEngineByTf(byTf) {
  if (byTf == null || typeof byTf !== 'object') return byTf;
  const out = {};
  for (const k of Object.keys(byTf)) out[k] = slimEngine(byTf[k]);
  return out;
}
function slimSymbolBundle(sub) {
  return {
    chart: sub.chart,
    quote: sub.quote ? { last: sub.quote.last, time: sub.quote.time, ohlc: sub.quote.ohlc } : null,
    engine: slimEngine(sub.engine),
    engine_by_tf: slimEngineByTf(sub.engine_by_tf),
    gates: slimGates(sub.gates),
  };
}
function projectSlim(bundle) {
  const slim = {
    timestamp: bundle.timestamp,
    chart: bundle.chart,
    quote: bundle.quote
      ? { last: bundle.quote.last, time: bundle.quote.time, ohlc: bundle.quote.ohlc }
      : null,
    engine: slimEngine(bundle.engine),
    engine_by_tf: slimEngineByTf(bundle.engine_by_tf),
    gates: slimGates(bundle.gates),
  };
  if (bundle.pair?.symbols) {
    slim.pair = {
      primary: bundle.pair.primary,
      secondary: bundle.pair.secondary,
      leader: bundle.pair.leader,
      leader_decided: bundle.pair.leader_decided,
      leader_evidence: bundle.pair.leader_evidence,
      window_start_ms: bundle.pair.window_start_ms,
      window_end_ms: bundle.pair.window_end_ms,
      symbols: {},
    };
    for (const sym of Object.keys(bundle.pair.symbols)) {
      slim.pair.symbols[sym] = slimSymbolBundle(bundle.pair.symbols[sym]);
    }
  }
  return slim;
}

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
// setSymbol() already waits ~500ms internally + polls for chart-ready, but
// indicator re-renders on the new symbol can lag a bit longer. 600ms slack
// keeps the engine table populated before we read it.
const SYMBOL_SETTLE_MS = 600;

/**
 * activeSessionFolder — derives today's ET date + active session folder
 * (ny-am / ny-pm / london) from the current real-time ET clock.
 *
 * Mirrors app/main/sessions.js#currentSession so the two sides agree on
 * which folder to read/write. Returns null when the clock is outside all
 * three windows (e.g. inter-session, weekend) — short-circuit logic skips
 * the lookup in that case.
 */
function activeSessionFolder() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return { date, session: null };
  const m = Number(get('hour')) * 60 + Number(get('minute'));
  let session = null;
  if (m >= 9 * 60 + 30 && m < 12 * 60) session = 'ny-am';
  else if (m >= 13 * 60 && m < 16 * 60) session = 'ny-pm';
  else if (m >= 3 * 60 && m < 6 * 60) session = 'london';
  return { date, session };
}

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

/**
 * captureSymbolBundle — used only for the secondary symbol in a --pair
 * capture. Switches the chart to `symbol`, FORCES the TF to match the
 * primary's `originalTf` (TV remembers TF per symbol, so the secondary
 * would otherwise land on whatever TF was last used there — apples-to-
 * oranges comparison). Grabs the same shape of fields the primary capture
 * produces. Leaves the chart on the secondary for the caller to switch
 * back to the primary.
 *
 * Returns the same nested shape the bundle uses for `pair.symbols.<X>`.
 *
 * @param {string} symbol               e.g. "MES1!" (bare; no exchange prefix)
 * @param {string} originalTf           primary's TF, used both to align the
 *                                      secondary's current TF and as the
 *                                      restore target inside captureMultiTf
 * @param {object|null} baselineSecondary  if present, reuses bars_by_tf +
 *                                         engine_by_tf instead of sweeping
 * @param {object} replayStatus         echoed into the secondary's
 *                                      session gate so it matches primary
 */
async function captureSymbolBundle(symbol, originalTf, baselineSecondary, replayStatus) {
  await chart.setSymbol({ symbol });
  await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
  // Force secondary's TF to match primary's so the current-TF data is
  // comparable. captureMultiTf below restores this TF after sweeping the
  // others, so the chart is left on (secondary, originalTf).
  await chart.setTimeframe({ timeframe: originalTf });
  await new Promise((r) => setTimeout(r, TF_SETTLE_MS));

  let bars_by_tf, engine_by_tf;
  if (baselineSecondary) {
    bars_by_tf = baselineSecondary.bars_by_tf;
    engine_by_tf = baselineSecondary.engine_by_tf;
  } else {
    const captured = await captureMultiTf(originalTf);
    bars_by_tf = captured.bars_by_tf;
    engine_by_tf = captured.engine_by_tf;
  }

  const state = await chart.getState();
  const [visibleRange, quote, bars, indicatorValues, tables] = await Promise.all([
    chart.getVisibleRange(),
    data.getQuote(),
    data.getOhlcv({ summary: true }),
    data.getStudyValues(),
    data.getPineTables(),
  ]);
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
      // quote.time is unix seconds; Pine emits emit_ms in unix ms.
      quoteTimeMs: typeof quote?.time === 'number' ? quote.time * 1000 : null,
    }),
  };
  return {
    chart: state,
    visible_range: visibleRange,
    quote,
    bars,
    bars_by_tf,
    indicators: indicatorValues,
    engine,
    engine_by_tf,
    gates,
  };
}

register('analyze', {
  description: 'Bundle current chart state, quote, multi-TF OHLCV summaries, the parsed ICT Engine evidence table (per TF), and deterministic gates (session + engine-derived 3 pillars) into one JSON object for ICT analysis by Claude.',
  options: {
    'current-tf-only': { type: 'boolean', description: 'Skip multi-TF capture (faster; no chart flashing). All other data still captured.' },
    'pillar3-only': { type: 'boolean', description: 'Alias for --current-tf-only. Skips the multi-TF chart sweep but captures everything else. Bundle runtime ~0.4–0.6s. Used by the live-trading polling loop.' },
    'scan-tf': { type: 'string', description: 'Briefly switch chart to this TF (1, 5, 15, 60, 240, D) for the scan, then restore. Pairs with --pillar3-only for the polling cadence. ~2–3s of chart flashing per call.' },
    baseline: { type: 'string', description: 'Path to a previously-captured full bundle. Reuses its bars_by_tf and engine_by_tf instead of re-running the multi-TF chart sweep. Pairs with --pillar3-only for fast candidate evaluation that still has full HTF context. Emits baseline_meta so the consumer can see how old the cached HTF data is.' },
    out: { type: 'string', description: 'Write bundle JSON to this path; stdout prints only {saved_to: <path>}. Use for bundles too large to pipe (>~60KB).' },
    pair: { type: 'string', description: 'Run dual-symbol scan. Format: "<primary>,<secondary>" (e.g. "MNQ1!,MES1!"). Captures both symbols; output bundle gains a top-level `pair` block. Behavior depends on pair-decision.json state for the active session.' },
    'baseline-secondary': { type: 'string', description: 'Per-symbol baseline path for the secondary symbol when using --pair. The primary uses --baseline as today.' },
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

    // 0.4. Parse --pair "<primary>,<secondary>". Both symbols required. The
    //      chart's current symbol MUST equal one of the two — we never
    //      silently swap (the user's chart state is sacrosanct).
    let pairConfig = null;
    if (opts?.pair) {
      const parts = String(opts.pair).split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length !== 2) {
        throw new Error(`--pair expects "<primary>,<secondary>"; got '${opts.pair}'`);
      }
      pairConfig = { primary: parts[0], secondary: parts[1] };
    }

    // 0.42. Pair-decision short-circuit. If --pair was passed AND a
    //       pair-decision.json exists for today's active session AND its
    //       leader is set, drop pairConfig + switch the chart to the leader,
    //       then run a normal single-symbol capture. Saves the dual-capture
    //       cost for the rest of the session after Claude has called
    //       surface_leader_decision at minute 14.
    let pairShortCircuited = false;
    if (pairConfig) {
      const { date: today, session: sessionFolder } = activeSessionFolder();
      if (sessionFolder) {
        const { resolve: resolvePath } = await import('node:path');
        const sessionDir = resolvePath('state', 'session', today, sessionFolder);
        const decision = await readPairDecision(sessionDir, today);
        if (decision && decision.leader) {
          // Switch the chart to the leader if it's not already there.
          const state0 = await chart.getState();
          const bare0 = state0.symbol.replace(/^[A-Z_]+:/, '');
          if (bare0 !== decision.leader) {
            await chart.setSymbol({ symbol: decision.leader });
            await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
          }
          process.stderr.write(
            `[tv analyze] pair-decision.json found for ${sessionFolder} ${today}: leader=${decision.leader}. Running single-symbol.\n`,
          );
          pairConfig = null;
          pairShortCircuited = true;
        }
      }
    }

    // 0.45. Per-symbol baseline for the secondary leg. Loaded the same way as
    //       --baseline, used by captureSymbolBundle so the fast-poll path
    //       (--pillar3-only --baseline ... --baseline-secondary ...) stays
    //       quick for dual-symbol scans.
    let baselineSecondary = null;
    let baselineSecondaryMeta = null;
    if (opts?.['baseline-secondary']) {
      const { readFileSync } = await import('node:fs');
      const { resolve: resolvePath } = await import('node:path');
      const absPath = resolvePath(opts['baseline-secondary']);
      let text;
      try { text = readFileSync(absPath, 'utf8'); }
      catch (e) { throw new Error(`baseline-secondary not readable at '${absPath}': ${e.message}`); }
      try { baselineSecondary = JSON.parse(text); }
      catch (e) { throw new Error(`baseline-secondary at '${absPath}' is not valid JSON: ${e.message}`); }
      if (!baselineSecondary.bars_by_tf || !baselineSecondary.engine_by_tf) {
        throw new Error(
          `baseline-secondary at '${absPath}' is missing bars_by_tf or engine_by_tf — must be a full tv analyze capture.`,
        );
      }
      const baseMs = baselineSecondary.timestamp ? Date.parse(baselineSecondary.timestamp) : NaN;
      baselineSecondaryMeta = {
        path: absPath,
        captured_at: baselineSecondary.timestamp || null,
        age_seconds: Number.isFinite(baseMs) ? Math.floor((Date.now() - baseMs) / 1000) : null,
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
    const originalSymbol = state.symbol;        // e.g. "CME_MINI:MNQ1!"

    // Validate --pair against the chart's current symbol. chart.getState()
    // returns the fully-qualified symbol with exchange prefix; strip it for
    // comparison against the user-supplied shorthand (e.g. "MNQ1!").
    if (pairConfig) {
      const bare = originalSymbol.replace(/^[A-Z_]+:/, '');
      if (bare !== pairConfig.primary && bare !== pairConfig.secondary) {
        throw new Error(
          `--pair expects chart on one of [${pairConfig.primary}, ${pairConfig.secondary}]; got '${bare}'`,
        );
      }
      // Normalize: the chart's current symbol is treated as primary
      // throughout the capture. If the user supplied the order swapped,
      // flip pairConfig so primary == originalSymbol.
      if (bare === pairConfig.secondary) {
        pairConfig = { primary: pairConfig.secondary, secondary: pairConfig.primary };
      }
    }

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
        // quote.time is unix seconds; Pine emits emit_ms in unix ms.
        quoteTimeMs: typeof quote?.time === 'number' ? quote.time * 1000 : null,
      }),
    };

    // 4.4. --pair dual-capture. After the primary's bundle is fully built,
    //      switch to the secondary, capture the same shape, switch back.
    //      compute-leader runs the displacement comparison; the verdict
    //      is recorded as evidence — pair.leader stays null here.
    //      surface_leader_decision (in-app Claude) writes pair.leader to
    //      pair-decision.json at minute 14 of the open reaction.
    let pair = null;
    if (pairConfig) {
      const secondaryBundle = await captureSymbolBundle(
        pairConfig.secondary,
        originalTf,
        baselineSecondary,
        replayStatus,
      );
      // Restore chart to the primary so any later operations see original
      // state. captureSymbolBundle leaves the chart on the secondary; we
      // also restore the primary's TF since setSymbol may have landed on
      // whatever TF was last used on the primary.
      await chart.setSymbol({ symbol: pairConfig.primary });
      await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
      await chart.setTimeframe({ timeframe: originalTf });
      await new Promise((r) => setTimeout(r, TF_SETTLE_MS));

      // Open-reaction window: gates.session.label is e.g. "open_reaction_ny_am".
      // If we have a window_start_ms, use it; otherwise pass Infinity so
      // compute-leader returns leader=null with reason="no_fvgs_created_in_window".
      const sessionGate = gates.session;
      const windowStartMs =
        Number.isFinite(sessionGate?.open_window_start_ms)
          ? sessionGate.open_window_start_ms
          : null;
      const windowEndMs =
        windowStartMs != null ? windowStartMs + 15 * 60 * 1000 : null;

      const leader = computeLeader({
        primary: pairConfig.primary,
        secondary: pairConfig.secondary,
        primaryEngine: engine,
        secondaryEngine: secondaryBundle.engine,
        windowStartMs: windowStartMs ?? Number.POSITIVE_INFINITY,
        windowEndMs: windowEndMs ?? Number.POSITIVE_INFINITY,
      });

      pair = {
        primary: pairConfig.primary,
        secondary: pairConfig.secondary,
        window_start_ms: windowStartMs,
        window_end_ms: windowEndMs,
        symbols: {
          [pairConfig.primary]: {
            chart: state,
            visible_range: visibleRange,
            quote,
            bars,
            bars_by_tf,
            indicators: indicatorValues,
            engine,
            engine_by_tf,
            gates,
          },
          [pairConfig.secondary]: secondaryBundle,
        },
        leader_evidence: {
          primary_disp_score: leader.primary_disp_score,
          secondary_disp_score: leader.secondary_disp_score,
          margin: leader.margin,
          threshold: leader.threshold,
          reason: leader.reason,
          // cite-or-reject anchors. The exact FVG index isn't plumbed
          // through compute-leader in v1 — paths point at the array.
          primary_fvg_path: leader.primary_disp_score > 0
            ? `pair.symbols.${pairConfig.primary}.engine.fvgs`
            : null,
          secondary_fvg_path: leader.secondary_disp_score > 0
            ? `pair.symbols.${pairConfig.secondary}.engine.fvgs`
            : null,
        },
        leader_decided: false,
        leader: null,    // set by surface_leader_decision, not by tv analyze
      };

      // Loud warning when the secondary engine is missing so the user can
      // load the ICT Engine indicator on the secondary chart and retry.
      if (leader.reason === 'secondary_engine_missing') {
        process.stderr.write(
          `warning: ICT Engine missing on ${pairConfig.secondary}. Leader pick will be inconclusive until the engine is loaded on both charts.\n`,
        );
      }
    }

    let bundle = {
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
      ...(baselineSecondaryMeta ? { baseline_secondary_meta: baselineSecondaryMeta } : {}),
      ...(pair ? { pair } : {}),
      ...(pairShortCircuited ? { pair_short_circuited: true } : {}),
    };

    // 4.6. Slim the bundle for --pillar3-only polling. Strip HTF (Daily /
    //      4H / 1H / 15m) bar arrays and engine sub-tables — those are
    //      ~64 KB of redundant data the per-bar handler doesn't need:
    //      HTF context is already captured in pillar1.md by the brief, and
    //      Pillar 1 live signals (session levels, draw, swept status) are
    //      in gates.engine.pillar1.*. Keeps only m1 + m5 in *_by_tf so the
    //      bundle drops from ~130 KB → ~35 KB (single) / ~70 KB (paired),
    //      which fits in one Claude Read call instead of forcing chunked
    //      reads that take 30s+ per turn.
    if (pillar3Only) slimForPolling(bundle);

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

    // 4b. Brief digest — slim per-symbol summary at the TOP of the bundle
    //     (key insertion order = JSON serialization order). The whole point
    //     is for the brief turn to find this field in Read's first chunk;
    //     appending at the end leaves it past chars 440k after the 304KB
    //     `pair` block, defeating the purpose. Rebuild the bundle with
    //     brief_digest as the first key. Only emitted when --pair is set;
    //     single-symbol bundles return null and skip the field.
    //
    //     Observed live 2026-05-26 NY AM brief: digest was appended at end
    //     of object → unreachable → model fell back to citing
    //     bars_by_tf.daily.change_pct (which it couldn't resolve either)
    //     and graded no-trade with no_trade_reason=data_gap.
    const briefDigest = buildBriefDigest(bundle);
    if (briefDigest) {
      bundle = { brief_digest: briefDigest, ...bundle };
    }

    // 4c. Detector — pre-compute candidate setups for entry_hunt phase.
    //     Spec: docs/superpowers/specs/2026-05-26-strategy-detector-design.md
    //     At analyze time, brief context (htf_destination, leader, untaken
    //     targets) isn't available yet — the brief turn hasn't run. The
    //     detector handles wait states gracefully and returns a defined
    //     shape ({best_candidate: null, rejection_summary: "Awaiting..."}).
    //     bar-close.js re-runs the detector with brief data read from disk
    //     before each entry_hunt bar.
    try {
      const { detectSetups } = await import('../lib/setup-detector.js');
      const leader = bundle?.brief_digest?.leader ?? null;
      const ltfBiasContext = bundle?.brief_digest?.ltf_bias_context ?? {};
      const symKey = Object.keys(bundle?.brief_digest?.symbols ?? {})[0] ?? null;
      const untakenAbove = symKey ? (bundle.brief_digest.symbols[symKey]?.pillar1?.untaken_pools_above ?? []) : [];
      const untakenBelow = symKey ? (bundle.brief_digest.symbols[symKey]?.pillar1?.untaken_pools_below ?? []) : [];
      const candidates = detectSetups({
        bundle,
        leader,
        ltf_bias_context: ltfBiasContext,
        untaken_targets: { untaken_above: untakenAbove, untaken_below: untakenBelow },
      });
      bundle = { ...bundle, candidates };
    } catch (err) {
      bundle = {
        ...bundle,
        candidates: { best_candidate: null, rejections: [], rejection_summary: `Detector error: ${err.message}`, meta: { detector_version: '1.0', error: true } },
      };
    }

    // 5. Optional file output: write bundle to disk and print only the path.
    //    Lets the slash command Read the file instead of relying on Bash
    //    captured stdout, which has 30K-100K truncation limits depending on env.
    if (opts?.out) {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname, resolve } = await import('node:path');
      const absPath = resolve(opts.out);
      mkdirSync(dirname(absPath), { recursive: true });
      // Compact JSON (no indentation). Pretty-printing turns a 140KB paired
      // bundle into 8869 lines and Claude's Read tool defaults to a 2000-
      // line cap, which silently truncated engine_by_tf — Claude's no-trade
      // reasons started saying "analyze bundle exceeded context, engine
      // layer unread". Compact = 1 line, full bundle returned in one Read.
      // The dashboard + harness JSON.parse this fine; nobody reads it raw.
      const bundleText = JSON.stringify(bundle);
      writeFileSync(absPath, bundleText);

      // Sibling slim projection (~5-10 KB) for --pillar3-only polling.
      // Read returns it in one chunk; entry-hunt prompt points Claude here
      // instead of the full bundle. See projectSlim() above for shape.
      let slimPath = null;
      let slimBytes = null;
      if (pillar3Only) {
        slimPath = absPath.endsWith('.json')
          ? absPath.replace(/\.json$/, '.slim.json')
          : absPath + '.slim';
        const slimText = JSON.stringify(projectSlim(bundle));
        writeFileSync(slimPath, slimText);
        slimBytes = slimText.length;
      }

      // Sibling brief-digest file (~17KB pretty-printed) for the brief turn.
      // The full bundle is one ~440KB line — Read truncates each line at
      // ~2000 chars, so even with brief_digest at the top, only the first
      // ~2% of it is visible to the model. Pretty-print the digest in its
      // own file so each field lands on its own line; ~500 lines fits in
      // Read's 2000-line cap with plenty of headroom. Mirrors the
      // pillar3-only slim pattern above.
      //
      // Observed live 2026-05-26 NY AM (retry after digest-at-top fix):
      // model still said "Read refuses files this size even at limit=1" —
      // confirming per-line truncation, not whole-file cap, is the wall.
      let digestPath = null;
      let digestBytes = null;
      if (briefDigest) {
        digestPath = absPath.endsWith('.json')
          ? absPath.replace(/\.json$/, '.digest.json')
          : absPath + '.digest';
        const digestText = JSON.stringify(briefDigest, null, 2);
        writeFileSync(digestPath, digestText);
        digestBytes = digestText.length;
      }

      return {
        saved_to: absPath,
        bytes: bundleText.length,
        ...(slimPath ? { slim_saved_to: slimPath, slim_bytes: slimBytes } : {}),
        ...(digestPath ? { digest_saved_to: digestPath, digest_bytes: digestBytes } : {}),
      };
    }
    return bundle;
  },
});

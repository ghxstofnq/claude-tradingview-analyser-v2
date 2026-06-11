/**
 * tape-recorder.js — backfill a historical session into a walker day-tape by
 * stepping TradingView's bar replay one 1m bar at a time and capturing the
 * ICT Engine's recomputed table at each step.
 *
 * Why replay-stepping: a day tape needs the engine's PER-BAR state (zone
 * lifecycle, swings, quality as they evolved), which only exists while the
 * indicator actually computes bar by bar. A post-hoc capture carries today's
 * table — useless for "what did the chart say at 09:46". Replay makes the
 * indicator recompute on the replayed series; we harvest each step.
 *
 * The per-bar inputs are shaped exactly like the live path's
 * (app/main/bar-close.js#buildDetectorInputs): the recorded tape folds
 * through the same buildDeterministicPacketTruthFromInputs the live loop
 * runs — no parallel shapes.
 *
 * Session context (bias, alignment, targets) comes from the hand-written
 * real-session label — the same hand-truth the snapshot cases use. The
 * engine evidence is NOT bridged by hand here; it is whatever the indicator
 * actually emitted at each replayed bar. That is the point.
 *
 * Staleness domains: bars carry historical (replayed) timestamps; the engine
 * emits at TODAY's wall clock. Bar-age facts use the bar domain; engine
 * emit-freshness uses the wall clock (captureNowMs). Mixing them would mark
 * every replayed bar stale_source.
 *
 * Pure + dependency-injected; the CLI command wires real CDP deps.
 */

import { computeEngineGates } from './compute-engine-gates.js';
import { lastBarFacts } from './last-bar.js';
import { tfMatchesMeta } from './tf-capture.js';

const SESSION_NAME_MAP = { 'NY AM': 'ny-am', 'NY PM': 'ny-pm', LONDON: 'london' };

function bareSymbol(label) {
  return String(label?.contract_hint ?? label?.symbol ?? '').replace(/^[A-Z_]+:/, '');
}

/**
 * Static per-session context derived from the hand-written label — the same
 * fields the live loop reads from brief.json / ltf-bias.md / pair-decision.
 */
export function contextFromLabel(label) {
  const side = label?.expected?.side === 'short' ? 'short' : 'long';
  const bias = side === 'short' ? 'bearish' : 'bullish';
  const dir = side === 'short' ? 'below' : 'above';
  const targets = ['tp1', 'tp2']
    .map((field) => ({ price: Number(label?.expected?.[field]), name: `label_${field}`, cite: `label.expected.${field}` }))
    .filter((t) => Number.isFinite(t.price));
  return {
    session: SESSION_NAME_MAP[String(label?.session ?? '').toUpperCase()] ?? 'ny-am',
    leader: bareSymbol(label),
    ltf_bias_context: {
      bias,
      htf_ltf_alignment: 'aligned',
      is_retrace_day: false,
      entry_model_priority: label?.expected?.model ?? 'undecided',
      grade_cap: label?.expected?.grade ?? 'A+',
    },
    session_state: {
      pillar1: { status: 'pass', htfBias: bias, htfDraw: `${dir} ${targets[0]?.name ?? 'label target'}`, primaryDraw: targets[0]?.name ?? 'label target' },
      pillar2: { status: 'pass', verdict: 'pass' },
    },
    untaken_targets: {
      untaken_above: side === 'short' ? [] : targets,
      untaken_below: side === 'short' ? targets : [],
    },
    brief_digest: {
      htf_destination: { dir, price: targets[0]?.price ?? null, cite: targets[0]?.cite ?? 'label.expected.tp1' },
      primary_draw: { name: targets[0]?.name ?? 'label target', price: targets[0]?.price ?? null, cite: targets[0]?.cite ?? 'label.expected.tp1' },
    },
  };
}

/**
 * One tape entry from one replayed bar: the engine table parsed at this step
 * plus bar facts, run through the SAME computeEngineGates the live analyzer
 * uses. event.ts is the close time of the last completed replayed 1m bar.
 */
/**
 * TradingView replay always renders the NEXT forming bar after the replay
 * position (at its open price). Only the bars before it are closed; treating
 * the forming bar as a close shifted every recorded event one bar late with
 * a wrong price (verified against the 2026-06-09 capture-replay bars).
 */
function closedBarsOnly(bars) {
  const all = bars?.last_5_bars ?? [];
  return { ...bars, last_5_bars: all.slice(0, Math.max(0, all.length - 1)) };
}

export function buildTapeEntry({ engine, bars: rawBars, context, captureNowMs = Date.now() }) {
  const bars = closedBarsOnly(rawBars);
  const lastBar = bars?.last_5_bars?.[bars.last_5_bars.length - 1] ?? null;
  const barCloseSeconds = lastBar ? Number(lastBar.time) + 60 : null;
  const cur = lastBarFacts(bars?.last_5_bars, barCloseSeconds);
  const gates = {
    engine: computeEngineGates({
      engine,
      engineByTf: null,
      last: lastBar?.close ?? null,
      lastBar: cur.bar,
      lastBarAgeSeconds: cur.age_seconds,
      m5LastBar: null,
      m15LastBar: null,
      // wall clock: the engine emitted moments ago even though the bars are
      // historical — see staleness-domains note in the module header.
      quoteTimeMs: captureNowMs,
    }),
  };
  return {
    event: { ts: new Date(barCloseSeconds * 1000).toISOString(), tf: '1m' },
    inputs: {
      bundle: {
        chart: { symbol: context.leader },
        quote: { symbol: context.leader, last: lastBar?.close ?? null, time: barCloseSeconds },
        bars,
        bars_by_tf: { m5: { last_5_bars: [] } },
        engine,
        gates,
        brief_digest: context.brief_digest,
      },
      leader: context.leader,
      ltf_bias_context: context.ltf_bias_context,
      session_state: context.session_state,
      untaken_targets: context.untaken_targets,
    },
  };
}

function etToEpochSeconds(dateStr, timeStr) {
  // Reuses the EDT/EST trial logic semantics from packages/core/replay.js.
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const [hh, mm = 0] = String(timeStr).split(':').map(Number);
  const t1 = Date.UTC(y, mo - 1, d, hh + 4, mm) / 1000;
  const etHour = Number(new Date(t1 * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }));
  if (etHour % 24 === hh) return t1;
  return Date.UTC(y, mo - 1, d, hh + 5, mm) / 1000;
}

/**
 * Step replay across [fromEt, toEt] and capture one entry per closed 1m bar.
 * deps: { startReplay, stepReplay, stopReplay, readBars, readEngine, sleep, nowMs? }
 * Engine freshness per step: poll until meta.emit_ms changes from the
 * previous step (the indicator recomputed) AND meta.tf is the 1m chart.
 * A step that never re-emits is captured anyway with a warning — the fold's
 * source-health gate judges it; silence is the one thing not allowed.
 *
 * recordEntries is the context-independent loop (the backtest engine passes
 * a context built from the day's brief/ltf-bias instead of a hand label);
 * recordTape keeps the label-driven CLI surface on top of it.
 */
export async function recordEntries({
  context,
  date,
  fromEt = '09:30',
  toEt = '12:00',
  deps,
  pollIntervalMs = 400,
  stepDeadlineMs = 8000,
  onBar = null,
  isStopped = null,
}) {
  const nowMs = deps.nowMs ?? Date.now;
  const toEpoch = etToEpochSeconds(date, toEt);
  const entries = [];
  const warnings = [];

  await deps.startReplay({ date, time: fromEt });
  try {
    let prevEmit = null;
    let prevBarTime = null;
    // Hard cap: minutes in window + slack. Guards against a replay that
    // stops advancing (e.g. data gap) looping forever.
    const maxSteps = Math.ceil((toEpoch - etToEpochSeconds(date, fromEt)) / 60) + 10;

    for (let i = 0; i < maxSteps && !(isStopped?.()); i += 1) {
      // Poll until this step's bar + engine emit are visible.
      const deadline = Math.max(1, Math.ceil(stepDeadlineMs / pollIntervalMs));
      let bars = null;
      let engine = null;
      let fresh = false;
      for (let attempt = 0; attempt < deadline; attempt += 1) {
        bars = await deps.readBars();
        const closed = closedBarsOnly(bars).last_5_bars;
        const lastClosed = closed[closed.length - 1];
        const candidate = await deps.readEngine();
        const emitChanged = candidate?.meta?.emit_ms != null && candidate.meta.emit_ms !== prevEmit;
        const barAdvanced = lastClosed && (prevBarTime == null || Number(lastClosed.time) > prevBarTime);
        if (candidate?.schema_supported && tfMatchesMeta('1', candidate?.meta?.tf) && emitChanged && barAdvanced) {
          engine = candidate;
          fresh = true;
          break;
        }
        engine = candidate ?? engine;
        if (attempt < deadline - 1) await deps.sleep(pollIntervalMs);
      }
      if (!fresh) {
        warnings.push(`bar ${i}: engine did not re-emit within ${stepDeadlineMs}ms (captured anyway)`);
      }

      const closed = closedBarsOnly(bars).last_5_bars;
      const lastBar = closed[closed.length - 1];
      if (!lastBar) throw new Error(`replay step ${i}: no closed bars readable`);
      prevEmit = engine?.meta?.emit_ms ?? prevEmit;
      prevBarTime = Number(lastBar.time);

      entries.push(buildTapeEntry({ engine, bars, context, captureNowMs: nowMs() }));
      onBar?.({ bar: entries.length, total: maxSteps - 10 });

      const barClose = Number(lastBar.time) + 60;
      if (barClose >= toEpoch) break;
      await deps.stepReplay();
    }
  } finally {
    try { await deps.stopReplay(); } catch { /* best-effort chart restore */ }
  }

  return { entries, warnings, context };
}

export async function recordTape({
  label,
  fromEt = '09:30',
  toEt = '12:00',
  deps,
  pollIntervalMs = 400,
  stepDeadlineMs = 8000,
}) {
  const context = contextFromLabel(label);
  return recordEntries({ context, date: label.trade_date, fromEt, toEt, deps, pollIntervalMs, stepDeadlineMs });
}

/** Assemble the tape file. Lands unverified — hand-grading freezes it. */
export function tapeFromRecording({ label, entries, fixture = null }) {
  const context = contextFromLabel(label);
  return {
    fixture: fixture ?? `${label.trade_date}-${context.session}-replay`,
    date: label.trade_date,
    session: context.session,
    source: 'tv-replay-stepping',
    verified: false,
    expected: {
      outcome: label?.expected?.outcome ?? 'trade',
      model: label?.expected?.model ?? null,
      side: label?.expected?.side ?? null,
    },
    entries,
  };
}

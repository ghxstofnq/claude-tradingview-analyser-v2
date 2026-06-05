import { evaluateSourceHealth, isTradableSourceHealth } from '../../app/main/strategy/context/source-health.js';

const DEFAULT_SYMBOL_PATTERNS = [/MNQ/i, /MES/i];
const DEFAULT_TIMEFRAMES = new Set(['1', '5', '15']);
const DEFAULT_MAX_BAR_AGE_MS = 180_000;
const TRADABLE_SESSIONS = new Set(['ny-am', 'ny-pm', 'london']);
const SESSION_WINDOWS_ET = {
  'ny-am': { start: 9 * 60 + 30, end: 12 * 60 },
  'ny-pm': { start: 13 * 60, end: 16 * 60 },
  london: { start: 3 * 60, end: 6 * 60 },
};

function etMinutesFromMs(nowMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(Number(nowMs)));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function sessionIsActive(session, nowMs) {
  const window = SESSION_WINDOWS_ET[session];
  if (!window) return false;
  const mins = etMinutesFromMs(nowMs);
  return mins >= window.start && mins < window.end;
}

function pass(details = {}) {
  return { status: 'pass', ...details };
}

function fail(blockers, details = {}) {
  return { status: 'fail', blockers: Array.isArray(blockers) ? blockers : [blockers], ...details };
}

function replayStarted(ui = {}, replay = {}) {
  return ui?.replay?.started === true
    || ui?.replay?.is_replay_started === true
    || replay?.started === true
    || replay?.is_replay_started === true;
}

function normalizeResolution(value) {
  if (value == null) return 'unknown';
  return String(value).replace(/m$/i, '');
}

function symbolIsMnqMes(symbol, patterns = DEFAULT_SYMBOL_PATTERNS) {
  const text = String(symbol ?? '');
  return patterns.some((pattern) => pattern.test(text));
}

function barAgeMs({ bar, nowMs }) {
  const raw = bar?.bar_close_time ?? bar?.closeTime ?? bar?.ts ?? bar?.time_utc ?? bar?.time;
  const parsed = typeof raw === 'number' ? (raw > 10_000_000_000 ? raw : raw * 1000) : Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Number(nowMs) - parsed;
}

function engineRowsForHealth(engine = {}) {
  if (Array.isArray(engine.rows) && engine.rows.length > 0) return engine.rows;
  if (Array.isArray(engine.ict_engine_rows) && engine.ict_engine_rows.length > 0) return engine.ict_engine_rows;
  if (Array.isArray(engine.ictEngineRows) && engine.ictEngineRows.length > 0) return engine.ictEngineRows;
  return [
    ...(engine.levels ?? []),
    ...(engine.sweeps ?? []),
    ...(engine.fvgs ?? []),
    ...(engine.bprs ?? []),
    ...(engine.swings ?? []),
    ...(engine.structures ?? []),
    ...(engine.pools ?? []),
    ...(engine.quality ? [engine.quality] : []),
  ];
}

function normalizeEngineForHealth(engine = {}, nowMs = Date.now()) {
  if (!engine || typeof engine !== 'object') return engine;
  const rows = engineRowsForHealth(engine);
  const emitMs = Number(engine.meta?.emit_ms);
  const staleFromEmit = Number.isFinite(emitMs) ? (Number(nowMs) - emitMs) > 90_000 : undefined;
  return {
    ...engine,
    rows,
    meta: {
      ...(engine.meta ?? {}),
      schema_supported: engine.meta?.schema_supported ?? engine.meta?.schemaSupported ?? engine.schema_supported ?? engine.schemaSupported,
      stale: engine.meta?.stale ?? staleFromEmit,
    },
  };
}

function engineStudyKnown(ui = {}, engine = {}) {
  if (engineRowsForHealth(engine).length > 0) return true;
  const studyCount = ui?.chart?.study_count ?? ui?.chart?.studies?.length;
  if (studyCount == null) return null;
  return Number(studyCount) > 0;
}

export function classifyEvaluationAvailability(sourceHealth) {
  const blockers = Array.isArray(sourceHealth?.blockers) ? sourceHealth.blockers : [];
  if (isTradableSourceHealth(sourceHealth)) {
    return {
      evaluationStatus: 'evaluated',
      reasonPrefix: 'deterministic packet blocked',
      blockers: [],
    };
  }
  return {
    evaluationStatus: 'cannot_evaluate_source_health',
    reasonPrefix: 'cannot evaluate: source health failed',
    blockers: blockers.length ? blockers : ['source_health_unknown'],
  };
}

export function evaluateLiveReadiness({
  status = {},
  ui = {},
  replay = {},
  engine = {},
  bar = null,
  nowMs = Date.now(),
  session = null,
  allowedTimeframes = DEFAULT_TIMEFRAMES,
  symbolPatterns = DEFAULT_SYMBOL_PATTERNS,
  maxBarAgeMs = DEFAULT_MAX_BAR_AGE_MS,
} = {}) {
  const checks = {};
  const blockers = [];

  if (status?.success !== true || status?.cdp_connected !== true) {
    checks.cdp = fail('cdp_unreachable', { cdp_connected: status?.cdp_connected === true });
  } else if (status?.api_available !== true) {
    checks.cdp = fail('tradingview_api_unavailable', { cdp_connected: true, api_available: false });
  } else {
    checks.cdp = pass({ cdp_connected: true, api_available: true });
  }

  const symbol = status?.chart_symbol ?? ui?.chart?.symbol ?? 'unknown';
  const resolution = normalizeResolution(status?.chart_resolution ?? ui?.chart?.resolution);
  const chartBlockers = [];
  if (!symbolIsMnqMes(symbol, symbolPatterns)) chartBlockers.push('chart_symbol_not_mnq_mes');
  if (!allowedTimeframes.has(resolution)) chartBlockers.push('unexpected_timeframe');
  checks.chart = chartBlockers.length ? fail(chartBlockers, { symbol, resolution }) : pass({ symbol, resolution });

  const healthEngine = normalizeEngineForHealth(engine, nowMs);
  const sourceHealth = evaluateSourceHealth({ gates: { engine: healthEngine } });
  const engineBlockers = [];
  const knownStudy = engineStudyKnown(ui, healthEngine);
  if (knownStudy === false) engineBlockers.push('ict_engine_study_missing_or_unknown');
  if (sourceHealth.blockers.length) engineBlockers.push(...sourceHealth.blockers);
  checks.ictEngine = engineBlockers.length ? fail([...new Set(engineBlockers)], { sourceHealth }) : pass({ sourceHealth });

  checks.replay = replayStarted(ui, replay) ? fail('replay_active') : pass();

  const age = barAgeMs({ bar, nowMs });
  if (age == null || age < 0 || age > maxBarAgeMs) {
    checks.barsUpdating = fail('bars_not_updating', { ageMs: age, maxBarAgeMs });
  } else {
    checks.barsUpdating = pass({ ageMs: age, maxBarAgeMs });
  }

  if (!TRADABLE_SESSIONS.has(session)) {
    checks.session = fail('session_not_tradable', { session: session ?? 'unknown' });
  } else if (!sessionIsActive(session, nowMs)) {
    checks.session = fail('session_not_active', { session, nowEtMinutes: etMinutesFromMs(nowMs), windowEt: SESSION_WINDOWS_ET[session] });
  } else {
    checks.session = pass({ session });
  }

  for (const check of Object.values(checks)) {
    if (Array.isArray(check.blockers)) blockers.push(...check.blockers);
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    ok: uniqueBlockers.length === 0,
    status: uniqueBlockers.length === 0 ? 'ready' : 'blocked',
    blockers: uniqueBlockers,
    checks,
    sourceHealth,
    checkedAt: new Date(Number(nowMs)).toISOString(),
  };
}

export function buildLiveDryRunRecord({ readiness, truth = null, event = null } = {}) {
  const ready = readiness?.ok === true;
  if (!ready) {
    const readinessBlockers = readiness?.blockers?.length ? readiness.blockers : ['readiness_unknown'];
    const sourceHealthBlocked = readiness?.checks?.ictEngine?.status === 'fail';
    return {
      mode: 'live-dry-run',
      actionable: false,
      finalVerdict: sourceHealthBlocked ? 'cannot_evaluate_source_health' : 'cannot_evaluate_readiness',
      readiness,
      eventTimeUtc: event?.ts ?? truth?.eventTimeUtc ?? null,
      bestPacket: null,
      blockers: readinessBlockers,
      summary: `${sourceHealthBlocked ? 'Source health' : 'Readiness'} blocked: ${readinessBlockers.join(', ')}`,
    };
  }
  if (!truth) {
    return {
      mode: 'live-dry-run',
      actionable: false,
      finalVerdict: 'cannot_evaluate_deterministic_truth',
      readiness,
      eventTimeUtc: event?.ts ?? null,
      bestPacket: null,
      blockers: ['missing_deterministic_truth'],
      summary: 'No deterministic packet truth supplied/found. Start app LIVE until it writes deterministic-packet.json, or pass --truth state/session/<date>/<session>/deterministic-packet.json.',
    };
  }
  const hasPacket = !!truth?.bestPacket;
  const blockers = truth?.blockers?.length ? truth.blockers : ['no_confirmed_packet'];
  const cannotEvaluate = String(truth?.evaluationStatus ?? '').startsWith('cannot_evaluate');
  const finalVerdict = hasPacket
    ? (truth.finalVerdict ?? 'manual_candidate')
    : cannotEvaluate
      ? truth.evaluationStatus
      : (truth.finalVerdict === 'cannot_evaluate_source_health' ? truth.finalVerdict : 'no_trade');
  return {
    mode: 'live-dry-run',
    actionable: hasPacket,
    finalVerdict,
    readiness,
    eventTimeUtc: event?.ts ?? truth?.eventTimeUtc ?? null,
    bestPacket: truth?.bestPacket ?? null,
    blockers: hasPacket ? [] : blockers,
    summary: hasPacket
      ? `Candidate ready: ${truth.bestPacket.model} ${truth.bestPacket.side} entry=${truth.bestPacket.entry?.price} stop=${truth.bestPacket.stop?.price} tp1=${truth.bestPacket.tp1?.price}`
      : (truth.noTradeReason ?? `No valid setup: ${blockers.join(', ')}`),
  };
}

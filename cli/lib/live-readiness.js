import { evaluateSourceHealth, isTradableSourceHealth } from '../../app/main/strategy/context/source-health.js';

const DEFAULT_SYMBOL_PATTERNS = [/MNQ/i, /MES/i];
const DEFAULT_TIMEFRAMES = new Set(['1', '5', '15']);
const DEFAULT_MAX_BAR_AGE_MS = 180_000;
const TRADABLE_SESSIONS = new Set(['ny-am', 'ny-pm', 'london']);

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

function engineStudyKnown(ui = {}, engine = {}) {
  if ((Array.isArray(engine.rows) && engine.rows.length > 0)
    || (Array.isArray(engine.ict_engine_rows) && engine.ict_engine_rows.length > 0)
    || (Array.isArray(engine.ictEngineRows) && engine.ictEngineRows.length > 0)) return true;
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

  const sourceHealth = evaluateSourceHealth({ gates: { engine } });
  const engineBlockers = [];
  const knownStudy = engineStudyKnown(ui, engine);
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

  checks.session = TRADABLE_SESSIONS.has(session) ? pass({ session }) : fail('session_not_tradable', { session: session ?? 'unknown' });

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
    return {
      mode: 'live-dry-run',
      actionable: false,
      finalVerdict: 'cannot_evaluate_source_health',
      readiness,
      eventTimeUtc: event?.ts ?? truth?.eventTimeUtc ?? null,
      bestPacket: null,
      summary: `Source health blocked: ${(readiness?.blockers?.length ? readiness.blockers : ['unknown']).join(', ')}`,
    };
  }
  const hasPacket = !!truth?.bestPacket;
  return {
    mode: 'live-dry-run',
    actionable: hasPacket,
    finalVerdict: hasPacket ? (truth.finalVerdict ?? 'manual_candidate') : 'no_trade',
    readiness,
    eventTimeUtc: event?.ts ?? truth?.eventTimeUtc ?? null,
    bestPacket: truth?.bestPacket ?? null,
    summary: hasPacket
      ? `Candidate ready: ${truth.bestPacket.model} ${truth.bestPacket.side} entry=${truth.bestPacket.entry?.price} stop=${truth.bestPacket.stop?.price} tp1=${truth.bestPacket.tp1?.price}`
      : `No valid setup: ${(truth?.blockers?.length ? truth.blockers : ['no_confirmed_packet']).join(', ')}`,
  };
}

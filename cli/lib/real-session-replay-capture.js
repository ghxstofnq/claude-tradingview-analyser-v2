import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const NY_TZ = 'America/New_York';

export const CONTEXT_TIMEFRAMES = [
  { label: 'D1', key: 'daily', tv_resolution: 'D' },
  { label: 'H4', key: 'h4', tv_resolution: '240' },
  { label: 'H1', key: 'h1', tv_resolution: '60' },
  { label: '15M', key: 'm15', tv_resolution: '15' },
  { label: '5M', key: 'm5', tv_resolution: '5' },
];

export const ENTRY_TIMEFRAMES = [
  { label: '15M', key: 'm15', tv_resolution: '15' },
  { label: '5M', key: 'm5', tv_resolution: '5' },
  { label: '1M', key: 'm1', tv_resolution: '1' },
];

const REQUIRED_KEYS = ['daily', 'h4', 'h1', 'm15', 'm5', 'm1'];

export function buildReplayCapturePlan({
  label,
  symbol,
  tradeDate,
  contextStart = '09:30',
  entryWindowEnd = '12:00',
  asOf,
} = {}) {
  const date = tradeDate ?? label?.trade_date;
  if (!date) throw new Error('tradeDate or label.trade_date is required');

  const resolvedSymbol = symbol ?? label?.contract_hint ?? label?.symbol;
  if (!resolvedSymbol) throw new Error('symbol or label.contract_hint is required');

  const asOfEt = asOf ?? label?.replay?.capture_window_et?.as_of ?? label?.expected?.entry_time_et;
  if (!asOfEt) throw new Error('asOf or label expected entry time is required');

  const contextStartEt = normalizeEtDateTime(label?.replay?.capture_window_et?.context_start ?? `${date}T${contextStart}:00`);
  const entryWindowEndEt = normalizeEtDateTime(label?.replay?.capture_window_et?.entry_window_end ?? `${date}T${entryWindowEnd}:00`);
  const normalizedAsOfEt = normalizeEtDateTime(asOfEt);

  const contextStartUtc = etToUtcIso(contextStartEt);
  const entryWindowEndUtc = etToUtcIso(entryWindowEndEt);
  const asOfUtc = etToUtcIso(normalizedAsOfEt);

  const requiredCandles = [];
  if (label?.expected?.stop_anchor_time_et) {
    requiredCandles.push({
      tf: '1m',
      key: 'm1',
      purpose: 'stop_anchor',
      time_et: label.expected.stop_anchor_time_et,
      time_utc: etToUtcIso(label.expected.stop_anchor_time_et),
      time_utc_unix: unixSeconds(etToUtcIso(label.expected.stop_anchor_time_et)),
    });
  }
  if (label?.expected?.entry_time_et) {
    requiredCandles.push({
      tf: '1m',
      key: 'm1',
      purpose: 'entry_confirmation',
      time_et: label.expected.entry_time_et,
      time_utc: etToUtcIso(label.expected.entry_time_et),
      time_utc_unix: unixSeconds(etToUtcIso(label.expected.entry_time_et)),
    });
  }

  const contextPulls = CONTEXT_TIMEFRAMES.map((tf) => ({
    ...tf,
    role: 'context',
    from_et: contextStartEt,
    to_et: normalizedAsOfEt,
    from_utc: contextStartUtc,
    to_utc: asOfUtc,
    from_utc_unix: unixSeconds(contextStartUtc),
    to_utc_unix: unixSeconds(asOfUtc),
  }));
  const entryPulls = ENTRY_TIMEFRAMES.map((tf) => ({
    ...tf,
    role: 'entry_window',
    from_et: contextStartEt,
    to_et: entryWindowEndEt,
    from_utc: contextStartUtc,
    to_utc: entryWindowEndUtc,
    from_utc_unix: unixSeconds(contextStartUtc),
    to_utc_unix: unixSeconds(entryWindowEndUtc),
  }));

  return {
    schema: 'gxofnq.replay-capture-plan.v1',
    fixture: label?.fixture ?? null,
    trade_date: date,
    symbol: resolvedSymbol,
    context_start_et: contextStartEt,
    entry_window_end_et: entryWindowEndEt,
    as_of_et: normalizedAsOfEt,
    context_start_utc: contextStartUtc,
    entry_window_end_utc: entryWindowEndUtc,
    as_of_utc: asOfUtc,
    context_start_utc_unix: unixSeconds(contextStartUtc),
    entry_window_end_utc_unix: unixSeconds(entryWindowEndUtc),
    as_of_utc_unix: unixSeconds(asOfUtc),
    context_timeframes: CONTEXT_TIMEFRAMES,
    entry_timeframes: ENTRY_TIMEFRAMES,
    pulls: [...contextPulls, ...entryPulls],
    required_candles: requiredCandles,
  };
}

export async function captureReplayBundle({ label, plan, adapter, capturedAt = new Date() } = {}) {
  const resolvedPlan = plan ?? buildReplayCapturePlan({ label });
  if (!adapter || typeof adapter.captureTimeframe !== 'function') {
    throw new Error('captureReplayBundle requires an adapter with captureTimeframe(pull)');
  }

  if (typeof adapter.setSymbol === 'function') await adapter.setSymbol(resolvedPlan.symbol);

  const bars_by_tf = {};
  const engine_by_tf = {};
  const captures = [];
  for (const pull of resolvedPlan.pulls) {
    const captured = await adapter.captureTimeframe(pull, resolvedPlan);
    if (captured?.bars) bars_by_tf[pull.key] = captured.bars;
    if (captured?.engine !== undefined) engine_by_tf[pull.key] = captured.engine;
    captures.push({ role: pull.role, key: pull.key, tv_resolution: pull.tv_resolution, ok: !!captured?.bars, error: captured?.error ?? null });
  }

  const decision_bars_by_tf = {};
  for (const key of ['m15', 'm5', 'm1']) {
    const source = bars_by_tf[key];
    if (source?.bars) {
      decision_bars_by_tf[key] = {
        ...source,
        bars: source.bars.filter((b) => Number(b.time) <= resolvedPlan.as_of_utc_unix),
        decision_trimmed_to_utc: resolvedPlan.as_of_utc,
      };
    }
  }

  const bundle = {
    schema: 'gxofnq.replay-capture.v1',
    fixture: resolvedPlan.fixture,
    captured_at: capturedAt.toISOString(),
    plan: resolvedPlan,
    capture_manifest: captures,
    bars_by_tf,
    decision_bars_by_tf,
    engine_by_tf,
  };
  bundle.validation = validateReplayCaptureBundle(bundle, resolvedPlan);
  return bundle;
}

export function validateReplayCaptureBundle(bundle, plan = bundle?.plan) {
  const blockers = [];
  const warnings = [];
  if (!bundle || typeof bundle !== 'object') return { ok: false, blockers: ['bundle must be an object'], warnings };
  if (!plan) return { ok: false, blockers: ['plan is required'], warnings };

  for (const key of REQUIRED_KEYS) {
    const bars = bundle.bars_by_tf?.[key];
    if (!Array.isArray(bars?.bars) || bars.bars.length === 0) blockers.push(`missing bars_by_tf.${key}`);
    if (bundle.engine_by_tf?.[key] == null) blockers.push(`missing engine_by_tf.${key}`);
  }

  for (const req of plan.required_candles ?? []) {
    const bars = bundle.bars_by_tf?.[req.key]?.bars ?? [];
    if (!bars.some((b) => Number(b.time) === req.time_utc_unix)) {
      blockers.push(`missing required ${req.tf} ${req.purpose} candle at ${req.time_utc}`);
    }
  }

  for (const key of ['m15', 'm5', 'm1']) {
    const bars = bundle.decision_bars_by_tf?.[key]?.bars ?? [];
    if (bars.some((b) => Number(b.time) > plan.as_of_utc_unix)) {
      blockers.push(`decision_bars_by_tf.${key} contains lookahead bar after as_of ${plan.as_of_utc}`);
    }
  }

  const m1Full = bundle.bars_by_tf?.m1?.bars ?? [];
  if (m1Full.length && !m1Full.some((b) => Number(b.time) >= plan.entry_window_end_utc_unix)) {
    warnings.push(`bars_by_tf.m1 does not reach replay end ${plan.entry_window_end_utc}`);
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

export function writeReplayBundleAtomic(outPath, bundle, plan = bundle?.plan, { force = false } = {}) {
  const validation = validateReplayCaptureBundle(bundle, plan);
  if (!validation.ok && !force) {
    throw new Error(`Replay capture bundle is not ready: ${validation.blockers.join('; ')}`);
  }
  const finalBundle = { ...bundle, validation };
  mkdirSync(dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(finalBundle, null, 2)}\n`);
  renameSync(tmp, outPath);
  return { success: true, out: outPath, validation };
}

function normalizeEtDateTime(value) {
  if (typeof value !== 'string') throw new Error(`Invalid ET datetime: ${value}`);
  if (/[-+]\d{2}:\d{2}$/.test(value)) return value;
  if (/T\d{2}:\d{2}$/.test(value)) return `${value}:00-04:00`;
  if (/T\d{2}:\d{2}:\d{2}$/.test(value)) return `${value}-04:00`;
  return value;
}

function etToUtcIso(etIso) {
  if (/[-+]\d{2}:\d{2}$/.test(etIso)) return new Date(etIso).toISOString().replace('.000Z', 'Z');
  return zonedLocalToUtcIso(etIso.replace(/[-+]\d{2}:\d{2}$/, ''), NY_TZ);
}

function zonedLocalToUtcIso(localIso, timeZone) {
  const [datePart, timePart = '00:00:00'] = localIso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss = '0'] = timePart.split(':').map(Number);
  let utcMs = Date.UTC(y, m - 1, d, hh, mm, Number(ss));
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date(utcMs));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const observedMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const targetMs = Date.UTC(y, m - 1, d, hh, mm, Number(ss));
    utcMs += targetMs - observedMs;
  }
  return new Date(utcMs).toISOString().replace('.000Z', 'Z');
}

function unixSeconds(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

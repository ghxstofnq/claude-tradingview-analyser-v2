import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateLiveReadiness,
  classifyEvaluationAvailability,
  buildLiveDryRunRecord,
} from '../cli/lib/live-readiness.js';

const healthyEngine = {
  meta: { schema_supported: true, stale: false },
  rows: [{ evidenceRef: 'pd.large.bull', kind: 'fvg', dir: 'bull' }],
};

function baseInputs(overrides = {}) {
  return {
    status: {
      success: true,
      cdp_connected: true,
      api_available: true,
      chart_symbol: 'CME_MINI:MNQ1!',
      chart_resolution: '1',
    },
    ui: { replay: { started: false }, chart: { study_count: 4 } },
    engine: healthyEngine,
    bar: { ts: '2026-06-02T14:30:00.000Z', is_new_bar: true },
    nowMs: Date.parse('2026-06-02T14:30:20.000Z'),
    session: 'ny-am',
    ...overrides,
  };
}

test('evaluateLiveReadiness passes only when CDP, chart, engine, replay, bar freshness, and session gates are healthy', () => {
  const result = evaluateLiveReadiness(baseInputs());

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.checks.cdp.status, 'pass');
  assert.equal(result.checks.chart.status, 'pass');
  assert.equal(result.checks.ictEngine.status, 'pass');
  assert.equal(result.checks.replay.status, 'pass');
  assert.equal(result.checks.barsUpdating.status, 'pass');
  assert.equal(result.checks.session.status, 'pass');
});

test('evaluateLiveReadiness accepts raw parsed ICT Engine V2 shape from live table collection', () => {
  const nowMs = Date.parse('2026-06-02T17:12:40.000Z');
  const result = evaluateLiveReadiness(baseInputs({
    engine: {
      schema: 2,
      schema_supported: true,
      meta: { schema: 2, emit_ms: Date.parse('2026-06-02T22:12:27.730Z'), tf: '1', symbol: 'MNQ1!' },
      levels: [{ name: 'PDH', price: 30763.5 }],
      fvgs: [{ kind: 'fvg', dir: 'bull', top: 30718.5, bottom: 30705.5 }],
      bprs: [],
      swings: [],
      structures: [{ event: 'mss', dir: 'bear' }],
      pools: [],
      quality: { displacement: 'clean' },
    },
    bar: { ts: '2026-06-02T17:12:00.000Z' },
    nowMs,
    session: 'ny-pm',
  }));

  assert.equal(result.ok, true);
  assert.equal(result.checks.ictEngine.status, 'pass');
  assert.deepEqual(result.sourceHealth, { status: 'fresh', schemaSupported: true, stale: false, blockers: [] });
});

test('evaluateLiveReadiness blocks live trading on stale or wrong source instead of reporting ordinary no-trade', () => {
  const result = evaluateLiveReadiness(baseInputs({
    status: { success: true, cdp_connected: true, api_available: false, chart_symbol: 'NASDAQ:AAPL', chart_resolution: '60' },
    ui: { replay: { started: true }, chart: { study_count: 0 } },
    engine: { meta: { schema_supported: false, stale: true }, rows: [] },
    bar: { ts: '2026-06-02T14:20:00.000Z' },
    nowMs: Date.parse('2026-06-02T14:30:20.000Z'),
    session: 'idle',
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers, [
    'tradingview_api_unavailable',
    'chart_symbol_not_mnq_mes',
    'unexpected_timeframe',
    'ict_engine_study_missing_or_unknown',
    'unsupported_ict_schema',
    'stale_source',
    'missing_ict_engine_rows',
    'replay_active',
    'bars_not_updating',
    'session_not_tradable',
  ]);
});

test('evaluateLiveReadiness blocks a named session outside its actual ET trading window', () => {
  const result = evaluateLiveReadiness(baseInputs({
    session: 'ny-am',
    nowMs: Date.parse('2026-06-04T11:13:20.000Z'), // 07:13 ET, before NY-AM opens
    bar: { ts: '2026-06-04T11:13:00.000Z' },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.checks.session.status, 'fail');
  assert.deepEqual(result.checks.session.blockers, ['session_not_active']);
  assert.equal(result.checks.session.session, 'ny-am');
});

test('classifyEvaluationAvailability differentiates source-health failure from clean evaluated no-trade', () => {
  assert.deepEqual(classifyEvaluationAvailability({ status: 'fresh', stale: false, schemaSupported: true, blockers: [] }), {
    evaluationStatus: 'evaluated',
    reasonPrefix: 'deterministic packet blocked',
    blockers: [],
  });

  assert.deepEqual(classifyEvaluationAvailability({ status: 'blocked', stale: true, schemaSupported: false, blockers: ['stale_source'] }), {
    evaluationStatus: 'cannot_evaluate_source_health',
    reasonPrefix: 'cannot evaluate: source health failed',
    blockers: ['stale_source'],
  });
});

test('buildLiveDryRunRecord never creates an actionable setup when readiness is blocked', () => {
  const readiness = evaluateLiveReadiness(baseInputs({ engine: { meta: { schema_supported: true, stale: true }, rows: [{ kind: 'fvg' }] } }));
  const record = buildLiveDryRunRecord({ readiness, truth: { bestPacket: { entry: { price: 1 } }, finalVerdict: 'manual_candidate' } });

  assert.equal(record.mode, 'live-dry-run');
  assert.equal(record.actionable, false);
  assert.equal(record.finalVerdict, 'cannot_evaluate_source_health');
  assert.match(record.summary, /Source health blocked/);
});

test('buildLiveDryRunRecord reports session/readiness blockers without mislabeling them as source-health failures', () => {
  const readiness = evaluateLiveReadiness(baseInputs({
    session: 'ny-am',
    nowMs: Date.parse('2026-06-04T11:13:20.000Z'),
    bar: { ts: '2026-06-04T11:13:00.000Z' },
  }));
  const record = buildLiveDryRunRecord({ readiness, truth: null });

  assert.equal(record.actionable, false);
  assert.equal(record.finalVerdict, 'cannot_evaluate_readiness');
  assert.deepEqual(record.blockers, ['session_not_active']);
  assert.match(record.summary, /Readiness blocked: session_not_active/);
});

test('buildLiveDryRunRecord fails explicitly when readiness is ready but deterministic truth is missing', () => {
  const readiness = evaluateLiveReadiness(baseInputs());
  const record = buildLiveDryRunRecord({ readiness, truth: null, event: { ts: '2026-06-02T22:28:00.000Z' } });

  assert.equal(record.actionable, false);
  assert.equal(record.finalVerdict, 'cannot_evaluate_deterministic_truth');
  assert.deepEqual(record.blockers, ['missing_deterministic_truth']);
  assert.match(record.summary, /No deterministic packet truth/);
});

test('buildLiveDryRunRecord preserves strategy-chain blockers from deterministic truth', () => {
  const readiness = evaluateLiveReadiness(baseInputs());
  const record = buildLiveDryRunRecord({
    readiness,
    truth: {
      evaluationStatus: 'cannot_evaluate_strategy_chain',
      finalVerdict: 'no_trade',
      bestPacket: null,
      blockers: ['missing_ltf_bias', 'missing_entry_model_priority'],
      noTradeReason: 'cannot evaluate: strategy chain incomplete: missing_ltf_bias, missing_entry_model_priority',
    },
  });

  assert.equal(record.actionable, false);
  assert.equal(record.finalVerdict, 'cannot_evaluate_strategy_chain');
  assert.deepEqual(record.blockers, ['missing_ltf_bias', 'missing_entry_model_priority']);
  assert.match(record.summary, /missing_ltf_bias/);
  assert.match(record.summary, /missing_entry_model_priority/);
});

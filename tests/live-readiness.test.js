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

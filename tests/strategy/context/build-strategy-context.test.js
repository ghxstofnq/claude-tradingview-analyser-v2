import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategyContext } from '../../../app/main/strategy/context/build-strategy-context.js';

function validBundle(overrides = {}) {
  return {
    market: 'MNQ1!',
    session: 'ny-am',
    eventTimeUtc: '2026-05-29T13:45:00.000Z',
    eventTimeEt: '09:45:00',
    gates: {
      engine: {
        meta: { schema_supported: true, stale: false },
        rows: [
          { kind: 'fvg', dir: 'bull', ref: 'ict.rows[0]', timeframe: '1m', high: 21002, low: 20998, ce: 21000 },
          { kind: 'ifvg', dir: 'bear', ref: 'ict.rows[1]', timeframe: '1m', high: 21010, low: 21006, ce: 21008 },
          { kind: 'bpr', dir: 'bull', ref: 'ict.rows[2]', timeframe: '5m', high: 21004, low: 21000, ce: 21002 },
        ],
        pillar1: {
          htfBias: 'bullish',
          htfDraw: { side: 'above', price: 21050, label: 'PDH', evidenceRef: 'p1.htfDraw' },
          primaryDraw: { side: 'above', price: 21035, label: 'Asia High', evidenceRef: 'p1.primaryDraw' },
          untakenTargets: { above: [{ price: 21035, label: 'Asia High', evidenceRef: 'target.asiaHigh' }], below: [] },
        },
        pillar2: { current_tf: { candle: 'clean', displacement: 'clean' }, chop_15m: false },
        confirmation: { entry_state: 'confirmed', confirm_close: 1, confirm_dir: 'bull', evidenceRef: 'confirm.1' },
      },
    },
    ohlcv1m: [{ timeUtc: '2026-05-29T13:45:00.000Z', open: 1, high: 2, low: 0, close: 1.5 }],
    ohlcv5m: [],
    ...overrides,
  };
}

test('buildStrategyContext: returns normalized deterministic strategy context for fresh ICT evidence', () => {
  const context = buildStrategyContext(validBundle());

  assert.equal(context.market, 'MNQ1!');
  assert.equal(context.session, 'ny-am');
  assert.deepEqual(context.sourceHealth, { status: 'fresh', schemaSupported: true, stale: false, blockers: [] });
  assert.equal(context.pillar1.status, 'pass');
  assert.equal(context.pillar1.htfBias, 'bullish');
  assert.deepEqual(context.pillar1.primaryDraw, { side: 'above', price: 21035, label: 'Asia High', evidenceRef: 'p1.primaryDraw' });
  assert.equal(context.pillar2.status, 'pass');
  assert.equal(context.pillar2.candleQuality, 'clean');
  assert.equal(context.pillar2.displacement, 'clean');
  assert.equal(context.pillar2.chop15m, false);
  assert.equal(context.pillar3.fvgs.length, 1);
  assert.equal(context.pillar3.ifvgs.length, 1);
  assert.equal(context.pillar3.bprs.length, 1);
  assert.equal(context.pillar3.confirmationRows.length, 1);
  assert.equal(context.blockers.length, 0);
});

test('buildStrategyContext: missing engine/meta/schema/stale/rows become blocked context, not partial tradable context', () => {
  const cases = [
    [{ gates: {} }, 'missing_gates_engine'],
    [{ gates: { engine: {} } }, 'missing_gates_engine_meta'],
    [{ gates: { engine: { meta: { schema_supported: false, stale: false }, rows: [{ kind: 'fvg' }] } } }, 'unsupported_ict_schema'],
    [{ gates: { engine: { meta: { schema_supported: true, stale: true }, rows: [{ kind: 'fvg' }] } } }, 'stale_source'],
    [{ gates: { engine: { meta: { schema_supported: true, stale: false }, rows: [] } } }, 'missing_ict_engine_rows'],
  ];

  for (const [override, blocker] of cases) {
    const context = buildStrategyContext(validBundle(override));
    assert.equal(context.sourceHealth.status, 'blocked');
    assert.equal(context.pillar1.status, 'blocked');
    assert.equal(context.pillar2.status, 'blocked');
    assert.ok(context.blockers.includes(blocker), `expected ${blocker} in ${context.blockers}`);
  }
});

test('buildStrategyContext: preserves MSS lifecycle evidence for deterministic walker requests', () => {
  const context = buildStrategyContext(validBundle({
    gates: {
      engine: {
        ...validBundle().gates.engine,
        pillar1: {
          ...validBundle().gates.engine.pillar1,
          sweeps: [{ side: 'sell', rejected: true, swept_ms: 1780062000000 }],
        },
        pillar3: {
          failure_swings: [{ event: 'mss', validation: 'sweep', dir: 'bull', created_ms: 1780062180000 }],
        },
        price_context: {
          inside_fvgs: [{ kind: 'fvg', dir: 'bull', state: 'fresh', ref: 'ict.rows[0]' }],
        },
      },
    },
  }));

  assert.equal(context.pillar3.sweeps[0].evidenceRef, 'gates.engine.pillar1.sweeps[0]');
  assert.equal(context.pillar3.failureSwings[0].evidenceRef, 'gates.engine.pillar3.failure_swings[0]');
  assert.equal(context.pillar3.insidePdArrays[0].evidenceRef, 'ict.rows[0]');
});

test('buildStrategyContext: unknown market or session blocks deterministically', () => {
  const unknownMarket = buildStrategyContext(validBundle({ market: 'NQ1!' }));
  assert.equal(unknownMarket.sourceHealth.status, 'blocked');
  assert.ok(unknownMarket.blockers.includes('unknown_market'));

  const unknownSession = buildStrategyContext(validBundle({ session: 'overnight' }));
  assert.equal(unknownSession.sourceHealth.status, 'blocked');
  assert.ok(unknownSession.blockers.includes('unknown_session'));
});

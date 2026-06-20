import assert from 'node:assert/strict';
import test from 'node:test';

import { __test } from '../app/main/bar-close.js';

// 5m-structure campaign: with STRUCTURE_TF='5' the walker reads market STRUCTURE
// from the 5m engine (engine_by_tf.m5) while FVGs/entry stay 1m; STOP_TF routes
// the structural stop. Default '1' leaves the 1m engine untouched.

const EV = { ts: '2026-06-18T13:50:00.000Z', symbol: 'MNQ1!' };

function inputs() {
  return {
    leader: 'MNQ1!',
    ltf_bias_context: { bias: 'bearish', htf_ltf_alignment: 'aligned', is_retrace_day: false, entry_model_priority: 'MSS', grade_cap: 'A+' },
    session_state: { pillar1: { status: 'pass', htfBias: 'bearish', htfDraw: 'below', primaryDraw: 'PWL' }, pillar2: { status: 'pass', verdict: 'pass' } },
    untaken_targets: { untaken_above: [], untaken_below: [] },
    bundle: {
      chart: { symbol: 'CME_MINI:MNQ1!' },
      quote: { last: 30800 },
      brief_digest: {},
      gates: {
        engine: {
          meta: { schema_supported: true, stale: false, tf: '1' },
          pillar1: { sweeps: [] },
          pillar2: { current_tf: { candle: 'clean', displacement: 'clean' }, chop_15m: 0 },
          price_context: { last: 30800, inside_fvgs: [], inside_bprs: [] },
          pillar3: {
            fvgs: [{ kind: 'fvg', dir: 'bull', state: 'fresh', top: 30810, bottom: 30790, evidenceRef: 'fvg1m' }],
            bprs: [],
            swings: { internal: [], swing: [{ tier: 'swing', is_high: true, price: 30850 }] },
            structure_events: [{ event: 'bos', dir: 'bull', tier: 'swing', confirmed_ms: 1781000000000, level: 30800 }],
            structures_by_tier: { swing: [{ event: 'bos', dir: 'bull', tier: 'swing', confirmed_ms: 1781000000000, level: 30800 }], internal: [] },
            failure_swings: [],
            most_recent_structure: { event: 'bos', dir: 'bull', tier: 'swing', confirmed_ms: 1781000000000 },
          },
        },
      },
      bars: { last_5_bars: [] },
      bars_by_tf: { m5: { last_5_bars: [] } },
      engine_by_tf: {
        m5: {
          schema: 2, schema_supported: true, meta: { schema: 2, tf: '5' },
          levels: [], sweeps: [], bprs: [], pools: [], quality: null,
          fvgs: [{ kind: 'fvg', dir: 'bear', state: 'fresh', top: 30950, bottom: 30930, evidenceRef: 'fvg5m' }],
          swings: [{ tier: 'swing', is_high: true, price: 30975 }, { tier: 'swing', is_high: false, price: 30600 }],
          structures: [{ event: 'mss', dir: 'bear', tier: 'swing', confirmed_ms: 1781000300000, level: 30900, validation: 'sweep' }],
        },
      },
    },
  };
}

test('STRUCTURE_TF default (1m): structure stays 1m, no 5m overlay', () => {
  delete process.env.GOFNQ_STRUCTURE_TF;
  delete process.env.GOFNQ_STOP_TF;
  const b = __test.buildStrategyBundleForRuntime(inputs(), EV, 'ny-am');
  const p3 = b.gates.engine.pillar3;
  assert.equal(p3.structures_by_tier.swing[0].event, 'bos'); // 1m structure
  assert.equal(p3.structures_by_tier.swing[0].dir, 'bull');
  assert.equal(b.gates.engine.meta.structure_tf, undefined);
});

test('STRUCTURE_TF=5: structure comes from 5m, FVGs/entry stay 1m', () => {
  process.env.GOFNQ_STRUCTURE_TF = '5';
  delete process.env.GOFNQ_STOP_TF;
  try {
    const b = __test.buildStrategyBundleForRuntime(inputs(), EV, 'ny-am');
    const p3 = b.gates.engine.pillar3;
    // structure → 5m (mss/bear), not the 1m bos/bull
    assert.equal(p3.structures_by_tier.swing[0].event, 'mss');
    assert.equal(p3.structures_by_tier.swing[0].dir, 'bear');
    assert.equal(p3.failure_swings.length, 1); // 5m mss+sweep
    // FVGs stay 1m (the entry layer)
    assert.equal(p3.fvgs[0].dir, 'bull');
    assert.equal(p3.fvgs[0].evidenceRef, 'fvg1m');
    assert.equal(b.gates.engine.meta.structure_tf, '5');
  } finally { delete process.env.GOFNQ_STRUCTURE_TF; }
});

test('STOP_TF=5 routes the structural stop to 5m swings (differs from 1m)', () => {
  process.env.GOFNQ_STRUCTURE_TF = '5';
  try {
    delete process.env.GOFNQ_STOP_TF;
    const stop1m = __test.buildStrategyBundleForRuntime(inputs(), EV, 'ny-am').gates.engine.pillar3.structural_stops;
    process.env.GOFNQ_STOP_TF = '5';
    const stop5m = __test.buildStrategyBundleForRuntime(inputs(), EV, 'ny-am').gates.engine.pillar3.structural_stops;
    assert.notDeepEqual(stop5m, stop1m); // the stop knob actually changes the anchor
  } finally { delete process.env.GOFNQ_STRUCTURE_TF; delete process.env.GOFNQ_STOP_TF; }
});

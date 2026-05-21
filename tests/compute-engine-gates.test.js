import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEngineGates } from '../cli/lib/compute-engine-gates.js';

// A parsed-engine object shaped exactly as ict-engine-parser.js emits it.
function sampleEngine() {
  return {
    schema: 1,
    schema_supported: true,
    meta: { schema: 1, count: 8, emit_ny: '09:20:20', emit_ms: 1779369620478, tf: '15', symbol: 'MNQ1!' },
    levels: [
      { name: 'PDH', price: 29397, state: 'complete', swept: true, formed_ms: 0 },
      { name: 'PDL', price: 28796, state: 'complete', swept: false, formed_ms: 0 },
      { name: 'LO.H', price: 29463.25, state: 'forming', swept: false, formed_ms: 1 },
    ],
    sweeps: [
      { target: 'PDH', price: 29397, side: 'buy', swept_ms: 1779336900000, rejected: false },
    ],
    fvgs: [
      { kind: 'fvg', dir: 'bear', top: 29355.5, bottom: 29296.5, ce: 29326, created_ms: 1, took_liq: true, disp_score: 0.74, reacted: false, reaction_dir: 'none', state: 'fresh' },
      { kind: 'ifvg', dir: 'bull', top: 29100, bottom: 29090, ce: 29095, created_ms: 2, took_liq: false, disp_score: 0.5, reacted: false, reaction_dir: 'none', state: 'inverted' },
    ],
    bprs: [
      { dir: 'bull', top: 28965, bottom: 28964, created_ms: 3, took_liq: false, reacted: false, reaction_dir: 'none', state: 'fresh' },
    ],
    swings: [
      { kind: 'HH', price: 29463.25, bar_ms: 10, tier: 'internal', swept: false, is_high: true },
      { kind: 'HL', price: 29350.25, bar_ms: 11, tier: 'internal', swept: true, is_high: false },
      { kind: 'HH', price: 29783.75, bar_ms: 5, tier: 'swing', swept: false, is_high: true },
    ],
    structures: [
      { event: 'mss', dir: 'bull', level: 29225.5, broken_swing_ms: 1, confirmed_ms: 1779325200000, displacement: true, tier: 'internal', validation: 'break' },
      { event: 'mss', dir: 'bear', level: 29350.25, broken_swing_ms: 2, confirmed_ms: 1779358500000, displacement: true, tier: 'internal', validation: 'break' },
    ],
    quality: { range_3h: 110.75, range_quality: 'tight', displacement: 'weak', candle: 'doji_wick', has_chop: true },
  };
}

const sampleByTf = {
  m5: { quality: { range_3h: 40, range_quality: 'tight', displacement: 'weak', candle: 'normal', has_chop: false } },
  m15: { quality: { range_3h: 110.75, range_quality: 'tight', displacement: 'weak', candle: 'doji_wick', has_chop: true } },
};

test('computeEngineGates returns null when the engine is absent', () => {
  assert.equal(computeEngineGates({ engine: null, engineByTf: null, last: 1 }), null);
});

test('computeEngineGates carries engine meta provenance', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.meta.tf, '15');
  assert.equal(g.meta.schema_supported, true);
  assert.equal(g.meta.symbol, 'MNQ1!');
});

test('computeEngineGates keys session levels citation-safe and tags position', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.pillar1.session_levels.PDH.price, 29397);
  assert.equal(g.pillar1.session_levels.PDH.position_vs_price, 'above');
  assert.equal(g.pillar1.session_levels.PDH.swept, true);
  // "LO.H" -> "LO_H"
  assert.equal(g.pillar1.session_levels.LO_H.price, 29463.25);
  assert.equal(g.pillar1.session_levels.PDL.position_vs_price, 'below');
});

test('computeEngineGates derives untaken draws and passes sweeps through', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  // PDH is above but swept -> excluded; LO.H above and unswept -> included.
  assert.deepEqual(g.pillar1.untaken_buy_side_above.map((l) => l.name), ['LO.H']);
  // PDL is below and unswept -> included.
  assert.deepEqual(g.pillar1.untaken_sell_side_below.map((l) => l.name), ['PDL']);
  assert.equal(g.pillar1.sweeps.length, 1);
  assert.equal(g.pillar1.sweeps[0].target, 'PDH');
});

test('computeEngineGates sources Pillar 2 quality from the engine, per TF', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.pillar2.current_tf.range_quality, 'tight');
  assert.equal(g.pillar2.current_tf.candle, 'doji_wick');
  assert.equal(g.pillar2.m5.range_3h, 40);
  assert.equal(g.pillar2.m15.candle, 'doji_wick');
});

test('computeEngineGates picks the most recent structure event by confirmed_ms', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.pillar3.most_recent_structure.event, 'mss');
  assert.equal(g.pillar3.most_recent_structure.dir, 'bear');
  assert.equal(g.pillar3.structure_events.length, 2);
});

test('computeEngineGates splits swings by tier', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.pillar3.swings.internal.length, 2);
  assert.equal(g.pillar3.swings.swing.length, 1);
});

test('computeEngineGates carries pre-computed last-bar confirmation facts', () => {
  const lastBar = { time: 100, body_ratio: 0.7, direction: 'bullish', close_position_in_range: 0.9 };
  const m5LastBar = { time: 95, body_ratio: 0.5, direction: 'bearish', close_position_in_range: 0.2 };
  const g = computeEngineGates({
    engine: sampleEngine(), engineByTf: sampleByTf, last: 29320,
    lastBar, lastBarAgeSeconds: 12, m5LastBar, m15LastBar: null,
  });
  assert.equal(g.confirmation.last_bar.body_ratio, 0.7);
  assert.equal(g.confirmation.last_bar_age_seconds, 12);
  assert.equal(g.confirmation.m5_last_bar.direction, 'bearish');
  assert.equal(g.confirmation.m15_last_bar, null);
});

test('computeEngineGates confirmation defaults to null when facts are absent', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.confirmation.last_bar, null);
  assert.equal(g.confirmation.last_bar_age_seconds, null);
});

test('computeEngineGates summarizes FVGs and flags zones containing price', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.pillar3.fvgs.length, 2);
  assert.equal(g.pillar3.fvg_summary.by_type.bearish_fvg, 1);
  assert.equal(g.pillar3.fvg_summary.by_type.bullish_ifvg, 1);
  assert.equal(g.pillar3.fvg_summary.by_state.fresh, 1);
  assert.equal(g.pillar3.fvg_summary.by_state.inverted, 1);
  // last=29320 sits inside the fresh bear FVG (29296.5-29355.5), not the iFVG.
  assert.equal(g.price_context.inside_fvgs.length, 1);
  assert.equal(g.price_context.inside_fvgs[0].state, 'fresh');
});

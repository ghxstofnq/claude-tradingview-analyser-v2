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
      // intentionally NOT in actionable order: invalidated first to verify
      // fvgs_ranked re-sorts. fvgs[0] stays the invalidated one (Pine order),
      // fvgs_ranked[0] should be the fresh+took_liq+high-disp entry.
      { kind: 'fvg', dir: 'bull', top: 28800, bottom: 28780, ce: 28790, created_ms: 0, took_liq: false, disp_score: 0.3, reacted: true, reaction_dir: 'bull', state: 'invalidated', size_quality: 'tiny' },
      { kind: 'fvg', dir: 'bear', top: 29355.5, bottom: 29296.5, ce: 29326, created_ms: 1, took_liq: true, disp_score: 0.74, reacted: false, reaction_dir: 'none', state: 'fresh', size_quality: 'normal' },
      { kind: 'ifvg', dir: 'bull', top: 29100, bottom: 29090, ce: 29095, created_ms: 2, took_liq: false, disp_score: 0.5, reacted: false, reaction_dir: 'none', state: 'inverted', size_quality: 'large' },
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
      { event: 'mss', dir: 'bear', level: 29350.25, broken_swing_ms: 2, confirmed_ms: 1779358500000, displacement: true, tier: 'internal', validation: 'sweep' },
      { event: 'bos', dir: 'bull', level: 29800, broken_swing_ms: 3, confirmed_ms: 1779360000000, displacement: false, tier: 'swing', validation: 'break' },
    ],
    pools: [
      { kind: 'eqh', side: 'buy', price: 29550, swept: false },
      { kind: 'eqh', side: 'buy', price: 29800, swept: true },
      { kind: 'eql', side: 'sell', price: 29050, swept: false },
      { kind: 'eql', side: 'sell', price: 28900, swept: false },
    ],
    quality: { range_3h: 110.75, range_quality: 'tight', displacement: 'acceptable', candle: 'doji_wick', atr_14: 85.75, atr_17: 87.5, session: 'ny_am' },
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
  // newest confirmed_ms is the bull BOS at 1779360000000 (swing tier)
  assert.equal(g.pillar3.most_recent_structure.event, 'bos');
  assert.equal(g.pillar3.most_recent_structure.dir, 'bull');
  assert.equal(g.pillar3.structure_events.length, 3);
});

test('computeEngineGates splits structure events by tier', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  // two internal MSS events + one external BOS in the sample
  assert.equal(g.pillar3.structures_by_tier.internal.length, 2);
  assert.equal(g.pillar3.structures_by_tier.swing.length, 1);
  assert.equal(g.pillar3.structures_by_tier.swing[0].event, 'bos');
});

test('computeEngineGates surfaces failure-swing MSS events only', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  // bear MSS has validation=sweep -> failure swing. bull MSS validation=break, BOS=break -> excluded.
  assert.equal(g.pillar3.failure_swings.length, 1);
  assert.equal(g.pillar3.failure_swings[0].dir, 'bear');
  assert.equal(g.pillar3.failure_swings[0].validation, 'sweep');
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
  assert.equal(g.pillar3.fvgs.length, 3);
  assert.equal(g.pillar3.fvg_summary.by_type.bullish_fvg, 1);
  assert.equal(g.pillar3.fvg_summary.by_type.bearish_fvg, 1);
  assert.equal(g.pillar3.fvg_summary.by_type.bullish_ifvg, 1);
  assert.equal(g.pillar3.fvg_summary.by_state.fresh, 1);
  assert.equal(g.pillar3.fvg_summary.by_state.inverted, 1);
  assert.equal(g.pillar3.fvg_summary.by_state.invalidated, 1);
  // last=29320 sits inside the fresh bear FVG (29296.5-29355.5), not the iFVG.
  assert.equal(g.price_context.inside_fvgs.length, 1);
  assert.equal(g.price_context.inside_fvgs[0].state, 'fresh');
});

test('computeEngineGates ranks FVGs by state then took_liq then disp_score (fvgs[] stays Pine order)', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  // Pine order preserved on fvgs[]: invalidated bull was first in fixture.
  assert.equal(g.pillar3.fvgs[0].state, 'invalidated');
  // fvgs_ranked[0] = fresh bear FVG with took_liq + disp_score 0.74.
  assert.equal(g.pillar3.fvgs_ranked[0].state, 'fresh');
  assert.equal(g.pillar3.fvgs_ranked[0].took_liq, true);
  assert.equal(g.pillar3.fvgs_ranked[0].disp_score, 0.74);
  // fvgs_ranked[1] = inverted iFVG (next state in lifecycle order).
  assert.equal(g.pillar3.fvgs_ranked[1].state, 'inverted');
  // fvgs_ranked[2] = invalidated bull (last in lifecycle order).
  assert.equal(g.pillar3.fvgs_ranked[2].state, 'invalidated');
});

test('computeEngineGates adds proximity distances to inside FVGs and BPRs', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  const inside = g.price_context.inside_fvgs[0];
  // bear FVG top=29355.5, bottom=29296.5, ce=29326, last=29320.
  assert.equal(inside.distance_to_top, 29320 - 29355.5);
  assert.equal(inside.distance_to_bottom, 29320 - 29296.5);
  assert.equal(inside.distance_to_ce, 29320 - 29326);
});

test('computeEngineGates picks nearest opposing FVG above and below', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  // Above price (last=29320): only the inverted bull FVG at 29090-29100 is BELOW;
  // no live FVG has bottom > 29320 in the fixture. So nearest_opposing_fvg_above is null.
  assert.equal(g.price_context.nearest_opposing_fvg_above, null);
  // Below price: the inverted iFVG with top=29100 (live state). distance is signed.
  assert.equal(g.price_context.nearest_opposing_fvg_below.top, 29100);
  assert.equal(g.price_context.nearest_opposing_fvg_below.distance_to_top, 29320 - 29100);
});

test('computeEngineGates surfaces liquidity pools and partitions untaken pools by side and proximity', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.pillar1.liquidity_pools.length, 4);
  // EQH above price, unswept: only 29550. The 29800 is swept -> excluded.
  assert.deepEqual(g.pillar1.untaken_pools_above.map((p) => p.price), [29550]);
  // EQL below price, unswept: 29050 first (closer), then 28900.
  assert.deepEqual(g.pillar1.untaken_pools_below.map((p) => p.price), [29050, 28900]);
});

test('computeEngineGates computes engine staleness vs quote time and exposes engine_session', () => {
  const e = sampleEngine();
  // emit_ms=1779369620478. Pretend quote.time arrived 120 seconds later.
  const quoteTimeMs = e.meta.emit_ms + 120_000;
  const g = computeEngineGates({ engine: e, engineByTf: sampleByTf, last: 29320, quoteTimeMs });
  assert.equal(g.meta.emit_ms, 1779369620478);
  assert.equal(g.meta.emit_age_seconds, 120);
  assert.equal(g.meta.stale, true);
  assert.equal(g.meta.engine_session, 'ny_am');
});

test('computeEngineGates marks engine fresh when emit_age within threshold', () => {
  const e = sampleEngine();
  const quoteTimeMs = e.meta.emit_ms + 30_000;
  const g = computeEngineGates({ engine: e, engineByTf: sampleByTf, last: 29320, quoteTimeMs });
  assert.equal(g.meta.emit_age_seconds, 30);
  assert.equal(g.meta.stale, false);
});

test('computeEngineGates emit_age is null when quoteTimeMs not provided', () => {
  const g = computeEngineGates({ engine: sampleEngine(), engineByTf: sampleByTf, last: 29320 });
  assert.equal(g.meta.emit_age_seconds, null);
  assert.equal(g.meta.stale, false);
});

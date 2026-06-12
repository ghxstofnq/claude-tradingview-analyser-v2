import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBriefDigest } from '../cli/lib/brief-digest.js';

function sampleSymbolBundle() {
  return {
    bars_by_tf: {
      daily: { change_pct: '16.28%', range: 7034.5 },
      h4:    { change_pct: '7.07%',  range: 2380.75 },
      h1:    { change_pct: '3.27%',  range: 1199 },
    },
    engine_by_tf: {
      daily: {
        fvgs: [],
        bprs: [],
        structures: [{ event: 'mss', dir: 'bull', level: 26564.5, displacement: true, tier: 'swing', validation: 'break', confirmed_ms: 1776153600000 }],
        quality: { range_3h: null, range_quality: null, displacement: 'na', candle: 'normal', atr_14: null, atr_17: null },
      },
      h4: {
        fvgs: [
          { kind: 'fvg', dir: 'bull', top: 29800, bottom: 29760, ce: 29780, disp_score: 0.74, took_liq: true, state: 'fresh', size_quality: 'large', reacted: false, reaction_dir: 'none' },
          { kind: 'ifvg', dir: 'bull', top: 27350, bottom: 27301, ce: 27325, disp_score: 0.64, took_liq: false, state: 'invalidated', size_quality: 'tiny', reacted: true, reaction_dir: 'bull' },
        ],
        bprs: [{ dir: 'bull', top: 29774, bottom: 29769, took_liq: false, reacted: false, state: 'fresh' }],
        structures: [{ event: 'bos', dir: 'bull', level: 29783.75, displacement: true, tier: 'internal', validation: 'break', confirmed_ms: 1779788400000 }],
        quality: { range_3h: 71.5, range_quality: 'tight', displacement: 'acceptable', candle: 'doji_wick', atr_14: 180.25, atr_17: 188.75 },
      },
      h1: {
        fvgs: [],
        bprs: [],
        structures: [{ event: 'mss', dir: 'bear', level: 29888.75, displacement: false, tier: 'internal', validation: 'sweep', confirmed_ms: 1779836400000 }],
        quality: { range_3h: 156.5, range_quality: 'good', displacement: 'clean', candle: 'doji_wick', atr_14: 62, atr_17: 64.75 },
      },
    },
    gates: {
      engine: {
        pillar1: {
          session_levels: { PDH: { name: 'PDH', price: 29397, state: 'taken', swept: true }, AS_L: { name: 'AS_L', price: 29770.5, state: 'untaken', swept: false } },
          sweeps: [{ target: 'AS_L', price: 29770.5, side: 'sell', rejected: true, swept_ms: 1779832800000 }],
          untaken_pools_above: [{ kind: 'eqh', side: 'buy', price: 30000, swept: false }],
          untaken_pools_below: [],
        },
        pillar2: {
          current_tf: { range_3h: 71.5, range_quality: 'tight', displacement: 'acceptable', candle: 'doji_wick', atr_14: 180.25, atr_17: 188.75 },
          m5:  { range_3h: 40, range_quality: 'tight', displacement: 'weak', candle: 'normal' },
          m15: { range_3h: 110.75, range_quality: 'tight', displacement: 'weak', candle: 'doji_wick' },
        },
        price_context: {
          last: 29801.25,
          inside_fvgs: [{ kind: 'fvg', dir: 'bull', top: 29804, bottom: 29794.25, ce: 29799.25 }],
          inside_bprs: [],
          nearest_opposing_fvg_above: null,
          nearest_opposing_fvg_below: null,
        },
        pillar3: { most_recent_structure: { event: 'bos', dir: 'bull', level: 29804.75, displacement: true, confirmed_ms: 1779785460000 } },
      },
    },
  };
}

test('buildBriefDigest returns null when no pair block present', () => {
  const out = buildBriefDigest({ chart: {}, gates: {} });
  assert.equal(out, null);
});

test('buildBriefDigest emits one section per symbol in pair', () => {
  const bundle = {
    pair: {
      primary: 'MNQ1!', secondary: 'MES1!',
      symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() },
      leader_evidence: { primary_disp_score: 0.74, secondary_disp_score: 0.41, margin: 0.33, threshold: 0.1, reason: 'primary_higher_disp_score' },
    },
  };
  const out = buildBriefDigest(bundle);
  assert.ok(out.symbols['MNQ1!']);
  assert.ok(out.symbols['MES1!']);
  assert.equal(out.leader_evidence.reason, 'primary_higher_disp_score');
});

test('digest.htf carries momentum + ranked top_fvgs/top_bprs + recent_structures + quality per TF', () => {
  const bundle = {
    pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: { reason: 'primary_higher_disp_score' } },
  };
  const out = buildBriefDigest(bundle);
  const h4 = out.symbols['MNQ1!'].htf.h4;
  assert.equal(h4.change_pct, '7.07%');
  assert.equal(h4.range, 2380.75);
  assert.equal(h4.top_fvgs[0].state, 'fresh');
  assert.equal(h4.top_fvgs[0].took_liq, true);
  assert.equal(h4.top_fvgs[0].disp_score, 0.74);
  assert.ok(h4.top_fvgs[0].cite.startsWith('engine_by_tf.h4.fvgs'));
  assert.equal(h4.top_bprs[0].top, 29774);
  assert.equal(h4.recent_structures[0].event, 'bos');
  assert.equal(h4.recent_structures[0].dir, 'bull');
  assert.equal(h4.quality.range_quality, 'tight');
  assert.equal(h4.quality.displacement, 'acceptable');
});

test('digest.pillar1 carries session_levels, sweeps, untaken_pools', () => {
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const p1 = buildBriefDigest(bundle).symbols['MNQ1!'].pillar1;
  assert.equal(p1.session_levels.PDH.price, 29397);
  assert.equal(p1.sweeps[0].rejected, true);
  assert.equal(p1.untaken_pools_above[0].price, 30000);
});

test('digest.pillar2 carries current_tf + m5 + m15 quality objects', () => {
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const p2 = buildBriefDigest(bundle).symbols['MNQ1!'].pillar2;
  assert.equal(p2.current_tf.candle, 'doji_wick');
  assert.equal(p2.m5.range_3h, 40);
  assert.equal(p2.m15.candle, 'doji_wick');
});

test('digest.ltf_context carries inside zones + nearest opposing FVG + most_recent_structure', () => {
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const ltf = buildBriefDigest(bundle).symbols['MNQ1!'].ltf_context;
  assert.equal(ltf.inside_fvgs[0].ce, 29799.25);
  assert.equal(ltf.most_recent_structure.event, 'bos');
});

test('top_fvgs ranks by (state=fresh DESC, took_liq DESC, disp_score DESC) and caps at 3', () => {
  const symBundle = sampleSymbolBundle();
  symBundle.engine_by_tf.h4.fvgs = [
    { kind: 'fvg', dir: 'bull', top: 1, bottom: 0, ce: 0.5, disp_score: 0.1, took_liq: false, state: 'invalidated', size_quality: 'tiny', reacted: false, reaction_dir: 'none' },
    { kind: 'fvg', dir: 'bear', top: 2, bottom: 1, ce: 1.5, disp_score: 0.9, took_liq: true,  state: 'fresh', size_quality: 'normal', reacted: false, reaction_dir: 'none' },
    { kind: 'fvg', dir: 'bull', top: 3, bottom: 2, ce: 2.5, disp_score: 0.5, took_liq: false, state: 'fresh', size_quality: 'normal', reacted: false, reaction_dir: 'none' },
    { kind: 'fvg', dir: 'bull', top: 4, bottom: 3, ce: 3.5, disp_score: 0.8, took_liq: true,  state: 'filled', size_quality: 'large', reacted: true, reaction_dir: 'bull' },
    { kind: 'fvg', dir: 'bull', top: 5, bottom: 4, ce: 4.5, disp_score: 0.7, took_liq: false, state: 'fresh', size_quality: 'normal', reacted: false, reaction_dir: 'none' },
  ];
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': symBundle, 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const ranked = buildBriefDigest(bundle).symbols['MNQ1!'].htf.h4.top_fvgs;
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].disp_score, 0.9);
  assert.equal(ranked[1].disp_score, 0.7);
  assert.equal(ranked[2].disp_score, 0.5);
});

test('cite paths use the per-TF prefix (engine_by_tf.<tf>.fvgs/bprs/structures)', () => {
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': sampleSymbolBundle(), 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const h4 = buildBriefDigest(bundle).symbols['MNQ1!'].htf.h4;
  assert.match(h4.top_fvgs[0].cite, /^engine_by_tf\.h4\.fvgs\[\d+\]$/);
  assert.match(h4.top_bprs[0].cite, /^engine_by_tf\.h4\.bprs\[\d+\]$/);
  assert.match(h4.recent_structures[0].cite, /^engine_by_tf\.h4\.structures\[\d+\]$/);
});

test('digest.htf carries data_status from capture_health (fresh / fallback / missing)', () => {
  const symBundle = sampleSymbolBundle();
  symBundle.engine_by_tf.h1 = null;
  symBundle.capture_health = {
    ok: false,
    missing: ['h1'],
    fallback: ['h4'],
    by_tf: {
      daily: { status: 'fresh', attempts: 1, pass: 1 },
      h4: { status: 'fallback', baseline_age_seconds: 3600, baseline_path: '/x.json' },
      h1: { status: 'missing', attempts: 3, pass: 2 },
    },
  };
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': symBundle, 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const htf = buildBriefDigest(bundle).symbols['MNQ1!'].htf;
  assert.equal(htf.daily.data_status, 'fresh');
  assert.equal(htf.h4.data_status, 'fallback');
  assert.equal(htf.h4.baseline_age_seconds, 3600);
  assert.equal(htf.h1.data_status, 'missing');
});

test('digest.htf data_status derives from engine presence when capture_health is absent (old bundles)', () => {
  const symBundle = sampleSymbolBundle();
  symBundle.engine_by_tf.h1 = null;
  const bundle = { pair: { primary: 'MNQ1!', secondary: 'MES1!', symbols: { 'MNQ1!': symBundle, 'MES1!': sampleSymbolBundle() }, leader_evidence: {} } };
  const htf = buildBriefDigest(bundle).symbols['MNQ1!'].htf;
  assert.equal(htf.h4.data_status, 'fresh');
  assert.equal(htf.h1.data_status, 'missing');
});

// §2.1 step 1: "Priority to imbalances that are EXTENSIVE (large gaps,
// strong displacement)" — zone size joins the ranking as a tiebreaker
// above raw displacement (below took_liq, preserving the hand-verified
// June 9 pick). Audit 2026-06-12: size_quality was parsed but unused.
test('ranking: among fresh+took_liq zones, a large zone outranks a tiny one with higher disp', () => {
  const bundle = {
    pair: { symbols: { 'MNQ1!': {
      bars_by_tf: { h4: {} },
      engine_by_tf: { h4: { fvgs: [
        { dir: 'bear', top: 100, bottom: 90, state: 'fresh', took_liq: true, disp_score: 0.95, size_quality: 'tiny' },
        { dir: 'bear', top: 200, bottom: 150, state: 'fresh', took_liq: true, disp_score: 0.7, size_quality: 'large' },
      ], bprs: [], structures: [] } },
      gates: { engine: {} },
    } } },
  };
  const digest = buildBriefDigest(bundle);
  const top = digest.symbols['MNQ1!'].htf.h4.top_fvgs[0];
  assert.equal(top.size_quality, 'large');
});

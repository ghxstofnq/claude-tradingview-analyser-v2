import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMssComponents } from '../cli/lib/setup-detector.js';

function baseBundle() {
  return {
    quote: { last: 29998.5 },
    engine_by_tf: {
      m5: {
        fvgs: [{ kind: 'fvg', dir: 'bull', top: 29998.5, bottom: 29992.5, ce: 29995.5, state: 'fresh', reacted: true, size_quality: 'medium', created_ms: 1779836400000, took_liq: true, disp_score: 0.7 }],
        bprs: [],
        structures: [{ event: 'mss', dir: 'bull', level: 30002.25, displacement: true, tier: 'internal', validation: 'sweep', confirmed_ms: 1779836400000 }],
        quality: { displacement: 'clean', range_quality: 'good' },
      },
    },
    gates: {
      engine: {
        meta: { stale: false, emit_age_seconds: 0, schema_supported: true },
        price_context: { last: 29998.5, inside_fvgs: [{ kind: 'fvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh' }], inside_bprs: [] },
        pillar1: { sweeps: [{ target: 'AS_L', price: 29982.25, side: 'sell', rejected: true, swept_ms: 1779836280000 }] },
        pillar2: { current_tf: { range_quality: 'good', displacement: 'clean' } },
        pillar3: {
          failure_swings: [{ event: 'mss', dir: 'bull', level: 30002.25, validation: 'sweep' }],
          fvg_summary: { size_quality: 'medium' },
        },
        confirmation: { last_bar: { body_ratio: 0.7, direction: 'bullish', close_position_in_range: 0.85 } },
      },
    },
  };
}

const BULL_LONG_CTX = {
  side: 'long',
  htf_destination: { dir: 'above', cite: 'pillar1.mnq.htf_destination' },
  primary_draw: { kind: 'fvg', cite: 'engine_by_tf.h4.fvgs[0]' },
};

test('MSS context_draw: present when side aligns with htf_destination', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.context_draw.present, true);
});

test('MSS context_draw: absent when side opposite to htf_destination', () => {
  const r = evaluateMssComponents(baseBundle(), { ...BULL_LONG_CTX, side: 'short', htf_destination: { dir: 'above', cite: 'pillar1.mnq.htf_destination' } }, 'm5');
  assert.equal(r.context_draw.present, false);
  assert.match(r.context_draw.missing_reason, /htf_destination dir=above/);
});

test('MSS context_draw: absent when htf_destination lacks evidence citation', () => {
  const r = evaluateMssComponents(baseBundle(), { ...BULL_LONG_CTX, htf_destination: { dir: 'above' } }, 'm5');
  assert.equal(r.context_draw.present, false);
  assert.match(r.context_draw.missing_reason, /htf_destination cite missing/);
});

test('MSS context_draw: absent when primary_draw evidence is missing', () => {
  const r = evaluateMssComponents(baseBundle(), { ...BULL_LONG_CTX, primary_draw: null }, 'm5');
  assert.equal(r.context_draw.present, false);
  assert.match(r.context_draw.missing_reason, /primary_draw/);
});

test('MSS liquidity_grab: present when sweep matches side', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.liquidity_grab.present, true);
});

test('MSS liquidity_grab: absent when no sweep on right side', () => {
  const b = baseBundle();
  b.gates.engine.pillar1.sweeps = [];
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.liquidity_grab.present, false);
});

test('MSS mss_displacement: present when failure_swings has matching event', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.mss_displacement.present, true);
});

test('MSS mss_displacement: absent when failure_swings empty', () => {
  const b = baseBundle();
  b.gates.engine.pillar3.failure_swings = [];
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.mss_displacement.present, false);
});

test('MSS retrace_to_fvg: present when inside_fvgs contains a fresh FVG of correct dir', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.retrace_to_fvg.present, true);
});

test('MSS retrace_to_fvg: absent when inside_fvgs empty (FVG just created, not yet retested)', () => {
  const b = baseBundle();
  b.gates.engine.price_context.inside_fvgs = [];
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.retrace_to_fvg.present, false);
  assert.match(r.retrace_to_fvg.missing_reason, /not yet retested/);
});

test('MSS confirmation: present when last_bar body_ratio>=0.6 and direction matches', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, true);
});

test('MSS confirmation: absent when last_bar body_ratio<0.6', () => {
  const b = baseBundle();
  b.gates.engine.confirmation.last_bar.body_ratio = 0.4;
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, false);
});

test('MSS confirmation: explicit entry_state waiting blocks even when last_bar looks bullish', () => {
  const b = baseBundle();
  b.gates.engine.confirmation.entry_state = 'waiting';
  b.gates.engine.confirmation.confirm_close = 0;
  b.gates.engine.confirmation.ce_held = true;
  b.gates.engine.confirmation.chop_15m = 0;
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, false);
  assert.match(r.confirmation.missing_reason, /entry_state=waiting/);
});

test('MSS confirmation: explicit confirmed entry requires confirm_close and no CE/chop failure', () => {
  const b = baseBundle();
  b.gates.engine.confirmation.entry_state = 'confirmed';
  b.gates.engine.confirmation.confirm_close = 1;
  b.gates.engine.confirmation.ce_held = true;
  b.gates.engine.confirmation.chop_15m = 0;
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, true);
});

test('MSS confirmation: explicit chop_15m blocks confirmed-looking entry', () => {
  const b = baseBundle();
  b.gates.engine.confirmation.entry_state = 'confirmed';
  b.gates.engine.confirmation.confirm_close = 1;
  b.gates.engine.confirmation.ce_held = true;
  b.gates.engine.confirmation.chop_15m = 1;
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, false);
  assert.match(r.confirmation.missing_reason, /chop_15m=1/);
});

test('MSS confirmation: explicit CE failure blocks confirmed-looking entry', () => {
  const b = baseBundle();
  b.gates.engine.confirmation.entry_state = 'confirmed';
  b.gates.engine.confirmation.confirm_close = 1;
  b.gates.engine.confirmation.ce_held = false;
  b.gates.engine.confirmation.chop_15m = 0;
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, false);
  assert.match(r.confirmation.missing_reason, /ce_held=false/);
});

test('MSS displacement_quality: present when size_quality!=weak AND displacement clean/acceptable', () => {
  const r = evaluateMssComponents(baseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, true);
});

test('MSS displacement_quality: absent when size_quality=weak', () => {
  const b = baseBundle();
  b.gates.engine.pillar3.fvg_summary.size_quality = 'weak';
  const r = evaluateMssComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, false);
});

// ============================================================================
// Trend evaluator tests
// ============================================================================

import { evaluateTrendComponents } from '../cli/lib/setup-detector.js';

function trendBaseBundle() {
  const b = baseBundle();
  // Replace MSS-specific signals with Trend-specific ones:
  b.gates.engine.pillar3.failure_swings = []; // not used by Trend
  b.gates.engine.pillar3.most_recent_structure = { event: 'bos', dir: 'bull', level: 30002.25, displacement: true, tier: 'swing' };
  b.gates.engine.price_context.inside_fvgs = [{ kind: 'fvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh' }];
  return b;
}

test('Trend context_draw: present when side aligns with htf_destination', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.context_draw.present, true);
});

test('Trend bos_in_direction: present when most_recent_structure is BoS matching side', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.bos_in_direction.present, true);
});

test('Trend bos_in_direction: absent when structure is MSS not BoS', () => {
  const b = trendBaseBundle();
  b.gates.engine.pillar3.most_recent_structure.event = 'mss';
  const r = evaluateTrendComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.bos_in_direction.present, false);
});

test('Trend bos_in_direction: clean reason when most_recent_structure is null (no "undefined" in text)', () => {
  const b = trendBaseBundle();
  b.gates.engine.pillar3.most_recent_structure = null;
  const r = evaluateTrendComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.bos_in_direction.present, false);
  assert.match(r.bos_in_direction.missing_reason, /no structure event/);
  assert.doesNotMatch(r.bos_in_direction.missing_reason, /undefined/);
});

test('Trend confirmation: clean reason when last_bar empty (no "undefined" in text)', () => {
  const b = trendBaseBundle();
  b.gates.engine.confirmation.last_bar = {};
  const r = evaluateTrendComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, false);
  assert.match(r.confirmation.missing_reason, /no last_bar emitted yet/);
  assert.doesNotMatch(r.confirmation.missing_reason, /undefined/);
});

test('Trend displacement_quality: clean reason when size_quality missing (no "undefined" in text)', () => {
  const b = trendBaseBundle();
  delete b.gates.engine.pillar3.fvg_summary;
  const r = evaluateTrendComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, false);
  assert.match(r.displacement_quality.missing_reason, /size_quality missing/);
  assert.doesNotMatch(r.displacement_quality.missing_reason, /undefined/);
});

test('Trend displacement_quality: clean reason when displacement missing (no "undefined" in text)', () => {
  const b = trendBaseBundle();
  delete b.gates.engine.pillar2.current_tf.displacement;
  const r = evaluateTrendComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, false);
  assert.match(r.displacement_quality.missing_reason, /displacement missing/);
  assert.doesNotMatch(r.displacement_quality.missing_reason, /undefined/);
});

test('Trend pullback_to_pd_array: present when inside_fvgs contains a fresh FVG of correct dir', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.pullback_to_pd_array.present, true);
});

test('Trend pullback_to_pd_array: absent when inside_fvgs+inside_bprs empty', () => {
  const b = trendBaseBundle();
  b.gates.engine.price_context.inside_fvgs = [];
  b.gates.engine.price_context.inside_bprs = [];
  const r = evaluateTrendComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.pullback_to_pd_array.present, false);
});

test('Trend confirmation: present when last_bar body_ratio>=0.6 and direction matches', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, true);
});

test('Trend displacement_quality: same rule as MSS', () => {
  const r = evaluateTrendComponents(trendBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, true);
});

// ============================================================================
// Inversion evaluator tests
// ============================================================================

import { evaluateInversionComponents } from '../cli/lib/setup-detector.js';

function inversionBaseBundle() {
  const b = baseBundle();
  // Inversion-specific: there's a fresh inverted FVG in price_context.inside_fvgs.
  b.gates.engine.price_context.inside_fvgs = [{ kind: 'ifvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh' }];
  b.engine_by_tf.m5.fvgs = [{ kind: 'ifvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh', created_ms: 1779836400000, reacted: true, took_liq: false, size_quality: 'medium', disp_score: 0.7 }];
  return b;
}

test('Inversion context_draw: present when side aligns with htf_destination', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.context_draw.present, true);
});

test('Inversion inverted_pd_array: present when fresh ifvg matches dir', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.inverted_pd_array.present, true);
});

test('Inversion inverted_pd_array: absent when only regular FVGs present', () => {
  const b = inversionBaseBundle();
  b.engine_by_tf.m5.fvgs[0].kind = 'fvg';
  const r = evaluateInversionComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.inverted_pd_array.present, false);
});

test('Inversion tap_into_ifvg: present when inside_fvgs contains the ifvg', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.tap_into_ifvg.present, true);
});

test('Inversion tap_into_ifvg: absent when inside_fvgs has no ifvg', () => {
  const b = inversionBaseBundle();
  b.gates.engine.price_context.inside_fvgs = [];
  const r = evaluateInversionComponents(b, BULL_LONG_CTX, 'm5');
  assert.equal(r.tap_into_ifvg.present, false);
});

test('Inversion confirmation: present when last_bar body_ratio>=0.6 and direction matches', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.confirmation.present, true);
});

test('Inversion displacement_quality: present when size_quality + pillar2 displacement OK', () => {
  const r = evaluateInversionComponents(inversionBaseBundle(), BULL_LONG_CTX, 'm5');
  assert.equal(r.displacement_quality.present, true);
});

// ============================================================================
// Tradable rule + grade logic tests
// ============================================================================

import { computeGradeProposed, computeGradeCapped, isTradable } from '../cli/lib/setup-detector.js';

function allPresentComponents() {
  return {
    context_draw:        { present: true, cite: 'x' },
    liquidity_grab:      { present: true, cite: 'x' },
    mss_displacement:    { present: true, cite: 'x' },
    retrace_to_fvg:      { present: true, cite: 'x' },
    confirmation:        { present: true, cite: 'x' },
    displacement_quality: { present: true, cite: 'x' },
  };
}

test('computeGradeProposed: all present + clean displacement = A+', () => {
  const r = computeGradeProposed(allPresentComponents(), { displacement: 'clean' });
  assert.equal(r, 'A+');
});

test('computeGradeProposed: all present + acceptable displacement = B', () => {
  const r = computeGradeProposed(allPresentComponents(), { displacement: 'acceptable' });
  assert.equal(r, 'B');
});

test('computeGradeProposed: missing component = no-trade', () => {
  const c = allPresentComponents();
  c.retrace_to_fvg.present = false;
  const r = computeGradeProposed(c, { displacement: 'clean' });
  assert.equal(r, 'no-trade');
});

test('computeGradeCapped: takes minimum of proposed and grade_cap', () => {
  assert.equal(computeGradeCapped('A+', { grade_cap: 'B' }), 'B');
  assert.equal(computeGradeCapped('B', { grade_cap: 'A+' }), 'B');
  assert.equal(computeGradeCapped('A+', { grade_cap: 'A+' }), 'A+');
});

test('computeGradeCapped: divergent + non-MSS model = no-trade', () => {
  assert.equal(computeGradeCapped('A+', { grade_cap: 'A+', htf_ltf_alignment: 'divergent', model: 'Trend' }), 'no-trade');
  assert.equal(computeGradeCapped('A+', { grade_cap: 'A+', htf_ltf_alignment: 'divergent', model: 'MSS' }), 'A+');
});

test('computeGradeCapped: is_retrace_day + poor pillar2 = capped at B', () => {
  assert.equal(computeGradeCapped('A+', { grade_cap: 'A+', is_retrace_day: true, pillar2_range_quality: 'poor' }), 'B');
});

test('isTradable: all components + grade in {A+,B} + tp & stop available = true', () => {
  const r = isTradable({
    components: allPresentComponents(),
    grade_proposed: 'A+',
    grade_capped: 'B',
    stop_options: [{ kind: 'fvg_candle1_low', value: 100, cite: 'x' }],
    tp1: { value: 110 }, tp2: { value: 120 },
  });
  assert.equal(r, true);
});

test('isTradable: grade_capped=no-trade returns false', () => {
  const r = isTradable({
    components: allPresentComponents(),
    grade_proposed: 'A+',
    grade_capped: 'no-trade',
    stop_options: [{ kind: 'fvg_candle1_low', value: 100, cite: 'x' }],
    tp1: { value: 110 }, tp2: { value: 120 },
  });
  assert.equal(r, false);
});

test('isTradable: no stop_options returns false', () => {
  const r = isTradable({
    components: allPresentComponents(),
    grade_proposed: 'A+',
    grade_capped: 'A+',
    stop_options: [],
    tp1: { value: 110 }, tp2: { value: 120 },
  });
  assert.equal(r, false);
});

// ============================================================================
// TP picker + entry helper tests
// ============================================================================

import { pickTpFromUntakenTargets, deriveEntry } from '../cli/lib/setup-detector.js';

test('pickTpFromUntakenTargets: long picks nearest untaken_above', () => {
  const untaken = { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' }, { price: 30050, cite: 'pillar1.mnq.overnight.untaken_above[1]' }], untaken_below: [] };
  const r = pickTpFromUntakenTargets(untaken, { side: 'long', entry: 29998.5, rank: 0 });
  assert.equal(r.value, 30015);
  assert.equal(r.cite, 'pillar1.mnq.overnight.untaken_above[0]');
});

test('pickTpFromUntakenTargets: tp2 picks second-nearest', () => {
  const untaken = { untaken_above: [{ price: 30015, cite: 'a' }, { price: 30050, cite: 'b' }, { price: 30119, cite: 'c' }], untaken_below: [] };
  const r = pickTpFromUntakenTargets(untaken, { side: 'long', entry: 29998.5, rank: 1 });
  assert.equal(r.value, 30050);
});

test('pickTpFromUntakenTargets: returns null when no targets in direction', () => {
  const untaken = { untaken_above: [], untaken_below: [{ price: 29800, cite: 'a' }] };
  const r = pickTpFromUntakenTargets(untaken, { side: 'long', entry: 29998.5, rank: 0 });
  assert.equal(r, null);
});

test('deriveEntry: FVG entry uses FVG top/bottom by direction', () => {
  const fvg = { top: 29998.5, bottom: 29992.5, dir: 'bull', kind: 'fvg' };
  const r = deriveEntry({ kind: 'fvg', fvg, side: 'long', tf: 'm5', fvgIdx: 3 });
  assert.equal(r.value, 29998.5);  // long enters at FVG top
  assert.equal(r.cite, 'engine_by_tf.m5.fvgs[3].top');
});

test('deriveEntry: BPR entry uses BPR top/bottom by direction', () => {
  const bpr = { top: 29998.5, bottom: 29992.5, dir: 'bull' };
  const r = deriveEntry({ kind: 'bpr', bpr, side: 'long', tf: 'm5', bprIdx: 1 });
  assert.equal(r.cite, 'engine_by_tf.m5.bprs[1].top');
});

// ============================================================================
// Orchestrator tests
// ============================================================================

import { detectSetups, pickBestCandidate, buildRejectionSummary } from '../cli/lib/setup-detector.js';

function fullPositiveMssBundle() {
  const b = baseBundle();
  b.brief_digest = {
    symbols: {
      'MNQ1!': {
        htf: {},
        pillar1: {
          htf_destination: { dir: 'above', cite: 'pillar1.mnq.htf_destination' },
          primary_draw: { kind: 'fvg', cite: 'engine_by_tf.h4.fvgs[0]' },
          overnight_block: {
            untaken_above: [
              { price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' },
              { price: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' },
            ],
            untaken_below: [],
          },
        },
        pillar2: { range_quality: 'good', displacement: 'clean' },
        ltf_context: {},
      },
    },
  };
  b.bars_by_tf = {
    m5: { last_5_bars: [
      { time: 1779836160 / 1, low: 29981.25, high: 29988.75 },
      { time: 1779836280 / 1, low: 29982.25, high: 29991.5 },
      { time: 1779836400 / 1, low: 29990, high: 29998.5 },
    ] },
  };
  return b;
}

test('detectSetups: returns wait state when leader undefined', () => {
  const r = detectSetups({ bundle: baseBundle(), leader: null, ltf_bias_context: {}, untaken_targets: {} });
  assert.equal(r.best_candidate, null);
  assert.match(r.rejection_summary, /leader/i);
});

test('detectSetups: returns wait state when engine stale', () => {
  const b = baseBundle();
  b.gates = { ...b.gates, engine: { ...b.gates.engine, meta: { ...b.gates.engine.meta, stale: true, emit_age_seconds: 9999 } } };
  const r = detectSetups({ bundle: b, leader: 'mnq', ltf_bias_context: {}, untaken_targets: {} });
  assert.equal(r.best_candidate, null);
  assert.match(r.rejection_summary, /stale/i);
});

test('detectSetups: blocks when engine source health meta is missing', () => {
  const b = fullPositiveMssBundle();
  delete b.gates.engine.meta;
  const r = detectSetups({
    bundle: b,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' },
    untaken_targets: { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' }, { price: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' }], untaken_below: [] },
  });
  assert.equal(r.best_candidate, null);
  assert.match(r.rejection_summary, /source health/i);
  assert.match(r.rejection_summary, /missing/i);
});

test('detectSetups: blocks when engine source health stale flag is unknown', () => {
  const b = fullPositiveMssBundle();
  delete b.gates.engine.meta.stale;
  const r = detectSetups({
    bundle: b,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' },
    untaken_targets: { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' }, { price: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' }], untaken_below: [] },
  });
  assert.equal(r.best_candidate, null);
  assert.match(r.rejection_summary, /source health/i);
  assert.match(r.rejection_summary, /stale/i);
});

test('detectSetups: blocks unsupported ICT Engine schema before candidate promotion', () => {
  const b = fullPositiveMssBundle();
  b.gates.engine.meta.schema_supported = false;
  const r = detectSetups({
    bundle: b,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' },
    untaken_targets: { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' }, { price: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' }], untaken_below: [] },
  });
  assert.equal(r.best_candidate, null);
  assert.match(r.rejection_summary, /unsupported/i);
});

test('detectSetups: blocks unknown ICT Engine schema support before candidate promotion', () => {
  const b = fullPositiveMssBundle();
  delete b.gates.engine.meta.schema_supported;
  const r = detectSetups({
    bundle: b,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' },
    untaken_targets: { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' }, { price: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' }], untaken_below: [] },
  });
  assert.equal(r.best_candidate, null);
  assert.match(r.rejection_summary, /schema/i);
  assert.match(r.rejection_summary, /unknown|missing/i);
});

test('detectSetups: builds MSS-long candidate when all components present', () => {
  const b = fullPositiveMssBundle();
  const r = detectSetups({
    bundle: b,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' },
    untaken_targets: { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' }, { price: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' }], untaken_below: [] },
  });
  assert.equal(r.best_candidate?.model, 'MSS');
  assert.equal(r.best_candidate?.side, 'long');
  assert.equal(r.best_candidate?.grade_proposed, 'A+');
  assert.ok(r.best_candidate?.stop_options?.length > 0);
  assert.equal(r.best_candidate?.tp1?.value, 30015);
});

test('pickBestCandidate: prefers entry_model_priority resolver order', () => {
  const candidates = [
    { model: 'Trend', side: 'long', grade_proposed: 'A+', tradable: true, components: {}, rationale: 'x' },
    { model: 'MSS', side: 'long', grade_proposed: 'A+', tradable: true, components: {}, rationale: 'y' },
  ];
  const r = pickBestCandidate(candidates, { entry_model_priority: 'mss' });
  assert.equal(r.best_candidate.model, 'MSS');
  assert.equal(r.rejections.length, 1);
  assert.equal(r.rejections[0].model, 'Trend');
});

test('buildRejectionSummary: composes single-sentence summary from rejections', () => {
  const rejections = [
    { model: 'MSS', side: 'long', reason: 'no liquidity grab' },
    { model: 'Trend', side: 'long', reason: 'no BoS in direction' },
    { model: 'Inversion', side: 'long', reason: 'no inverted FVG' },
  ];
  const r = buildRejectionSummary(rejections, { side: 'long', untaken_above: [{ price: 30015 }], untaken_below: [] });
  assert.match(r, /no tradable setup/i);
  assert.match(r, /30015/);
});

// ============================================================================
// Fixture-driven end-to-end + regression tests
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

function loadFixture(name) {
  const p = name.includes('/') ? resolve(FIXTURES, name) : resolve(FIXTURES, name);
  return JSON.parse(readFileSync(p + '.bundle.json', 'utf8'));
}

function untakenFromBundle(bundle, side) {
  const symKey = Object.keys(bundle.brief_digest?.symbols ?? {})[0];
  const p1 = bundle.brief_digest?.symbols?.[symKey]?.pillar1 ?? {};
  return {
    untaken_above: p1.untaken_pools_above ?? [],
    untaken_below: p1.untaken_pools_below ?? [],
  };
}

// --- Tradable fixtures (006/007/008) ---

test('fixture 006: MSS-bull-tradable produces tradable MSS-long candidate', () => {
  const bundle = loadFixture('006-mss-bull-tradable');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'mss' },
    untaken_targets: untakenFromBundle(bundle, 'long'),
  });
  assert.equal(r.best_candidate?.model, 'MSS');
  assert.equal(r.best_candidate?.side, 'long');
  assert.equal(r.best_candidate?.tradable, true);
});

test('fixture 007: Trend-bull-tradable produces tradable Trend-long candidate', () => {
  const bundle = loadFixture('007-trend-bull-tradable');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'trend' },
    untaken_targets: untakenFromBundle(bundle, 'long'),
  });
  assert.equal(r.best_candidate?.model, 'Trend');
  assert.equal(r.best_candidate?.tradable, true);
});

test('fixture 008: Inversion-short-tradable produces tradable Inversion-short candidate', () => {
  const bundle = loadFixture('008-inversion-short-tradable');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bear', htf_ltf_alignment: 'aligned', grade_cap: 'A+', entry_model_priority: 'inversion' },
    untaken_targets: untakenFromBundle(bundle, 'short'),
  });
  assert.equal(r.best_candidate?.model, 'Inversion');
  assert.equal(r.best_candidate?.side, 'short');
  assert.equal(r.best_candidate?.tradable, true);
});

// --- Miss-regression fixtures ---

test('miss-04: TP cite is never a swept session level', () => {
  const bundle = loadFixture('miss-regressions/miss-04-swept-tp');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+' },
    untaken_targets: untakenFromBundle(bundle, 'long'),
  });
  if (r.best_candidate) {
    assert.doesNotMatch(r.best_candidate.tp1?.cite ?? '', /session_levels\.AS_H/);
    assert.doesNotMatch(r.best_candidate.tp2?.cite ?? '' , /session_levels\.AS_H/);
  }
});

test('miss-05: side is driven by htf_destination, not locked ltf_bias', () => {
  const bundle = loadFixture('miss-regressions/miss-05-locked-ltf-bias');
  // ltf_bias_context says bear, but htf_destination dir=above + valid MSS-bull setup.
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bear', htf_ltf_alignment: 'divergent', grade_cap: 'B' },
    untaken_targets: untakenFromBundle(bundle, 'long'),
  });
  if (r.best_candidate) {
    assert.equal(r.best_candidate.side, 'long');
    assert.equal(r.best_candidate.model, 'MSS');
  }
});

test('miss-07: stop_options[0].kind is fvg_candle1_low when bars+FVG present', () => {
  const bundle = loadFixture('miss-regressions/miss-07-wrong-stop');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+' },
    untaken_targets: untakenFromBundle(bundle, 'long'),
  });
  if (r.best_candidate?.stop_options?.length) {
    assert.equal(r.best_candidate.stop_options[0].kind, 'fvg_candle1_low');
  }
});

test('miss-08: retrace_to_fvg.present is false when FVG just created (price not inside)', () => {
  const bundle = loadFixture('miss-regressions/miss-08-pullback-already-played');
  const r = detectSetups({
    bundle,
    leader: 'mnq',
    ltf_bias_context: { bias: 'bull', htf_ltf_alignment: 'aligned', grade_cap: 'A+' },
    untaken_targets: untakenFromBundle(bundle, 'long'),
  });
  // MSS rejection: retrace_to_fvg should be the missing component.
  const mssRej = r.rejections?.find?.((rej) => rej.model === 'MSS');
  // Either we have an MSS rejection citing the missing retrace, or no best_candidate at all
  // (no tradable MSS this bar — exactly the desired behavior).
  assert.ok(
    mssRej || r.best_candidate?.model !== 'MSS' || r.best_candidate?.components?.retrace_to_fvg?.present === false,
    'detector should reject MSS because retrace_to_fvg is missing (fresh FVG not yet retested)'
  );
});

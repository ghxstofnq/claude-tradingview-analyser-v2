import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEntryModelPriority } from '../cli/lib/entry-model-priority.js';

test('pillar2 poor → undecided regardless of alignment', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'poor',
    htf_ltf_alignment: 'aligned',
    failure_swings: [{ event: 'mss', validation: 'sweep' }],
  });
  assert.equal(r.priority, 'undecided');
  assert.match(r.reason, /pillar2/i);
});

test('divergent → MSS (LTF reversal at HTF level)', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'divergent',
  });
  assert.equal(r.priority, 'MSS');
  assert.match(r.reason, /divergent/i);
});

test('aligned + recent failure_swing → MSS', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    failure_swings: [{ event: 'mss', validation: 'sweep', confirmed_ms: 1779785460000 }],
    most_recent_structure: null,
    inverted_fvg_present: false,
  });
  assert.equal(r.priority, 'MSS');
  assert.match(r.cite, /failure_swings/);
});

test('aligned + Trend reclaim-continuation evidence beats older failure_swing → Trend', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    ltf_bias: 'bullish',
    failure_swings: [{ event: 'mss', validation: 'sweep', confirmed_ms: 1779785460000 }],
    most_recent_structure: { event: 'bos', dir: 'bear', confirmed_ms: 1779785700000 },
    inverted_fvg_present: true,
    trend_reclaim_present: true,
  });
  assert.equal(r.priority, 'Trend');
  assert.match(r.cite, /trend_reclaim/i);
});

test('aligned + recent BoS in bias direction (no failure_swing) → Trend', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    ltf_bias: 'bullish',
    failure_swings: [],
    most_recent_structure: { event: 'bos', dir: 'bull', confirmed_ms: 1779785460000 },
    inverted_fvg_present: false,
  });
  assert.equal(r.priority, 'Trend');
  assert.match(r.cite, /most_recent_structure/);
});

test('aligned + BoS in WRONG direction → undecided', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    ltf_bias: 'bullish',
    failure_swings: [],
    most_recent_structure: { event: 'bos', dir: 'bear' },
    inverted_fvg_present: false,
  });
  assert.equal(r.priority, 'undecided');
});

test('aligned + opposing FVG flipped → Inversion', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    ltf_bias: 'bullish',
    failure_swings: [],
    most_recent_structure: null,
    inverted_fvg_present: true,
  });
  assert.equal(r.priority, 'Inversion');
  assert.match(r.cite, /fvgs.*inverted/);
});

test('aligned with no obvious signal → undecided', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'aligned',
    failure_swings: [],
    most_recent_structure: null,
    inverted_fvg_present: false,
  });
  assert.equal(r.priority, 'undecided');
});

test('unclear alignment → undecided', () => {
  const r = computeEntryModelPriority({
    pillar2_verdict: 'good',
    htf_ltf_alignment: 'unclear',
  });
  assert.equal(r.priority, 'undecided');
});

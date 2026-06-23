import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayVote,
  pickPrimaryDraw,
  htfVote,
  INVERSION_DISP_MIN,
  NEAR_PRICE_PCT,
} from '../cli/lib/pillar1-bias.js';

// --- arrayVote: the directional read of a single PD array (daily-bias §2) ---

test('arrayVote: fresh bull FVG votes bullish (respected demand)', () => {
  assert.equal(arrayVote({ dir: 'bull', state: 'fresh' }).vote, 'bullish');
});

test('arrayVote: fresh bear FVG votes bearish (respected supply)', () => {
  assert.equal(arrayVote({ dir: 'bear', state: 'fresh' }).vote, 'bearish');
});

test('arrayVote: ce_tapped counts as respected, votes the array direction', () => {
  assert.equal(arrayVote({ dir: 'bull', state: 'ce_tapped' }).vote, 'bullish');
});

test('arrayVote: inverted bull FVG WITH displacement flips bearish (06-17 daily ds 0.84)', () => {
  assert.equal(arrayVote({ dir: 'bull', state: 'inverted', disp_score: 0.84 }).vote, 'bearish');
});

test('arrayVote: inverted bear FVG WITH displacement flips bullish (06-18 bear FVGs inverted up)', () => {
  assert.equal(arrayVote({ dir: 'bear', state: 'inverted', disp_score: 0.7 }).vote, 'bullish');
});

test('arrayVote: inverted WITHOUT displacement is no vote (06-16 daily ds 0.06)', () => {
  assert.equal(arrayVote({ dir: 'bull', state: 'inverted', disp_score: 0.06 }).vote, 'none');
});

test('arrayVote: filled / invalidated arrays cast no vote', () => {
  assert.equal(arrayVote({ dir: 'bull', state: 'filled' }).vote, 'none');
  assert.equal(arrayVote({ dir: 'bear', state: 'invalidated' }).vote, 'none');
});

test('arrayVote: the inversion cutoff is the published calibration knife', () => {
  assert.equal(arrayVote({ dir: 'bull', state: 'inverted', disp_score: INVERSION_DISP_MIN }).vote, 'bearish');
  assert.equal(arrayVote({ dir: 'bull', state: 'inverted', disp_score: INVERSION_DISP_MIN - 0.01 }).vote, 'none');
});

// --- pickPrimaryDraw + htfVote: oracle session reads (synthetic shapes keyed to
//     the documented discriminators; Stage G validates on real replay data) ---

// helper: a digest-shaped htf block from a flat list of zones per TF
const htf = (byTf) => Object.fromEntries(
  Object.entries(byTf).map(([tf, zones]) => [tf, { top_fvgs: zones, top_bprs: [] }]),
);

test('htfVote: 12-12 — no significant near-price array → no HTF vote (Lanto "2/3, no HTF")', () => {
  // arrays present but all invalidated / far → none qualify
  const blocks = htf({
    h4: [{ dir: 'bear', state: 'invalidated', took_liq: true, ce: 26300 }],
    daily: [{ dir: 'bear', state: 'inverted', disp_score: 0.06, took_liq: true, ce: 26320 }],
    h1: [{ dir: 'bull', state: 'fresh', took_liq: true, ce: 25168 }], // ~1150pt below = far
  });
  const v = htfVote(blocks, { price: 26317 });
  assert.equal(v.vote, 'none');
  assert.equal(v.significant, false);
});

test('htfVote: 06-16 — near-price fresh bear FVG votes bearish; far fresh bull is excluded', () => {
  const blocks = htf({
    h4: [],
    daily: [{ dir: 'bull', state: 'inverted', disp_score: 0.06, took_liq: true, ce: 30880 }], // inverted-no-disp
    h1: [
      { dir: 'bear', state: 'fresh', took_liq: true, size_quality: 'normal', ce: 30889, top: 30894.25, bottom: 30883.75, cite: 'engine_by_tf.h1.fvgs[0]' },
      { dir: 'bull', state: 'fresh', took_liq: true, ce: 31030 }, // ~141pt away ≈ 0.47% = too far
    ],
  });
  const v = htfVote(blocks, { price: 30864 });
  assert.equal(v.vote, 'bearish');
  assert.equal(v.draw.ce, 30889);
  assert.equal(v.draw.cite, 'engine_by_tf.h1.fvgs[0]');
});

test('htfVote: 06-17 — daily bull FVG inverted with displacement (ds 0.84) → bearish', () => {
  const blocks = htf({
    h4: [{ dir: 'bear', state: 'fresh', took_liq: true, disp_score: 0.73, ce: 30490 }],
    daily: [{ dir: 'bull', state: 'inverted', disp_score: 0.84, took_liq: true, ce: 30500 }],
    h1: [],
  });
  const v = htfVote(blocks, { price: 30500 });
  assert.equal(v.vote, 'bearish');
});

test('htfVote: 06-18 — near-price bear FVG inverted UP (displaced) → bullish', () => {
  const blocks = htf({
    h4: [{ dir: 'bear', state: 'inverted', disp_score: 0.6, took_liq: true, ce: 30450 }],
    daily: [{ dir: 'bull', state: 'invalidated', took_liq: true, ce: 30450 }],
    h1: [{ dir: 'bear', state: 'inverted', disp_score: 0.55, took_liq: true, ce: 30452 }],
  });
  const v = htfVote(blocks, { price: 30452 });
  assert.equal(v.vote, 'bullish');
});

test('htfVote: D1 02-09 / D4 10-02 — a tiny-but-fresh, took-liq, near array DOES vote (the floor)', () => {
  const blocks = htf({
    h4: [],
    daily: [],
    h1: [{ dir: 'bull', state: 'fresh', took_liq: true, size_quality: 'tiny', disp_score: 0.1, ce: 25890 }],
  });
  const v = htfVote(blocks, { price: 25900 }); // dist 10pt ≈ 0.04% = near
  assert.equal(v.vote, 'bullish');
  assert.equal(v.draw.size_quality, 'tiny');
});

test('pickPrimaryDraw: a fresh array that took NO liquidity is not significant → no draw', () => {
  const blocks = htf({
    h4: [{ dir: 'bear', state: 'fresh', took_liq: false, ce: 30500 }],
    daily: [],
    h1: [],
  });
  assert.equal(pickPrimaryDraw(blocks, { price: 30490 }), null);
});

test('pickPrimaryDraw: a far array (> NEAR_PRICE_PCT) is excluded even if otherwise significant', () => {
  const far = 30000 * (1 + NEAR_PRICE_PCT * 2); // double the cutoff away
  const blocks = htf({
    h4: [{ dir: 'bull', state: 'fresh', took_liq: true, ce: far }],
    daily: [],
    h1: [],
  });
  assert.equal(pickPrimaryDraw(blocks, { price: 30000 }), null);
});

test('pickPrimaryDraw: 4H outranks 1H when both qualify (§2.1 prefers 4H PD arrays)', () => {
  const blocks = htf({
    h4: [{ dir: 'bull', state: 'fresh', took_liq: true, ce: 30490, cite: 'h4-zone' }],
    daily: [],
    h1: [{ dir: 'bear', state: 'fresh', took_liq: true, ce: 30495, cite: 'h1-zone' }],
  });
  const draw = pickPrimaryDraw(blocks, { price: 30492 });
  assert.equal(draw.tf, 'h4');
  assert.equal(draw.cite, 'h4-zone');
});

test('pickPrimaryDraw: within a TF, the nearest qualifying array wins', () => {
  const blocks = htf({
    h4: [
      { dir: 'bull', state: 'fresh', took_liq: true, ce: 30540, cite: 'far' },
      { dir: 'bear', state: 'fresh', took_liq: true, ce: 30495, cite: 'near' },
    ],
    daily: [],
    h1: [],
  });
  const draw = pickPrimaryDraw(blocks, { price: 30492 });
  assert.equal(draw.cite, 'near');
});

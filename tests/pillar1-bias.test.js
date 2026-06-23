import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayVote,
  pickPrimaryDraw,
  htfVote,
  overnightVote,
  nyOpenReaction,
  combineBias,
  INVERSION_DISP_MIN,
  NEAR_PRICE_PCT,
} from '../cli/lib/pillar1-bias.js';

// open window = 09:30-10:00 ET on an arbitrary day, in ms
const OPEN = { startMs: 1_000_000, endMs: 1_000_000 + 30 * 60 * 1000 };
const at = (minsIntoWindow) => OPEN.startMs + minsIntoWindow * 60 * 1000;

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

// --- overnightVote: the engine's Asia+London directional read (daily-bias §3) ---

test('overnightVote: bull / bear map to directional votes', () => {
  assert.equal(overnightVote({ overnight_dir: 'bull', overnight_net: 301 }).vote, 'bullish');
  assert.equal(overnightVote({ overnight_dir: 'bear', overnight_net: -120 }).vote, 'bearish');
});

test('overnightVote: chop is a non-vote, not a conflict (§1)', () => {
  const v = overnightVote({ overnight_dir: 'chop', overnight_net: 5 });
  assert.equal(v.vote, 'none');
  assert.equal(v.reason, 'overnight-chop');
});

test('overnightVote: na / missing → no vote', () => {
  assert.equal(overnightVote({ overnight_dir: 'na' }).vote, 'none');
  assert.equal(overnightVote({}).vote, 'none');
  assert.equal(overnightVote(null).vote, 'none');
});

test('overnightVote: carries net through for the combiner grab test (D2 06-09 +301 bull)', () => {
  assert.equal(overnightVote({ overnight_dir: 'bull', overnight_net: 301 }).net, 301);
});

// --- nyOpenReaction: the open-window reaction signal (daily-bias §4) ---

test('nyOpenReaction: 06-16 / D2 — swept overnight high then rejected → bearish', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'AS.H', swept_ms: at(25), rejected: true, price: 30889 }],
    window: OPEN,
  });
  assert.equal(r.direction, 'bearish');
  assert.equal(r.interaction, 'sweep_rejection');
  assert.equal(r.level, 'AS.H');
});

test('nyOpenReaction: 12-12 — swept London low, continuation down → bearish', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'LO.L', swept_ms: at(10), rejected: false, price: 6890 }],
    window: OPEN,
  });
  assert.equal(r.direction, 'bearish');
  assert.equal(r.interaction, 'sweep_continuation');
});

test('nyOpenReaction: D1 — swing bull MSS in window → bullish (the reaction is displacement)', () => {
  const r = nyOpenReaction({
    structures: [{ dir: 'bull', tier: 'swing', validation: 'break', confirmed_ms: at(17) }],
    window: OPEN,
  });
  assert.equal(r.direction, 'bullish');
  assert.equal(r.source, 'structure');
  assert.equal(r.tier, 'swing');
});

test('nyOpenReaction: D4 — swing bear MSS in window reads bearish (combiner decides grab vs flip)', () => {
  const r = nyOpenReaction({
    structures: [{ dir: 'bear', tier: 'swing', validation: 'break', confirmed_ms: at(20) }],
    window: OPEN,
  });
  assert.equal(r.direction, 'bearish');
  assert.equal(r.tier, 'swing');
});

test('nyOpenReaction: a swing-tier break outranks a contemporaneous sweep continuation', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'LO.H', swept_ms: at(5), rejected: false, price: 30500 }], // would say bullish
    structures: [{ dir: 'bear', tier: 'swing', validation: 'break', confirmed_ms: at(12) }],
    window: OPEN,
  });
  assert.equal(r.direction, 'bearish');
  assert.equal(r.source, 'structure');
});

test('nyOpenReaction: 06-18 — late BoS (out of window), no overnight sweep → no vote', () => {
  const r = nyOpenReaction({
    structures: [{ dir: 'bull', tier: 'internal', validation: 'break', confirmed_ms: OPEN.endMs + 25 * 60 * 1000 }],
    window: OPEN,
  });
  assert.equal(r.direction, null);
  assert.equal(r.vote, 'none');
});

test('nyOpenReaction: sweeps/structures outside the window are ignored', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'AS.H', swept_ms: OPEN.startMs - 60 * 1000, rejected: true }],
    window: OPEN,
  });
  assert.equal(r.vote, 'none');
});

// --- combineBias: the nested 3-component grade — END-TO-END oracle reproduction.
//     Each case feeds the three vote DIRECTIONS the slices produce for that
//     session and asserts the oracle's bias direction + grade tier (Part D). ---

test('combineBias: 12-12 (D3) — no HTF + overnight bear + open bear → 2/3 B bearish', () => {
  const g = combineBias({ htf: 'none', overnight: 'bearish', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.bias, 'bearish');
  assert.equal(g.draw_bias_pillar, 'clear-2of3');
  assert.equal(g.grade_cap, 'B');
});

test('combineBias: 06-16 — HTF bear + chop + open bear → 2/3 B bearish (single entry caps B)', () => {
  const g = combineBias({ htf: 'bearish', overnight: 'none', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.bias, 'bearish');
  assert.equal(g.grade_cap, 'B');
  assert.equal(g.aligned_count, 2);
});

test('combineBias: D2 06-09 — HTF bear + overnight-bull GRAB + open bear → 2/3 B, b_elevatable (entry→A+)', () => {
  const g = combineBias({ htf: 'bearish', overnight: 'bullish', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.bias, 'bearish');        // overnight bull (the grab) is the absorbed minority
  assert.equal(g.aligned_count, 2);
  assert.equal(g.opposing_count, 1);
  assert.equal(g.grade_cap, 'B');
  assert.equal(g.b_elevatable, true);     // Pillar 3 multi-alignment makes it A+
});

test('combineBias: D4 10-02 — HTF bull + overnight bull + open-bear (non-confirm) → 2/3 B bull, NOT hands-off', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.bias, 'bullish');        // overnight breaks the tie → majority holds
  assert.equal(g.grade_cap, 'B');
  assert.notEqual(g.no_trade_reason, 'conflict_hands_off');
});

test('combineBias: D1 02-09 — HTF bull + chop + open bull → 2/3 B, b_elevatable (multi-align entry→A+)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'none', nyopen: 'bullish', pillar2: 'good' });
  assert.equal(g.bias, 'bullish');
  assert.equal(g.draw_bias_pillar, 'clear-2of3');
  assert.equal(g.b_elevatable, true);
});

test('combineBias: 06-17 — HTF bear + grab + open bear but pillar2 POOR → B + requires clean entry', () => {
  const g = combineBias({ htf: 'bearish', overnight: 'bullish', nyopen: 'bearish', pillar2: 'poor' });
  assert.equal(g.bias, 'bearish');
  assert.equal(g.grade_cap, 'B');
  assert.equal(g.requires_clean_entry, true); // no clean entry → Pillar 3 makes it no-trade
  assert.equal(g.b_elevatable, false);        // poor price cannot elevate
});

test('combineBias: 06-18 — HTF bull + overnight bull + open none, pillar2 poor → 2/3 B bull + requires clean entry', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: 'none', pillar2: 'poor' });
  assert.equal(g.bias, 'bullish');
  assert.equal(g.grade_cap, 'B');
  assert.equal(g.requires_clean_entry, true);
});

test('combineBias: 3/3 aligned + price good → A+-eligible (the only A+ this pillar grants alone)', () => {
  const g = combineBias({ htf: 'bearish', overnight: 'bearish', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.draw_bias_pillar, 'confirmed-3of3');
  assert.equal(g.grade_cap, 'A+');
  assert.equal(g.a_plus_eligible, true);
});

test('combineBias: 3/3 but pillar2 marginal → capped to B (README: any pillar weaker → B)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: 'bullish', pillar2: 'marginal' });
  assert.equal(g.grade_cap, 'B');
  assert.equal(g.a_plus_eligible, false);
});

test('combineBias: TIE (1 HTF vs 1 open, no overnight) → hands-off no-trade (§4)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'none', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.grade_cap, 'no-trade');
  assert.equal(g.no_trade_reason, 'conflict_hands_off');
});

test('combineBias: 1/3 (one lone vote) → no-trade (§1 "one out of three, don\'t trade")', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'none', nyopen: 'none', pillar2: 'good' });
  assert.equal(g.grade_cap, 'no-trade');
  assert.equal(g.no_trade_reason, 'one_of_three');
});

test('combineBias: 0/3 (no read at all) → no-trade', () => {
  const g = combineBias({ htf: 'none', overnight: 'none', nyopen: 'none' });
  assert.equal(g.grade_cap, 'no-trade');
  assert.equal(g.no_trade_reason, 'no_bias');
});

test('combineBias: accepts vote objects, not just direction strings', () => {
  const g = combineBias({
    htf: { vote: 'bearish' },
    overnight: { vote: 'none' },
    nyopen: { direction: 'bearish' },
    pillar2: 'good',
  });
  assert.equal(g.bias, 'bearish');
  assert.equal(g.aligned_count, 2);
});

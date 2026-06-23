import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayVote,
  pickPrimaryDraw,
  htfVote,
  overnightVote,
  nyOpenReaction,
  combineBias,
  smtBiasOf,
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

test('htfVote: a tiny, LOW-displacement gap is "nothing crazy" → no HTF vote (Q1 / BIAS 27:42)', () => {
  const blocks = htf({
    h4: [],
    daily: [],
    h1: [{ dir: 'bull', state: 'fresh', took_liq: true, size_quality: 'tiny', disp_score: 0.1, ce: 25890 }],
  });
  assert.equal(htfVote(blocks, { price: 25900 }).vote, 'none'); // abstains → the day is 2/3
});

test('htfVote: a tiny but CLEANLY-displaced gap still votes ("doesn\'t have to be entirely large", ENTRY 05:38)', () => {
  const blocks = htf({
    h4: [],
    daily: [],
    h1: [{ dir: 'bull', state: 'fresh', took_liq: true, size_quality: 'tiny', disp_score: 0.74, ce: 25890 }],
  });
  assert.equal(htfVote(blocks, { price: 25900 }).vote, 'bullish'); // ds 0.74 ≥ 0.5 (06-16 calibration)
});

test('pickPrimaryDraw: among near took-liq gaps, the BEST-displaced one wins ("block out the noise")', () => {
  const blocks = htf({
    h4: [
      { dir: 'bull', state: 'fresh', took_liq: true, disp_score: 0.55, size_quality: 'normal', ce: 30495, cite: 'weaker-near' },
      { dir: 'bear', state: 'fresh', took_liq: true, disp_score: 0.92, size_quality: 'large', ce: 30505, cite: 'best-disp' },
    ],
    daily: [],
    h1: [],
  });
  const draw = pickPrimaryDraw(blocks, { price: 30500 });
  assert.equal(draw.cite, 'best-disp');
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

// --- nyOpenReaction: the open reaction (daily-bias §4). window = open→read;
//     grab = first 30 min; the swing displacement can confirm later. ---
const READ = { startMs: OPEN.startMs, endMs: OPEN.startMs + 120 * 60 * 1000 }; // open → +2h

test('nyOpenReaction: 12-12 — swept London low, continuation down (no swing) → bearish', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'LO.L', swept_ms: at(10), rejected: false, price: 6890 }],
    window: READ,
  });
  assert.equal(r.direction, 'bearish');
  assert.equal(r.interaction, 'sweep_continuation');
});

test('nyOpenReaction: D1 — swing bull MSS in window → bullish (the reaction is displacement)', () => {
  const r = nyOpenReaction({
    structures: [{ dir: 'bull', tier: 'swing', validation: 'break', confirmed_ms: at(17) }],
    window: READ,
  });
  assert.equal(r.direction, 'bullish');
  assert.equal(r.interaction, 'swing_displacement');
  assert.equal(r.tier, 'swing');
});

test('nyOpenReaction: 06-09 — the LATER swing bear MSS (at +70 min) is the reaction (the window-fix)', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'LO.H', swept_ms: at(10), rejected: false, price: 30040 }], // early bullish grab
    structures: [
      { dir: 'bull', tier: 'swing', validation: 'break', confirmed_ms: at(10) },  // 09:40 bos bull
      { dir: 'bear', tier: 'swing', validation: 'break', confirmed_ms: at(70) },  // 10:40 bear MSS
    ],
    window: READ,
  });
  assert.equal(r.direction, 'bearish');           // the later displacement wins
  assert.equal(r.interaction, 'swing_displacement');
});

test('nyOpenReaction: 06-16 — low-sweep BOUNCE grab against a standing swing bear → failed break, bearish', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'LO.L', swept_ms: at(2), rejected: true, price: 30783 }], // bounce = bullish grab
    structures: [{ dir: 'bear', tier: 'swing', validation: 'break', confirmed_ms: at(-25) }], // 09:05 standing swing bear
    window: READ,
  });
  assert.equal(r.direction, 'bearish');
  assert.equal(r.interaction, 'failed_break');
});

test('nyOpenReaction: a standing swing that AGREES with the grab keeps the structure direction', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'AS.H', swept_ms: at(5), rejected: true, price: 30500 }], // high rejected = bearish grab
    structures: [{ dir: 'bear', tier: 'swing', validation: 'break', confirmed_ms: at(-20) }],
    window: READ,
  });
  assert.equal(r.direction, 'bearish');
  assert.equal(r.interaction, 'standing_swing');
});

test('nyOpenReaction: 06-17 — internal bear break (LH-sequence) outranks the raw low-sweep grab', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'LO.L', swept_ms: at(25), rejected: true, price: 30387 }], // low bounce = bullish grab
    structures: [{ dir: 'bear', tier: 'internal', validation: 'break', confirmed_ms: at(25) }],
    window: READ,
  });
  assert.equal(r.direction, 'bearish');           // structure (LH break) over the raw grab
  assert.equal(r.interaction, 'internal_break');
});

test('nyOpenReaction: no interaction at all → no vote', () => {
  const r = nyOpenReaction({ sweeps: [], structures: [], window: READ });
  assert.equal(r.vote, 'none');
});

test('nyOpenReaction: a pre-open grab (before the open) is ignored', () => {
  const r = nyOpenReaction({
    sweeps: [{ target: 'AS.H', swept_ms: READ.startMs - 60 * 1000, rejected: true }],
    window: READ,
  });
  assert.equal(r.vote, 'none');
});

// --- combineBias: the confirm / reverse / flip grade (daily-bias §1/§4/§5),
//     END-TO-END oracle reproduction. HTF + overnight set the pre-open LEAN; the
//     open-reaction confirms or reverses it. Cases feed the directions the slices
//     produce on the engine's at-open arrays + the open-reaction tier/displacement. ---
const swing = (dir) => ({ vote: dir, tier: 'swing', displaced: true });   // mass-displacement open
const internal = (dir) => ({ vote: dir, tier: 'internal', displaced: false });

test('combineBias: 12-12 (D3) — overnight bear lean, open bear CONFIRMS → 2/3 B bearish', () => {
  const g = combineBias({ htf: 'none', overnight: 'bearish', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.bias, 'bearish');
  assert.equal(g.draw_bias_pillar, 'clear-2of3');
  assert.equal(g.grade_cap, 'B');
  assert.equal(g.reason, 'two_of_three');
});

test('combineBias: D1 02-09 — HTF bull lean, open bull CONFIRMS → 2/3 B, b_elevatable (multi-align→A+)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'none', nyopen: 'bullish', pillar2: 'good' });
  assert.equal(g.bias, 'bullish');
  assert.equal(g.draw_bias_pillar, 'clear-2of3');
  assert.equal(g.b_elevatable, true);
});

test('combineBias: D2 06-09 — bull lean (HTF+overnight), open SWING bear REVERSES → flip bearish B', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: swing('bearish'), pillar2: 'good' });
  assert.equal(g.lean, 'bullish');
  assert.equal(g.bias, 'bearish');         // swing-tier mass-displacement reversal flips the day
  assert.equal(g.grade_cap, 'B');
  assert.equal(g.b_elevatable, true);      // a flip is still elevatable via a multi-alignment entry
  assert.equal(g.reason, 'flip_swing_reversal');
});

test('combineBias: 06-16 — bull lean, open SWING bear REVERSES → flip bearish B', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'none', nyopen: swing('bearish'), pillar2: 'good' });
  assert.equal(g.bias, 'bearish');
  assert.equal(g.grade_cap, 'B');
});

test('combineBias: 06-17 — bull lean, open INTERNAL bear (no mass displacement) → HANDS-OFF no-trade (§4)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: internal('bearish'), pillar2: 'marginal' });
  assert.equal(g.grade_cap, 'no-trade');
  assert.equal(g.no_trade_reason, 'conflict_hands_off'); // "timing is not there yet"
});

test('combineBias: 06-18 — bull lean, open SWING bull CONFIRMS, poor price → 3/3 capped B + clean entry', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: swing('bullish'), pillar2: 'poor' });
  assert.equal(g.bias, 'bullish');
  assert.equal(g.draw_bias_pillar, 'confirmed-3of3');
  assert.equal(g.grade_cap, 'B');             // poor price caps A+ → B
  assert.equal(g.requires_clean_entry, true);
});

test('combineBias: 3/3 confirm + price good → A+-eligible (the only A+ this pillar grants alone)', () => {
  const g = combineBias({ htf: 'bearish', overnight: 'bearish', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.draw_bias_pillar, 'confirmed-3of3');
  assert.equal(g.grade_cap, 'A+');
  assert.equal(g.a_plus_eligible, true);
});

test('combineBias: a FLIP is capped at B even on good price (a reversal day is lower conviction, §2.4)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: swing('bearish'), pillar2: 'good' });
  assert.equal(g.grade_cap, 'B');
  assert.equal(g.a_plus_eligible, false);
});

test('combineBias: a non-swing reversal can NOT flip — needs mass displacement (§5)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'none', nyopen: internal('bearish'), pillar2: 'good' });
  assert.equal(g.no_trade_reason, 'conflict_hands_off');
});

test('combineBias: lone reversal (no HTF + no overnight) → 1/3 no-trade, even swing-tier (§1 BIAS 22:25)', () => {
  const g = combineBias({ htf: 'none', overnight: 'none', nyopen: swing('bearish'), pillar2: 'good' });
  assert.equal(g.grade_cap, 'no-trade');
  assert.equal(g.no_trade_reason, 'one_of_three');
});

test('combineBias: lean but NO open reaction yet → unconfirmed, no trade pre-confirmation (§4)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: 'none', pillar2: 'good' });
  assert.equal(g.bias, 'bullish');
  assert.equal(g.grade_cap, 'no-trade');
  assert.equal(g.no_trade_reason, 'open_unconfirmed');
});

test('combineBias: nothing at all → no-trade', () => {
  const g = combineBias({ htf: 'none', overnight: 'none', nyopen: 'none' });
  assert.equal(g.grade_cap, 'no-trade');
  assert.equal(g.no_trade_reason, 'no_bias');
});

test('combineBias: accepts the nyOpenReaction object (tier/displaced drive the flip)', () => {
  const g = combineBias({
    htf: { vote: 'bullish' },
    overnight: 'bullish',
    nyopen: { direction: 'bearish', interaction: 'swing_displacement', tier: 'swing', displaced: true },
    pillar2: 'good',
  });
  assert.equal(g.bias, 'bearish');     // the swing reversal flips
  assert.equal(g.reason, 'flip_swing_reversal');
});

// --- SMT / leading-asset confirm-or-flip cross-check (daily-bias §6) ---

test('smtBiasOf: maps the leader bias_dir to a bias word', () => {
  assert.equal(smtBiasOf('long'), 'bullish');
  assert.equal(smtBiasOf('short'), 'bearish');
  assert.equal(smtBiasOf(null), null);
  assert.equal(smtBiasOf('flat'), null);
});

test('combineBias: no SMT divergence (smt_bias null) is a no-op — grade unchanged', () => {
  const g = combineBias({ htf: 'bearish', overnight: 'bearish', nyopen: 'bearish', pillar2: 'good' });
  assert.equal(g.grade_cap, 'A+');   // same as the no-smt 3/3 case above
  assert.equal(g.smt, null);
  assert.equal(g.smt_bias, null);
});

test('combineBias: SMT leader AGREES with a 3/3 A+ → confirms, A+ stands (§6)', () => {
  const g = combineBias({ htf: 'bearish', overnight: 'bearish', nyopen: 'bearish', pillar2: 'good', smt_bias: 'bearish' });
  assert.equal(g.grade_cap, 'A+');
  assert.equal(g.a_plus_eligible, true);
  assert.equal(g.smt, 'confirms');
});

test('combineBias: SMT leader OPPOSES a 3/3 A+ → conflict caps A+ → B (the D4 10-02 loss, §6)', () => {
  const g = combineBias({ htf: 'bearish', overnight: 'bearish', nyopen: 'bearish', pillar2: 'good', smt_bias: 'bullish' });
  assert.equal(g.smt, 'conflict');
  assert.equal(g.grade_cap, 'B');         // lowered conviction, not blocked
  assert.equal(g.a_plus_eligible, false);
  assert.equal(g.bias, 'bearish');        // the trade bias is unchanged — SMT only warns
});

test('combineBias: SMT agreeing with a swing-reversal flip → confirms-flip (§6 high conviction)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: swing('bearish'), pillar2: 'good', smt_bias: 'bearish' });
  assert.equal(g.bias, 'bearish');
  assert.equal(g.smt, 'confirms-flip');
  assert.equal(g.grade_cap, 'B');         // a flip stays B
});

test('combineBias: SMT opposing a flip → conflict flag (stays B; flip already capped)', () => {
  const g = combineBias({ htf: 'bullish', overnight: 'bullish', nyopen: swing('bearish'), pillar2: 'good', smt_bias: 'bullish' });
  assert.equal(g.bias, 'bearish');
  assert.equal(g.smt, 'conflict');
  assert.equal(g.grade_cap, 'B');
});

test('combineBias: SMT is inert on a no-trade day (confirms/conflicts a TRADE, not a stand-aside)', () => {
  const g = combineBias({ htf: 'none', overnight: 'none', nyopen: 'none', smt_bias: 'bullish' });
  assert.equal(g.grade_cap, 'no-trade');
  assert.equal(g.smt, null);              // nothing tradable to confirm
  assert.equal(g.smt_bias, 'bullish');    // still recorded for transparency
});

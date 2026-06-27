import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenReaction, overnightTargetsForSession } from '../cli/lib/open-reaction-resolver.js';

// Window: 09:30:00–09:45:00 ET on an arbitrary day (pure ms comparisons).
const W = { startMs: 1_000_000, endMs: 1_900_000 };
const inWindow = (offset = 0) => W.startMs + 60_000 + offset;

function sweep({ target, rejected, ms = inWindow() }) {
  return { target, price: 100, side: 'x', swept_ms: ms, rejected };
}

// §7 Step 4: "Break + rejection in direction of HTF draw → LTF aligns with
// HTF (A+ potential)." §2.4 A+ example: NY breaks London high, rejects hard.
test('rejection at LO.H with bearish HTF draw → aligned, A+ cap', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'LO.H', rejected: true })],
    window: W,
  });
  assert.equal(r.interaction, 'rejection');
  assert.equal(r.level, 'LO.H');
  assert.equal(r.ltf_bias, 'bearish');
  assert.equal(r.htf_ltf_alignment, 'aligned');
  assert.equal(r.is_retrace_day, false);
  assert.equal(r.grade_cap, 'A+');
});

// WAIT-FOR-REACTION (GOFNQ_WAIT_FOR_REACTION, default-ON 2026-06-27) — BIAS 39:20: a
// STRONG overnight (hours of data) dominates a single counter-array; a raw divergent
// grab doesn't flip a strongly-overnight-backed lean. A WEAK overnight leaves the
// divergent retrace trade (the edge) intact. Validated +2.89R on the 19-session fold.
test('wait-for-reaction (default-on): strong overnight backing the lean holds it on a raw divergent grab', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bullish',
    sweeps: [sweep({ target: 'LO.H', rejected: true })], // → bearish grab, divergent
    window: W,
    overnight_net: 448, // strong bull overnight backs the bull lean
  });
  assert.equal(r.interaction, 'pending_reaction');
  assert.equal(r.ltf_bias, 'bullish');
  assert.equal(r.htf_ltf_alignment, 'unclear');
});

test('wait-for-reaction (default-on): a WEAK overnight does NOT hold — the divergent retrace trade survives', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bullish',
    sweeps: [sweep({ target: 'LO.H', rejected: true })],
    window: W,
    overnight_net: 144, // weak (< 300) → keep the divergent read (the edge)
  });
  assert.equal(r.ltf_bias, 'bearish');
  assert.equal(r.htf_ltf_alignment, 'divergent');
});

test('wait-for-reaction opt-out (=0): a strong overnight does not change the divergent verdict', () => {
  const prev = process.env.GOFNQ_WAIT_FOR_REACTION;
  process.env.GOFNQ_WAIT_FOR_REACTION = '0';
  try {
    const r = resolveOpenReaction({
      htf_bias: 'bullish',
      sweeps: [sweep({ target: 'LO.H', rejected: true })],
      window: W,
      overnight_net: 448,
    });
    assert.equal(r.ltf_bias, 'bearish');
    assert.equal(r.htf_ltf_alignment, 'divergent');
  } finally { process.env.GOFNQ_WAIT_FOR_REACTION = prev; }
});

// §2.3: extension day — overnight extends the HTF move and NY continues
// through the overnight low toward the draw. HTF and LTF point the same way
// (§2.4 A+ definition), so alignment holds.
test('continuation through AS.L with bearish HTF draw → aligned extension', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'AS.L', rejected: false })],
    window: W,
  });
  assert.equal(r.interaction, 'continuation');
  assert.equal(r.ltf_bias, 'bearish');
  assert.equal(r.htf_ltf_alignment, 'aligned');
  assert.equal(r.is_retrace_day, false);
  assert.equal(r.grade_cap, 'A+');
});

// §7 Step 4: "Break + continuation against HTF draw → consider today a
// retrace day." §2.4: "Conviction trade but not A+" → cap B.
test('continuation through LO.H against bearish HTF draw → divergent retrace day, B cap', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'LO.H', rejected: false })],
    window: W,
  });
  assert.equal(r.interaction, 'continuation');
  assert.equal(r.ltf_bias, 'bullish');
  assert.equal(r.htf_ltf_alignment, 'divergent');
  assert.equal(r.is_retrace_day, true);
  assert.equal(r.grade_cap, 'B');
});

// Rejection direction counters the break side: a rejected low-break points
// UP. Against a bearish draw that is divergence (§2.3 second example).
test('rejection at AS.L with bearish HTF draw → divergent (rejection points up)', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'AS.L', rejected: true })],
    window: W,
  });
  assert.equal(r.ltf_bias, 'bullish');
  assert.equal(r.htf_ltf_alignment, 'divergent');
  assert.equal(r.is_retrace_day, true);
  assert.equal(r.grade_cap, 'B');
});

// §7 Step 7: "B = One element weaker (… neutral overnight …)" — a quiet open
// with no overnight-level interaction caps at B and leaves bias unset.
test('no overnight interaction in window → unclear, B cap, null bias', () => {
  const r = resolveOpenReaction({ htf_bias: 'bearish', sweeps: [], window: W });
  assert.equal(r.interaction, 'none');
  assert.equal(r.level, null);
  assert.equal(r.ltf_bias, null);
  assert.equal(r.htf_ltf_alignment, 'unclear');
  assert.equal(r.is_retrace_day, false);
  assert.equal(r.grade_cap, 'B');
});

test('sweeps outside the window are ignored', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [
      sweep({ target: 'LO.H', rejected: true, ms: W.startMs - 1 }),
      sweep({ target: 'AS.L', rejected: false, ms: W.endMs }),
    ],
    window: W,
  });
  assert.equal(r.interaction, 'none');
});

// §2.3: "let NY open reaction confirm or challenge it" — the latest
// interaction in the window is the verdict.
test('multiple interactions → latest in window wins', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [
      sweep({ target: 'LO.H', rejected: false, ms: inWindow(0) }),   // bullish continuation first
      sweep({ target: 'LO.H', rejected: true, ms: inWindow(60_000) }), // then hard rejection
    ],
    window: W,
  });
  assert.equal(r.interaction, 'rejection');
  assert.equal(r.ltf_bias, 'bearish');
  assert.equal(r.htf_ltf_alignment, 'aligned');
});

// §7 Step 4 is about the overnight (Asia/London) high/low specifically;
// other level sweeps do not resolve the open reaction by default.
test('non-overnight targets (PDH) are ignored by default', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'PDH', rejected: true })],
    window: W,
  });
  assert.equal(r.interaction, 'none');
  assert.equal(r.htf_ltf_alignment, 'unclear');
});

test('bullish HTF mirror: rejection at AS.L aligns long', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bullish',
    sweeps: [sweep({ target: 'AS.L', rejected: true })],
    window: W,
  });
  assert.equal(r.ltf_bias, 'bullish');
  assert.equal(r.htf_ltf_alignment, 'aligned');
  assert.equal(r.grade_cap, 'A+');
});

test('result carries a citable source path', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'LO.H', rejected: true })],
    window: W,
  });
  assert.match(r.cite, /sweeps/);
});

// §7 Step 4: "More importantly: What is the reaction after that break?"
// The engine separates swing-tier structure (real) from internal (noise).
// A level break whose direction opposes the standing swing-tier structure
// is a FAILED break — the reaction, not the break, sets the bias.
// (June 9: LO.H broke up at 09:43, but the swing-tier MSS bear confirmed
// 09:34 stood — the push failed at 29811 and sell-side delivered all day.)
test('continuation against standing swing-tier structure → failed break, structure direction wins', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'LO.H', rejected: false })],
    swing_structure: { event: 'mss', dir: 'bear', tier: 'swing', confirmed_ms: inWindow(-30_000) },
    window: W,
  });
  assert.equal(r.interaction, 'failed_break');
  assert.equal(r.ltf_bias, 'bearish');
  assert.equal(r.htf_ltf_alignment, 'aligned');
  assert.equal(r.grade_cap, 'A+');
  assert.match(r.cite, /structure/);
});

test('continuation agreeing with swing-tier structure stays a continuation', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'LO.H', rejected: false })],
    swing_structure: { event: 'bos', dir: 'bull', tier: 'swing', confirmed_ms: inWindow(-30_000) },
    window: W,
  });
  assert.equal(r.interaction, 'continuation');
  assert.equal(r.ltf_bias, 'bullish');
});

test('explicit sweep rejection is not overridden by swing structure', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'LO.H', rejected: true })],
    swing_structure: { event: 'mss', dir: 'bull', tier: 'swing', confirmed_ms: inWindow(-30_000) },
    window: W,
  });
  assert.equal(r.interaction, 'rejection');
  assert.equal(r.ltf_bias, 'bearish');
});

// §2.2: "One session creates liquidity, another delivers into it." The PM
// open reacts to the MORNING session's high/low — NYAM.H/L are first-class
// open-reaction targets for ny-pm (the engine emits them; June 11 ny-pm
// replay resolved 'unclear' while the 13:02 NYAM.L sweep sat in the table).
test('session-aware targets: NYAM levels resolve the ny-pm open', () => {
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'NYAM.L', rejected: false })],
    window: W,
    overnight_targets: overnightTargetsForSession('ny-pm'),
  });
  assert.equal(r.interaction, 'continuation');
  assert.equal(r.ltf_bias, 'bearish');
  assert.equal(r.htf_ltf_alignment, 'aligned');
});

test('session-aware targets: ny-am keeps the overnight set without NYAM', () => {
  const am = overnightTargetsForSession('ny-am');
  assert.ok(am.has('AS.H') && am.has('LO.L'));
  assert.ok(!am.has('NYAM.H'));
  const pm = overnightTargetsForSession('ny-pm');
  assert.ok(pm.has('NYAM.H') && pm.has('NYAM.L') && pm.has('AS.H'));
});

// ---- close-based rejection (GXNQ ruling 2026-06-13, June 11 open) ---------
// The engine's sweep `rejected` flag lagged on June 11: LO.H broke at 09:51,
// closes came back under the level at 09:57 and 09:59 — inside the window —
// yet the flag stayed false and the day resolved "continuation"/long. §7
// Step 4 asks "what is the reaction AFTER that break": a window close back
// through the swept level IS the rejection, flag or no flag.

test('a sweep with rejected=false but an in-window close back through the level resolves as rejection', () => {
  const verdict = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [{ target: 'LO.H', price: 28935, side: 'buy', rejected: false, swept_ms: 2_000 }],
    window: { startMs: 0, endMs: 10_000 },
    window_closes: [
      { time_ms: 3_000, close: 28978 },    // holding above
      { time_ms: 5_000, close: 28908.75 }, // back under the level — the rejection
    ],
  });
  assert.equal(verdict.interaction, 'rejection');
  assert.equal(verdict.ltf_bias, 'bearish');
  assert.equal(verdict.htf_ltf_alignment, 'aligned');
  assert.equal(verdict.grade_cap, 'A+');
});

test('closes that hold beyond the level keep the continuation read', () => {
  const verdict = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [{ target: 'LO.H', price: 28935, side: 'buy', rejected: false, swept_ms: 2_000 }],
    window: { startMs: 0, endMs: 10_000 },
    window_closes: [
      { time_ms: 3_000, close: 28978 },
      { time_ms: 5_000, close: 28961.75 },
    ],
  });
  assert.equal(verdict.interaction, 'continuation');
  assert.equal(verdict.ltf_bias, 'bullish');
});

test('a close back through AFTER the window end does not count as in-window rejection', () => {
  const verdict = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [{ target: 'LO.H', price: 28935, side: 'buy', rejected: false, swept_ms: 2_000 }],
    window: { startMs: 0, endMs: 10_000 },
    window_closes: [
      { time_ms: 3_000, close: 28978 },
      { time_ms: 12_000, close: 28900 }, // post-window
    ],
  });
  assert.equal(verdict.interaction, 'continuation');
});

// §2.4 + §3 divergent-clean gate (2026-06-14): a divergent (retrace) trade
// demands a CLEAN rejection. If price ACCEPTED the swept break for >= 5 window
// closes before fading back through, the retrace is weak → stand aside (May 14:
// HTF bull, LO.H accepted 9 bars then faded → wrong shorts). Clean reclaims and
// ALL aligned days are unaffected.
test('divergent + accept-then-fade (weak rejection) → stand aside (May 14)', () => {
  const sw = inWindow();
  const r = resolveOpenReaction({
    htf_bias: 'bullish',
    sweeps: [sweep({ target: 'LO.H', rejected: false, ms: sw })],
    window: W,
    window_closes: [
      { time_ms: sw + 1000, close: 105 }, // accepted above the high for 5 bars…
      { time_ms: sw + 2000, close: 106 },
      { time_ms: sw + 3000, close: 104 },
      { time_ms: sw + 4000, close: 103 },
      { time_ms: sw + 5000, close: 102 },
      { time_ms: sw + 6000, close: 98 },  // …then faded below (late rejection)
    ],
  });
  assert.equal(r.interaction, 'divergent_weak_rejection');
  assert.equal(r.ltf_bias, null);
  assert.equal(r.htf_ltf_alignment, 'unclear');
});

// Boundary: a divergent reclaim that accepted the break for exactly 4 bars is
// still CLEAN enough to keep (May 25 / May 29 — both ran to big winners that a
// tighter >= 4 cut wrongly discarded). The gate fires only at >= 5.
test('divergent + 4-bar acceptance → kept as retrace (May 25 / May 29)', () => {
  const sw = inWindow();
  const r = resolveOpenReaction({
    htf_bias: 'bullish',
    sweeps: [sweep({ target: 'LO.H', rejected: false, ms: sw })],
    window: W,
    window_closes: [
      { time_ms: sw + 1000, close: 105 }, // accepted above the high for 4 bars…
      { time_ms: sw + 2000, close: 106 },
      { time_ms: sw + 3000, close: 104 },
      { time_ms: sw + 4000, close: 103 },
      { time_ms: sw + 5000, close: 98 },  // …then reclaimed below (clean enough)
    ],
  });
  assert.equal(r.interaction, 'rejection');
  assert.equal(r.ltf_bias, 'bearish');
  assert.equal(r.htf_ltf_alignment, 'divergent');
  assert.equal(r.grade_cap, 'B');
});

test('divergent + clean instant reclaim → kept as retrace (June 12)', () => {
  const sw = inWindow();
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'LO.L', rejected: false, ms: sw })],
    window: W,
    window_closes: [
      { time_ms: sw + 1000, close: 98 },  // 1-bar grab below…
      { time_ms: sw + 2000, close: 103 }, // …instant reclaim above
      { time_ms: sw + 3000, close: 104 },
    ],
  });
  assert.equal(r.interaction, 'rejection');
  assert.equal(r.ltf_bias, 'bullish');
  assert.equal(r.htf_ltf_alignment, 'divergent');
});

test('aligned days are never gated, even with high accept-bars (June 9)', () => {
  const sw = inWindow();
  const r = resolveOpenReaction({
    htf_bias: 'bearish',
    sweeps: [sweep({ target: 'LO.H', rejected: false, ms: sw })],
    window: W,
    window_closes: [
      { time_ms: sw + 1000, close: 105 },
      { time_ms: sw + 2000, close: 106 },
      { time_ms: sw + 3000, close: 104 },
      { time_ms: sw + 4000, close: 103 },
      { time_ms: sw + 5000, close: 98 }, // rejection, but aligned → not gated
    ],
  });
  assert.equal(r.interaction, 'rejection');
  assert.equal(r.ltf_bias, 'bearish');
  assert.equal(r.htf_ltf_alignment, 'aligned');
  assert.equal(r.grade_cap, 'A+');
});

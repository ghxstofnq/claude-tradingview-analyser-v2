import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionPacketForWalker } from '../../../app/main/strategy/walkers/execution-packet.js';
import { createWalker } from '../../../app/main/strategy/walkers/walker-state.js';
import { sizeFor, dayOfWeek } from '../../../cli/lib/sizing.js';

const pdArray = {
  evidenceRef: 'gates.engine.pillar3.fvgs[0]',
  kind: 'fvg',
  direction: 'bullish',
  size_quality: 'large',
  top: 21000,
  bottom: 20980,
};

function confirmedMssWalker(pdOverrides = {}) {
  const context = { market: 'MNQ1!', session: 'ny-am', eventTimeUtc: '2026-05-29T13:45:00.000Z' };
  const pd = { ...pdArray, ...pdOverrides };
  return {
    ...createWalker({ context, model: 'MSS', side: 'long', pdArray: pd }),
    stage: 'confirmed',
    confirmationRef: 'gates.engine.confirmation',
    evidence: {
      pdArray: { evidenceRef: pd.evidenceRef, rawPayload: pd },
      confirmation: {
        evidenceRef: 'gates.engine.confirmation',
        rawPayload: { close: 21002, confirm_ms: 1780062420000, confirm_dir: 'bull' },
      },
    },
  };
}

function executableContext(overrides = {}) {
  return {
    market: 'MNQ1!',
    session: 'ny-am',
    eventTimeUtc: '2026-05-29T13:47:00.000Z',
    pillar1: {
      status: 'pass',
      untakenTargets: {
        above: [{ price: 21040, label: 'London High', evidenceRef: 'p1.targets.londonHigh' }],
        below: [],
      },
    },
    pillar2: { status: 'pass', displacement: 'clean', blockers: [] },
    pillar3: {
      structuralStops: [{ side: 'long', price: 20980, kind: 'mss_swing_low', evidenceRef: 'p3.stops.mssLow' }],
    },
    ...overrides,
  };
}

test('buildExecutionPacketForWalker creates executable packet only from confirmed walker evidence', () => {
  // Aligned chain handoff so the six-element grade rule awards A+ — this
  // test's focus is packet construction, not grading (see grade tests below).
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: { leader: 'MNQ1!', ltfBias: 'bullish', htfLtfAlignment: 'aligned', entryModelPriority: 'MSS', gradeCap: 'A+' } }),
    walker: confirmedMssWalker(),
  });

  assert.equal(packet.status, 'executable');
  assert.equal(packet.model, 'MSS');
  assert.equal(packet.side, 'long');
  assert.equal(packet.entry.price, 21002);
  assert.equal(packet.entry.evidenceRef, 'gates.engine.confirmation');
  assert.equal(packet.stop.price, 20980);
  assert.equal(packet.stop.evidenceRef, 'p3.stops.mssLow');
  assert.equal(packet.tp1.price, 21040);
  assert.equal(packet.tp1.rMultiple, 1.73);
  assert.equal(packet.grade, 'A+');
  assert.equal(packet.finalVerdict, 'manual_candidate');
  assert.equal(packet.evidenceAudit.entry.timestampMs, 1780062420000);
  assert.equal(packet.evidenceAudit.entry.close, 21002);
  assert.equal(packet.evidenceAudit.stop.rule, 'mss_structural_swing');
  assert.equal(packet.evidenceAudit.stop.anchorPrice, 20980);
  assert.equal(packet.evidenceAudit.tp1.label, 'London High');
  assert.equal(packet.evidenceAudit.tp1.rMultiple, 1.73);
});

test('buildExecutionPacketForWalker records rejected alternative stops for transparent review', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      pillar3: {
        structuralStops: [
          { side: 'long', price: 20980, kind: 'mss_swing_low', evidenceRef: 'p3.stops.valid' },
          { side: 'long', price: 21005, kind: 'above_entry', evidenceRef: 'p3.stops.invalidAboveEntry' },
          { side: 'long', price: 'bad', kind: 'malformed', evidenceRef: 'p3.stops.malformed' },
        ],
      },
    }),
    walker: confirmedMssWalker(),
  });

  assert.equal(packet.stop.evidenceRef, 'p3.stops.valid');
  assert.deepEqual(packet.evidenceAudit.stop.rejectedAlternatives.map((item) => item.reason), ['wrong_side_of_entry', 'invalid_price']);
  assert.deepEqual(packet.evidenceAudit.stop.rejectedAlternatives.map((item) => item.evidenceRef), ['p3.stops.invalidAboveEntry', 'p3.stops.malformed']);
});

test('buildExecutionPacketForWalker blocks instead of inventing stop or weak TP1', () => {
  // An empty pivot pool no longer blocks an MSS with a zone: the FVG low is
  // a doc-sanctioned stop (entry-models.md MSS §6 "or below the FVG low").
  const zoneEdge = buildExecutionPacketForWalker({
    context: executableContext({ pillar3: { structuralStops: [] } }),
    walker: confirmedMssWalker(),
  });
  assert.equal(zoneEdge.stop.kind, 'mss_zone_edge');
  assert.equal(zoneEdge.stop.price, 20980);

  // No pool AND no zone bounds → still fail closed.
  const noStop = buildExecutionPacketForWalker({
    context: executableContext({ pillar3: { structuralStops: [] } }),
    walker: confirmedMssWalker({ top: null, bottom: null }),
  });
  assert.equal(noStop.status, 'blocked');
  assert.ok(noStop.blockers.includes('missing_structural_stop'));
  assert.equal(noStop.finalVerdict, 'no_trade');

  const weakTarget = buildExecutionPacketForWalker({
    context: executableContext({
      pillar1: { status: 'pass', untakenTargets: { above: [{ price: 21020, label: 'small internal', evidenceRef: 'target.tooClose' }], below: [] } },
    }),
    walker: confirmedMssWalker(),
  });
  assert.equal(weakTarget.status, 'blocked');
  assert.ok(weakTarget.blockers.includes('tp1_below_1_5r'));
  assert.equal(weakTarget.finalVerdict, 'no_trade');
});

// ── Late-session entry cutoff (user ruling 2026-06-13) ────────────────
// No new entries once the confirming bar closes at 15:32 ET or later — too
// little runway before the 16:00 forced close. The 15:30 candle (closes
// 15:31) is the last one that may confirm a new entry.
test('entry cutoff: a confirmation closing 15:33 ET is blocked', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain(), eventTimeUtc: '2026-06-11T19:33:00.000Z' }), // 15:33 ET
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.status, 'blocked');
  assert.ok(packet.blockers.includes('entry_after_session_cutoff'));
  assert.equal(packet.finalVerdict, 'no_trade');
});

test('entry cutoff: the 15:31 close (15:30 candle) is the last allowed; 15:32 is blocked', () => {
  const allowed = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain(), eventTimeUtc: '2026-06-02T19:31:00.000Z' }), // 15:31 ET
    walker: confirmedMssWalker(),
  });
  assert.equal(allowed.status, 'executable');
  assert.ok(!allowed.blockers.includes('entry_after_session_cutoff'));

  const blocked = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain(), eventTimeUtc: '2026-06-02T19:32:00.000Z' }), // 15:32 ET
    walker: confirmedMssWalker(),
  });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.blockers.includes('entry_after_session_cutoff'));
});

test('entry cutoff: AM confirmations are unaffected', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain(), eventTimeUtc: '2026-06-02T13:47:00.000Z' }), // 09:47 ET
    walker: confirmedMssWalker(),
  });
  assert.ok(!packet.blockers.includes('entry_after_session_cutoff'));
});

// Grade-tiered AM cutoff (user ruling 2026-06-13): a B setup in NY-AM may only
// confirm until 11:40 ET; A+ keeps the window to noon.
test('AM cutoff: a B setup at 11:45 ET is blocked; an A+ setup is allowed', () => {
  // No aligned chain → grade B. At 11:45 ET (15:45 UTC), AM → blocked.
  const lateB = buildExecutionPacketForWalker({
    context: executableContext({ eventTimeUtc: '2026-06-11T15:45:00.000Z' }),
    walker: confirmedMssWalker(),
  });
  assert.equal(lateB.status, 'blocked');
  assert.ok(lateB.blockers.includes('b_grade_after_am_cutoff'));

  // Aligned chain → grade A+. Same 11:45 ET bar → allowed (A+ keeps the rope).
  const lateAplus = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain(), eventTimeUtc: '2026-06-11T15:45:00.000Z' }),
    walker: confirmedMssWalker(),
  });
  assert.equal(lateAplus.status, 'executable');
  assert.ok(!lateAplus.blockers.includes('b_grade_after_am_cutoff'));
});

test('AM cutoff: a B setup BEFORE 11:40 ET is allowed', () => {
  const earlyB = buildExecutionPacketForWalker({
    context: executableContext({ eventTimeUtc: '2026-06-11T15:30:00.000Z' }), // 11:30 ET
    walker: confirmedMssWalker(),
  });
  assert.ok(!earlyB.blockers.includes('b_grade_after_am_cutoff'));
});

test('AM cutoff: inert in the PM session (only NY-AM is gated)', () => {
  const pmB = buildExecutionPacketForWalker({
    context: executableContext({ session: 'ny-pm', eventTimeUtc: '2026-06-11T15:45:00.000Z' }),
    walker: confirmedMssWalker(),
  });
  assert.ok(!pmB.blockers.includes('b_grade_after_am_cutoff'));
});

// ── Six-element grading (2026-06-12) ──────────────────────────────────
// Grade mirrors constraint #9 / trading-strategy-2026.md §7 step 7: A+ when
// ALL elements align — HTF bias+draw (pillar1 pass), price quality good
// (pillar2 pass), NY reaction confirmed the read (ltf bias handoff present
// AND htf_ltf_alignment aligned), entry model identified, confirmation
// confirmed (structural givens at packet time). Zone size_quality is NOT a
// grading element — the June 9 A+ Inversion rode a medium zone (hand-graded
// A+ by GXNQ; the old rule said B).

function alignedChain(overrides = {}) {
  return {
    leader: 'MNQ1!',
    ltfBias: 'bullish',
    htfLtfAlignment: 'aligned',
    entryModelPriority: 'MSS',
    gradeCap: 'A+',
    ...overrides,
  };
}

test('grade: all six elements aligned → A+ even on a medium zone', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain() }),
    walker: confirmedMssWalker({ size_quality: 'medium' }),
  });
  assert.equal(packet.status, 'executable');
  assert.equal(packet.grade, 'A+');
});

test('packet carries per-trade size (TS §6 / §7 Step 7: grade × day-of-week) — G6', () => {
  // TS §6: "Sizing scaled by day of week (Mon/Fri reduced) + trade grade."
  // The packet now carries the size so the trader sees it on the execution
  // card. Additive display — does NOT affect entry/stop/tp1/R (refold-safe).
  const context = executableContext({ sessionChain: alignedChain() });
  const packet = buildExecutionPacketForWalker({ context, walker: confirmedMssWalker() });
  const expected = sizeFor({ grade: packet.grade, dow: dayOfWeek(new Date(context.eventTimeUtc)) });
  assert.equal(packet.status, 'executable');
  assert.ok(packet.size, 'packet should carry a size object');
  assert.equal(packet.size.contracts, expected.contracts);
  assert.equal(packet.size.r_unit, expected.r_unit);
  assert.equal(packet.size.label, expected.label);
  assert.ok(packet.size.contracts >= 1, 'an executable packet sizes at least 1 contract');
});

test('grade: divergent alignment is one weaker element → B', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain({ htfLtfAlignment: 'divergent', entryModelPriority: 'MSS' }) }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.grade, 'B');
});

test('grade: missing ltf-bias handoff (open reaction never confirmed) → B', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain({ ltfBias: null }) }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.grade, 'B');
});

test('grade: chain grade cap still binds an otherwise-A+ packet', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain({ gradeCap: 'B' }) }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.grade, 'B');
});

test('grade: pillar2 fail is no-trade, packet blocked', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain(), pillar2: { status: 'fail', blockers: ['pillar2_poor'] } }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.status, 'blocked');
  assert.ok(packet.blockers.includes('grade_blocked'));
});

// §7 Step 5 + §2.3: the entry model is chosen in the bias direction — a
// packet whose side contradicts a NON-null LTF bias is not in the playbook.
// (June 9 replay: with bias bearish-aligned, an MSS long surfaced and graded
// A+ while the hand-graded Inversion short sat behind it in selection.)
test('packet side contradicting ltf bias is blocked', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain({ ltfBias: 'bearish' }) }),
    walker: confirmedMssWalker(), // side long
  });
  assert.equal(packet.status, 'blocked');
  assert.ok(packet.blockers.includes('side_contradicts_ltf_bias'));
});

test('packet side matching ltf bias passes the side gate', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain({ ltfBias: 'bullish' }) }),
    walker: confirmedMssWalker(),
  });
  assert.ok(!packet.blockers.includes('side_contradicts_ltf_bias'));
});

test('null ltf bias (pre-open) does not side-block packets', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain({ ltfBias: null }) }),
    walker: confirmedMssWalker(),
  });
  assert.ok(!packet.blockers.includes('side_contradicts_ltf_bias'));
});

// Priority prefers, never blocks: with two executable packets the priority
// model wins selection; the other stays available.
test('packet selection prefers the priority model among executables', async () => {
  const { runDeterministicWalkerStrategy } = await import('../../../app/main/strategy/walkers/deterministic-strategy.js');
  const mss = confirmedMssWalker();
  const trend = { ...confirmedMssWalker(), id: 'w-trend', model: 'Trend' };
  const context = executableContext({
    sessionChain: alignedChain({ entryModelPriority: 'Trend' }),
  });
  const result = runDeterministicWalkerStrategy({ context, walkers: [mss, trend] });
  const executable = result.packets.filter((p) => p.status === 'executable');
  assert.equal(executable.length, 2);
  assert.equal(result.bestPacket.model, 'Trend');
});

// Constraint #9: A+ requires price quality GOOD. The engine's displacement
// enum (clean|acceptable|weak|na) draws the line at weak: June 9's A+ entry
// bar read 'acceptable' (A+ stands); June 10's read 'weak' — the documented
// "tradable B day". Weak displacement is the one-weaker-element → B.
test('grade: weak displacement at confirmation caps an aligned packet at B', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      pillar2: { status: 'pass', displacement: 'weak', blockers: [] },
    }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.grade, 'B');
});

test('grade: acceptable displacement still allows A+', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      pillar2: { status: 'pass', displacement: 'acceptable', blockers: [] },
    }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.grade, 'A+');
});

// §2.4: on a divergent/retrace day "he will still trade [the LTF direction],
// but with slightly lower conviction/size" — lower conviction is the B cap,
// not a model ban. The MSS-only divergent gate was the resolver's PRIORITY
// mapping hardened into a blocker (same defect class as
// entry_model_priority_blocked): live 2026-06-12 it auto-blocked every
// Trend continuation long on a day whose LTF turn had confirmed at swing
// tier (MSS bull 09:50, BOS bull 11:10) and price rallied 450pts.
test('divergent day: a Trend packet in the LTF direction is playable at B, not blocked', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain({ htfLtfAlignment: 'divergent', ltfBias: 'bullish', gradeCap: 'B' }),
    }),
    walker: { ...confirmedMssWalker(), model: 'Trend' }, // side long
  });
  assert.ok(!packet.blockers.includes('divergent_day_requires_mss'), `blockers: ${packet.blockers}`);
  assert.equal(packet.status, 'executable');
  assert.equal(packet.grade, 'B'); // divergent never grades A+
});

// §6 / MSS model: "Target: Next internal high, then session high / HTF
// draw." TP1 must come from intraday liquidity — internal swing pivots and
// leg extremes join the target pool; the nearest target satisfying the
// 1.5R discipline wins (nearer swings that fail R are skipped, not
// blocking). TP2 is the next target beyond TP1. (Audit 2026-06-12: the
// pool held only untaken session levels — the first live setup got the
// weekly high as TP1 at 9.2R, and TP2 duplicated TP1.)
test('tp1 prefers the nearest unswept swing clearing 2R; tp2 is the next target beyond', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      pillar3: {
        structuralStops: [
          { side: 'long', price: 20980, kind: 'mss_swing_low', evidenceRef: 'p3.stops.mssLow' },
          { kind: 'swing_high', price: 21015, evidenceRef: 'p3.swings.near' },     // 0.59R — skipped
          { kind: 'swing_high', price: 21046.5, evidenceRef: 'p3.swings.target' }, // 2.02R — TP1
        ],
      },
    }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.status, 'executable');
  assert.equal(packet.tp1.price, 21046.5);
  assert.equal(packet.tp2 ?? null, null); // nothing beyond the swing
});

test('tp1 falls back to session levels when no swing target exists (old behavior preserved)', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({ sessionChain: alignedChain() }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.tp1.price, 21040);
});

// User correction 2026-06-12: a SWEPT swing holds no resting liquidity —
// it is not a target. (The June 9 doc-faithful TP1 had selected 29692.25,
// an already-swept low.) Targets draw on UNSWEPT internal swings only;
// the same rule the system already enforces for session levels.
test('swept swings are not targets; the nearest UNSWEPT swing wins', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      pillar3: {
        structuralStops: [
          { side: 'long', price: 20980, kind: 'mss_swing_low', evidenceRef: 'p3.stops.mssLow' },
          { kind: 'swing_high', price: 21048, swept: true, evidenceRef: 'p3.swings.swept' },    // dead liquidity
          { kind: 'swing_high', price: 21050, swept: false, evidenceRef: 'p3.swings.live' },   // 2.18R — TP1
        ],
      },
    }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.tp1.price, 21050);
});

// User ruling 2026-06-12: a swing low/high qualifies as TP1 only at ≥2R.
// Session levels keep the 1.5R floor. A 1.6R swing is skipped in favor of
// the level beyond it.
test('tp1: swings need 2R — a 1.6R swing yields to the qualifying level', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      pillar3: {
        structuralStops: [
          { side: 'long', price: 20980, kind: 'mss_swing_low', evidenceRef: 'p3.stops.mssLow' },
          // entry 21002, stop 20980 → risk 22. Swing at 21037.5 = 1.61R < 2R → skipped.
          { kind: 'swing_high', price: 21037.5, swept: false, evidenceRef: 'p3.swings.near' },
        ],
      },
    }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.tp1.price, 21040); // session level (1.73R ≥ 1.5R floor)
});

test('tp1: a swing clearing 2R still wins over the farther level', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      pillar3: {
        structuralStops: [
          { side: 'long', price: 20980, kind: 'mss_swing_low', evidenceRef: 'p3.stops.mssLow' },
          { kind: 'swing_high', price: 21046.5, swept: false, evidenceRef: 'p3.swings.q' }, // 2.02R
        ],
      },
    }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.tp1.price, 21046.5);
});

// User finding 2026-06-13 (June 12 AM + June 11 PM 13:30): a WIDE stop
// deflates every nearby target below the R-floors, so the only level
// clearing 1.5R is the far WEEKLY draw (PWH) — and selectTp1 grabbed it,
// setting an unreachable intraday TP1 (1300+ pts away) that left the trade
// open all session. §7 Step 7: TP1 is the nearest INTRADAY liquidity; the
// weekly draw (PWH/PWL) is the TP2/runner. The weekly draw is excluded from
// the TP1 pool, so the wide-stop trade flags tp1_below_1_5r (→ no-trade)
// instead of opening toward an unreachable target.
test('tp1 never jumps to the weekly draw (PWH) when a wide stop deflates nearby targets', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      // entry 21002, stop 20900 → risk 102 (wide). LO_H 21040 = 0.37R;
      // PWH 21300 = 2.92R (the only target clearing the 1.5R floor).
      pillar3: { structuralStops: [{ side: 'long', price: 20900, kind: 'mss_swing_low', evidenceRef: 'p3.stops.wide' }] },
      pillar1: {
        status: 'pass',
        untakenTargets: {
          above: [
            { price: 21040, name: 'LO_H', evidenceRef: 'p1.targets.loH' },
            { price: 21300, name: 'PWH', evidenceRef: 'p1.targets.pwh' },
          ],
          below: [],
        },
      },
    }),
    walker: confirmedMssWalker(),
  });
  // TP1 lands on the nearest intraday level, NOT the weekly draw...
  assert.equal(packet.tp1.price, 21040);
  // ...and because that nearest target is < 1.5R under the wide stop, the
  // trade correctly blocks instead of opening toward an unreachable target.
  assert.equal(packet.status, 'blocked');
  assert.ok(packet.blockers.includes('tp1_below_1_5r'));
});

// The weekly draw is still a valid TP2/runner (§7 Step 7 "second toward the
// HTF draw") — excluding it from TP1 must not remove it from TP2.
test('tp2 still reaches the weekly draw (PWH) once a nearer intraday TP1 qualifies', () => {
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      // entry 21002, stop 20980 → risk 22. Swing 21046.5 = 2.02R → TP1.
      pillar3: {
        structuralStops: [
          { side: 'long', price: 20980, kind: 'mss_swing_low', evidenceRef: 'p3.stops.mssLow' },
          { kind: 'swing_high', price: 21046.5, swept: false, evidenceRef: 'p3.swings.q' },
        ],
      },
      pillar1: {
        status: 'pass',
        untakenTargets: { above: [{ price: 21300, name: 'PWH', evidenceRef: 'p1.targets.pwh' }], below: [] },
      },
    }),
    walker: confirmedMssWalker(),
  });
  assert.equal(packet.tp1.price, 21046.5);
  assert.equal(packet.tp2?.price, 21300); // weekly draw rides as the runner
});

// User hand-grade 2026-06-13 (June 9 trades 2+3): the Inversion stop is the
// VIOLATING CANDLE's extreme — entry-models.md Inversion §5 "below the
// candle that closed through it" (above, for shorts) — and it OUTRANKS the
// structural swing beyond the zone. The earlier precedence (swing first)
// produced 29698.75/29547.25 where the hand grade says 29714.25/29526.25.
test('inversion stop: the violating candle extreme outranks the beyond-zone swing', () => {
  const walker = {
    ...confirmedMssWalker({ top: 21010, bottom: 21000 }),
    model: 'Inversion',
    side: 'long',
  };
  walker.evidence.confirmation.rawPayload.last_bar = { high: 21008, low: 20992 };
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain(),
      pillar3: {
        structuralStops: [
          // swing beyond the zone bottom — the OLD rule would pick 20978
          { kind: 'swing_low', side: 'long', price: 20978, evidenceRef: 'p3.swings.beyond' },
        ],
      },
    }),
    walker,
  });
  assert.equal(packet.stop.kind, 'inversion_violating_candle');
  assert.equal(packet.stop.price, 20992);
});

test('mss stop: the structural swing beyond the reversal zone outranks micro-pivots near entry', () => {
  // entry-models.md MSS §6: "Stop: Below the MSS low or below the FVG low"
  // — the grab low the displacement launched from, NOT the nearest pivot
  // (June 11 10:18 MSS long carried a 1.5-pt micro-pivot stop).
  const walker = {
    ...confirmedMssWalker({ top: 21010, bottom: 21000, direction: 'bullish' }),
    model: 'MSS',
    side: 'long',
  };
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain({ ltfBias: 'bullish' }),
      pillar1: {
        status: 'pass',
        untakenTargets: { above: [{ price: 21100, label: 'PDH', evidenceRef: 'p1.targets.pdh' }], below: [] },
      },
      pillar3: {
        structuralStops: [
          { kind: 'swing_low', side: 'long', price: 21010.5, evidenceRef: 'p3.stops.micro' }, // 1.5 below entry
          { kind: 'swing_low', side: 'long', price: 20990, evidenceRef: 'p3.stops.mss_low' }, // beyond the zone = the MSS low
        ],
        pdArrays: [],
        ohlcv1m: [],
      },
    }),
    walker,
  });
  assert.equal(packet.stop.kind, 'mss_structural_swing');
  assert.equal(packet.stop.price, 20990);
});

test('mss stop: zone edge fallback when no swing exists beyond the zone', () => {
  const walker = {
    ...confirmedMssWalker({ top: 21010, bottom: 21000, direction: 'bullish' }),
    model: 'MSS',
    side: 'long',
  };
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain({ ltfBias: 'bullish' }),
      pillar1: {
        status: 'pass',
        untakenTargets: { above: [{ price: 21100, label: 'PDH', evidenceRef: 'p1.targets.pdh' }], below: [] },
      },
      pillar3: {
        structuralStops: [
          { kind: 'swing_low', side: 'long', price: 21010.5, evidenceRef: 'p3.stops.micro' },
        ],
        pdArrays: [],
        ohlcv1m: [],
      },
    }),
    walker,
  });
  assert.equal(packet.stop.kind, 'mss_zone_edge');
  assert.equal(packet.stop.price, 21000);
});

test('trend stop: the tap candle extreme, then the zone far edge (entry-models.md Trend §6)', () => {
  // June 9 trade 7 (GXNQ: "A+ confirmed Trend continuation"): short off the
  // bear FVG 28965-29000.75; the 11:53 tap candle's high 28971.75 is the
  // swing that touched the zone — the stop anchor. Zone high is fallback.
  const walker = {
    ...confirmedMssWalker({ top: 29000.75, bottom: 28965, direction: 'bearish' }),
    model: 'Trend',
    side: 'short',
  };
  walker.evidence.confirmation.rawPayload = {
    source: 'trend_wick_tap_confirm',
    close: 28911.75,
    last_bar: { time: 1781020320, open: 28954.5, high: 28971.75, low: 28909, close: 28911.75, direction: 'bearish', body_ratio: 0.68 },
  };
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain({ ltfBias: 'bearish' }),
      pillar1: {
        status: 'pass',
        untakenTargets: { above: [], below: [{ price: 28700, label: 'PDL', evidenceRef: 'p1.targets.pdl' }] },
      },
      pillar3: {
        structuralStops: [{ kind: 'swing_high', side: 'short', price: 29046, evidenceRef: 'p3.stops.high' }],
        pdArrays: [],
        ohlcv1m: [],
      },
    }),
    walker,
  });
  assert.equal(packet.stop.kind, 'trend_tap_candle');
  assert.equal(packet.stop.price, 28971.75);
});

test('inversion stop: the failed-leg extreme across visible 1m bars outranks the violating candle', () => {
  // User hand-grade 2026-06-13 (June 9): all three Inversion stops sit at
  // the HIGH OF THE FAILED LEG that created the violated zone (29847 /
  // 29714.25 / 29526.25) = the max high of the visible 1m bars at packet
  // time — not the violating candle's own high.
  const walker = {
    ...confirmedMssWalker({ top: 21010, bottom: 21000, direction: 'bullish' }),
    model: 'Inversion',
    side: 'short',
  };
  walker.evidence.confirmation.rawPayload = { close: 20995, confirm_ms: 1780062600000, last_bar: { high: 21002, low: 20990 } };
  const packet = buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain({ ltfBias: 'bearish' }),
      pillar1: {
        status: 'pass',
        untakenTargets: { above: [], below: [{ price: 20940, label: 'PDL', evidenceRef: 'p1.targets.pdl' }] },
      },
      pillar3: {
        structuralStops: [{ kind: 'swing_high', side: 'short', price: 21030, evidenceRef: 'p3.stops.high' }],
        pdArrays: [{ rawPayload: { kind: 'ifvg', top: 21010, bottom: 21000, inverted_ms: 1780062470000 } }],
        ohlcv1m: [
          { time: 1780062300, open: 21008, high: 21022.5, low: 21004, close: 21012 }, // failed-leg high
          { time: 1780062360, open: 21012, high: 21018, low: 21006, close: 21010 },
          { time: 1780062420, open: 21005, high: 21014.25, low: 20999, close: 20998 }, // violating bar
          { time: 1780062480, open: 20998, high: 21002, low: 20990, close: 20995 },
        ],
      },
    }),
    walker,
  });
  assert.equal(packet.stop.kind, 'inversion_failed_leg_extreme');
  assert.equal(packet.stop.price, 21022.5);
});

// Wide-leg risk cap (user ruling 2026-06-14): when the failed-leg extreme is
// more than 95 pts from entry (high-volatility regime), fall back to the tighter
// violating-candle stop. 4-week fold: 90-99pt plateau, +6.13R, no winner broken.
function wideLegInversion({ legHigh, candleHigh, close }) {
  const walker = {
    ...confirmedMssWalker({ top: 21010, bottom: 21000, direction: 'bullish' }),
    model: 'Inversion',
    side: 'short',
  };
  walker.evidence.confirmation.rawPayload = { close, confirm_ms: 1780062600000, last_bar: { high: candleHigh, low: close - 10 } };
  return buildExecutionPacketForWalker({
    context: executableContext({
      sessionChain: alignedChain({ ltfBias: 'bearish' }),
      pillar1: { status: 'pass', untakenTargets: { above: [], below: [{ price: 20700, label: 'PDL', evidenceRef: 'p1.targets.pdl' }] } },
      pillar3: {
        structuralStops: [{ kind: 'swing_high', side: 'short', price: 21030, evidenceRef: 'p3.stops.high' }],
        pdArrays: [{ rawPayload: { kind: 'ifvg', top: 21010, bottom: 21000, inverted_ms: 1780062470000 } }],
        ohlcv1m: [
          { time: 1780062300, open: legHigh - 5, high: legHigh, low: legHigh - 20, close: legHigh - 8 },
          { time: 1780062480, open: candleHigh - 5, high: candleHigh, low: close - 10, close },
        ],
      },
    }),
    walker,
  });
}

test('inversion stop: a leg wider than 95pt falls back to the tighter violating candle', () => {
  // entry 20900, leg high 21000 = 100pt (> 95) → use the 50pt candle instead.
  const packet = wideLegInversion({ legHigh: 21000, candleHigh: 20950, close: 20900 });
  assert.equal(packet.stop.kind, 'inversion_violating_candle');
  assert.equal(packet.stop.price, 20950);
});

test('inversion stop: a 95pt leg is NOT wide enough — leg extreme kept (boundary)', () => {
  // entry 20905, leg high 21000 = 95pt exactly; the cap is strictly > 95.
  const packet = wideLegInversion({ legHigh: 21000, candleHigh: 20950, close: 20905 });
  assert.equal(packet.stop.kind, 'inversion_failed_leg_extreme');
  assert.equal(packet.stop.price, 21000);
});

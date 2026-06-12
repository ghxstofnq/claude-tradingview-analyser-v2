import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionPacketForWalker } from '../../../app/main/strategy/walkers/execution-packet.js';
import { createWalker } from '../../../app/main/strategy/walkers/walker-state.js';

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
  assert.equal(packet.evidenceAudit.stop.rule, 'mss_swing_low');
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
  const noStop = buildExecutionPacketForWalker({
    context: executableContext({ pillar3: { structuralStops: [] } }),
    walker: confirmedMssWalker(),
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

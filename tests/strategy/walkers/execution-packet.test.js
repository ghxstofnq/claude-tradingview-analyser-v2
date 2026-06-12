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

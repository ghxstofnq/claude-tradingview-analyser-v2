import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMssWalkerSpawnRequests,
  buildMssWalkerAdvanceRequests,
  runMssWalkerLifecycle,
} from '../../../app/main/strategy/walkers/mss-lifecycle.js';
import { createWalker } from '../../../app/main/strategy/walkers/walker-state.js';

function freshContext(overrides = {}) {
  return {
    market: 'MNQ1!',
    session: 'ny-am',
    eventTimeUtc: '2026-05-29T13:45:00.000Z',
    sourceHealth: { status: 'fresh', stale: false, schemaSupported: true, blockers: [] },
    pillar1: { status: 'pass', blockers: [] },
    pillar2: { status: 'pass', displacement: 'clean', blockers: [] },
    pillar3: {
      sweeps: [],
      failureSwings: [],
      pdArrays: [],
      fvgs: [],
      insidePdArrays: [],
      confirmationRows: [],
    },
    blockers: [],
    ...overrides,
  };
}

const bullishPd = {
  evidenceRef: 'gates.engine.pillar3.fvgs[0]',
  kind: 'fvg',
  direction: 'bullish',
  dir: 'bull',
  state: 'fresh',
  size_quality: 'large',
  top: 21000,
  bottom: 20980,
};

const sweep = {
  evidenceRef: 'gates.engine.pillar1.sweeps[0]',
  side: 'sell',
  rejected: true,
  swept_ms: 1780062000000,
};

const failureSwing = {
  evidenceRef: 'gates.engine.pillar3.failure_swings[0]',
  event: 'mss',
  validation: 'sweep',
  dir: 'bull',
  created_ms: 1780062180000,
};

test('buildMssWalkerSpawnRequests fails closed until sweep, displacement, and reversal PD evidence are all present', () => {
  const missingSweep = freshContext({
    pillar3: {
      failureSwings: [failureSwing],
      pdArrays: [bullishPd],
      fvgs: [bullishPd],
      insidePdArrays: [],
      confirmationRows: [],
    },
  });

  const missingFailureSwing = freshContext({
    pillar3: {
      sweeps: [sweep],
      failureSwings: [],
      pdArrays: [bullishPd],
      fvgs: [bullishPd],
      insidePdArrays: [],
      confirmationRows: [],
    },
  });

  const weakDisplacement = freshContext({
    pillar2: { status: 'pass', displacement: 'weak', blockers: [] },
    pillar3: {
      sweeps: [sweep],
      failureSwings: [failureSwing],
      pdArrays: [bullishPd],
      fvgs: [bullishPd],
      insidePdArrays: [],
      confirmationRows: [],
    },
  });

  assert.deepEqual(buildMssWalkerSpawnRequests(missingSweep), []);
  assert.deepEqual(buildMssWalkerSpawnRequests(missingFailureSwing), []);
  assert.deepEqual(buildMssWalkerSpawnRequests(weakDisplacement), []);
});

test('runMssWalkerLifecycle spawns deterministic MSS walker from rejected sweep plus MSS displacement plus same-direction PD array', () => {
  const context = freshContext({
    pillar3: {
      sweeps: [sweep],
      failureSwings: [failureSwing],
      pdArrays: [bullishPd],
      fvgs: [bullishPd],
      insidePdArrays: [],
      confirmationRows: [],
    },
  });

  const result = runMssWalkerLifecycle({ context, walkers: [] });

  assert.equal(result.walkers.length, 1);
  assert.equal(result.walkers[0].model, 'MSS');
  assert.equal(result.walkers[0].side, 'long');
  assert.equal(result.walkers[0].stage, 'pd_identified');
  assert.equal(result.walkers[0].pdArrayRef, bullishPd.evidenceRef);
  assert.equal(result.walkers[0].evidence.sweep.evidenceRef, sweep.evidenceRef);
  assert.equal(result.walkers[0].evidence.displacement.evidenceRef, failureSwing.evidenceRef);
  assert.deepEqual(result.events.map((event) => event.type), ['spawn', 'advance']);
});

test('buildMssWalkerAdvanceRequests advances to tap only when price taps the tracked PD array', () => {
  const context = freshContext({
    pillar3: { pdArrays: [bullishPd], insidePdArrays: [bullishPd], confirmationRows: [] },
  });
  const walker = createWalker({ context, model: 'MSS', side: 'long', pdArray: bullishPd });
  const pdIdentified = { ...walker, stage: 'pd_identified' };

  const requests = buildMssWalkerAdvanceRequests(context, [pdIdentified]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, pdIdentified.id);
  assert.equal(requests[0].stage, 'tap_seen');
  assert.equal(requests[0].evidenceRef, bullishPd.evidenceRef);
  assert.equal(requests[0].evidenceKey, 'tap');
});

test('buildMssWalkerAdvanceRequests requires exact confirmed entry-state fields after tap before confirming', () => {
  const tappedWalker = {
    ...createWalker({ context: freshContext(), model: 'MSS', side: 'long', pdArray: bullishPd }),
    stage: 'tap_seen',
    tapRef: bullishPd.evidenceRef,
  };

  const waitingContext = freshContext({
    pillar3: {
      confirmationRows: [{
        evidenceRef: 'gates.engine.confirmation',
        entry_state: 'waiting',
        confirm_close: 0,
        ce_held: 1,
        chop_15m: 0,
        confirm_dir: 'bull',
      }],
    },
  });

  const confirmedContext = freshContext({
    pillar3: {
      confirmationRows: [{
        evidenceRef: 'gates.engine.confirmation',
        entry_state: 'confirmed',
        confirm_close: 1,
        ce_held: 1,
        chop_15m: 0,
        confirm_dir: 'bull',
        confirm_ms: 1780062420000,
      }],
    },
  });

  assert.deepEqual(buildMssWalkerAdvanceRequests(waitingContext, [tappedWalker]), []);

  const requests = buildMssWalkerAdvanceRequests(confirmedContext, [tappedWalker]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stage, 'confirmed');
  assert.equal(requests[0].evidenceRef, 'gates.engine.confirmation');
  assert.equal(requests[0].evidenceKey, 'confirmation');
});

// ---- GXNQ ruling 2026-06-13 (June 10, 10:06 skipped MSS): "not valid MSS" —
// the grab existed (LO.H ran + rejected 09:38) but no bearish shift confirmed
// after it; the walker leaned on overnight failure-swing rows. The MSS is the
// namesake of the model: it must confirm AFTER the most recent rejected
// opposing sweep (entry-models.md MSS §2→§3 sequence).

test('MSS spawn: a shift that confirmed BEFORE the most recent rejected sweep never spawns', () => {
  const staleShift = {
    ...failureSwing,
    confirmed_ms: 1780061000000, // before the 1780062000000 sweep
    created_ms: 1780060900000,
  };
  const context = freshContext({
    pillar3: {
      sweeps: [sweep],
      failureSwings: [staleShift],
      pdArrays: [bullishPd],
      insidePdArrays: [],
      confirmationRows: [],
    },
  });
  assert.deepEqual(buildMssWalkerSpawnRequests(context), []);
});

test('MSS spawn: the anchor is the MOST RECENT rejected sweep — a shift between two sweeps does not spawn', () => {
  const newerSweep = { ...sweep, evidenceRef: 'gates.engine.pillar1.sweeps[1]', swept_ms: 1780063000000 };
  const shiftBetween = { ...failureSwing, confirmed_ms: 1780062500000, created_ms: 1780062400000 };
  const context = freshContext({
    pillar3: {
      sweeps: [sweep, newerSweep],
      failureSwings: [shiftBetween],
      pdArrays: [bullishPd],
      insidePdArrays: [],
      confirmationRows: [],
    },
  });
  assert.deepEqual(buildMssWalkerSpawnRequests(context), []);
});

test('MSS spawn: a shift confirmed AFTER the most recent rejected sweep spawns', () => {
  const freshShift = { ...failureSwing, confirmed_ms: 1780062300000 };
  const context = freshContext({
    pillar3: {
      sweeps: [sweep],
      failureSwings: [freshShift],
      pdArrays: [bullishPd],
      insidePdArrays: [],
      confirmationRows: [],
    },
  });
  const requests = buildMssWalkerSpawnRequests(context);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].side, 'long');
});

// ---- EM MSS §4 ("Retrace to Bullish FVG ... without making a new low"): the
// reversal premise dies if, while waiting to confirm, price closes back
// through the level the anchoring sweep grabbed-and-rejected.

test('MSS dead premise: a close back below the swept level kills the pre-confirmation long walker (EM MSS §4)', () => {
  const longWalker = {
    ...createWalker({ context: freshContext(), model: 'MSS', side: 'long', pdArray: bullishPd }),
    stage: 'pd_identified',
    evidence: {
      pdArray: { evidenceRef: bullishPd.evidenceRef, rawPayload: bullishPd },
      sweep: { evidenceRef: sweep.evidenceRef, rawPayload: { ...sweep, price: 20970 } },
    },
  };
  const context = freshContext({
    pillar3: {
      sweeps: [], failureSwings: [], pdArrays: [], insidePdArrays: [], confirmationRows: [],
      ohlcv1m: [{ time: 1780062600, open: 20985, high: 20990, low: 20955, close: 20960 }], // closed back below 20970
    },
  });
  const result = runMssWalkerLifecycle({ context, walkers: [longWalker] });
  const w = result.walkers.find((x) => x.id === longWalker.id);
  assert.equal(w.stage, 'blocked');
  assert.ok(w.blockers.includes('mss_premise_invalidated_new_low'));
});

test('MSS dead premise: a close holding above the swept level does NOT kill the walker', () => {
  const longWalker = {
    ...createWalker({ context: freshContext(), model: 'MSS', side: 'long', pdArray: bullishPd }),
    stage: 'pd_identified',
    evidence: {
      pdArray: { evidenceRef: bullishPd.evidenceRef, rawPayload: bullishPd },
      sweep: { evidenceRef: sweep.evidenceRef, rawPayload: { ...sweep, price: 20970 } },
    },
  };
  const context = freshContext({
    pillar3: {
      sweeps: [], failureSwings: [], pdArrays: [], insidePdArrays: [], confirmationRows: [],
      ohlcv1m: [{ time: 1780062600, open: 20985, high: 20998, low: 20978, close: 20995 }], // held above 20970
    },
  });
  const result = runMssWalkerLifecycle({ context, walkers: [longWalker] });
  const w = result.walkers.find((x) => x.id === longWalker.id);
  assert.notEqual(w.stage, 'blocked');
});

// ---- GXNQ ruling 2026-06-13 (June 11, 10:11 MSS short): "the mss needs a
// tap into an fvg after the MSS happens then confirmation close" — the
// walker's tap was real but the confirmation was ANOTHER zone's violation
// row (zone 28941.5-28950.75 confirming a walker on 28944.5-28966.75).

test('MSS confirm: a confirmation carrying ANOTHER zone\'s bounds never confirms this walker', () => {
  const tapped = {
    id: 'w1', model: 'MSS', side: 'short', stage: 'tap_seen',
    pdArrayRef: 'zone:28944.5-28966.75',
    evidence: { pdArray: { evidenceRef: 'zone:28944.5-28966.75', rawPayload: { ...bullishPd, dir: 'bear', direction: 'bearish', top: 28966.75, bottom: 28944.5 } } },
  };
  const context = freshContext({
    pillar3: {
      insidePdArrays: [],
      confirmationRows: [{
        evidenceRef: 'zone:28941.5-28950.75', entry_state: 'confirmed', confirm_close: 1,
        ce_held: 1, chop_15m: 0, confirm_dir: 'bear', close: 28893.25,
        zone_top: 28950.75, zone_bottom: 28941.5,
      }],
    },
  });
  assert.deepEqual(buildMssWalkerAdvanceRequests(context, [tapped]), []);
});

test('MSS confirm: the own-zone confirmation still confirms', () => {
  const tapped = {
    id: 'w1', model: 'MSS', side: 'short', stage: 'tap_seen',
    pdArrayRef: 'zone:28944.5-28966.75',
    evidence: { pdArray: { evidenceRef: 'zone:28944.5-28966.75', rawPayload: { ...bullishPd, dir: 'bear', direction: 'bearish', top: 28966.75, bottom: 28944.5 } } },
  };
  const context = freshContext({
    pillar3: {
      insidePdArrays: [],
      confirmationRows: [{
        evidenceRef: 'zone:28944.5-28966.75', entry_state: 'confirmed', confirm_close: 1,
        ce_held: 1, chop_15m: 0, confirm_dir: 'bear', close: 28930,
        zone_top: 28966.75, zone_bottom: 28944.5,
      }],
    },
  });
  const requests = buildMssWalkerAdvanceRequests(context, [tapped]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stage, 'confirmed');
});

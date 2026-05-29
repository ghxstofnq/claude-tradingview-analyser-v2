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

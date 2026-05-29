import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTrendWalkerSpawnRequests,
  buildTrendWalkerAdvanceRequests,
  runTrendWalkerLifecycle,
} from '../../../app/main/strategy/walkers/trend-lifecycle.js';
import {
  buildInversionWalkerSpawnRequests,
  buildInversionWalkerAdvanceRequests,
  runInversionWalkerLifecycle,
} from '../../../app/main/strategy/walkers/inversion-lifecycle.js';
import { createWalker } from '../../../app/main/strategy/walkers/walker-state.js';

function freshContext(overrides = {}) {
  return {
    market: 'MNQ1!',
    session: 'ny-am',
    eventTimeUtc: '2026-05-29T13:45:00.000Z',
    sourceHealth: { status: 'fresh', stale: false, schemaSupported: true, blockers: [] },
    pillar1: { status: 'pass', htfBias: 'bullish', blockers: [] },
    pillar2: { status: 'pass', displacement: 'clean', blockers: [] },
    pillar3: {
      pdArrays: [],
      fvgs: [],
      ifvgs: [],
      bprs: [],
      insidePdArrays: [],
      confirmationRows: [],
    },
    blockers: [],
    ...overrides,
  };
}

const bullishTrendPd = {
  evidenceRef: 'gates.engine.rows.trendBullFvg',
  kind: 'fvg',
  direction: 'bullish',
  dir: 'bull',
  state: 'fresh',
  model_hint: 'trend',
  size_quality: 'large',
  top: 21000,
  bottom: 20980,
};

const bearishOpposingFvg = {
  evidenceRef: 'gates.engine.rows.bearFvgToInvert',
  kind: 'fvg',
  direction: 'bearish',
  dir: 'bear',
  state: 'fresh',
  model_hint: 'inversion',
  size_quality: 'large',
  top: 21030,
  bottom: 21010,
};

test('Trend lifecycle spawns from same-direction continuation PD and requires later tap then confirmed entry-state', () => {
  const context = freshContext({
    pillar3: { pdArrays: [bullishTrendPd], fvgs: [bullishTrendPd], insidePdArrays: [], confirmationRows: [] },
  });

  const spawnRequests = buildTrendWalkerSpawnRequests(context);
  assert.equal(spawnRequests.length, 1);
  assert.equal(spawnRequests[0].model, 'Trend');
  assert.equal(spawnRequests[0].side, 'long');

  const spawned = runTrendWalkerLifecycle({ context, walkers: [] });
  assert.equal(spawned.walkers[0].stage, 'pd_identified');

  const tapContext = freshContext({
    pillar3: { pdArrays: [bullishTrendPd], insidePdArrays: [bullishTrendPd], confirmationRows: [] },
  });
  const tapRequests = buildTrendWalkerAdvanceRequests(tapContext, spawned.walkers);
  assert.equal(tapRequests.length, 1);
  assert.equal(tapRequests[0].stage, 'tap_seen');

  const tappedWalker = { ...spawned.walkers[0], stage: 'tap_seen', tapRef: bullishTrendPd.evidenceRef };
  const sameCandleConfirmContext = freshContext({
    pillar3: {
      confirmationRows: [{ evidenceRef: 'confirm.same', entry_state: 'confirmed', confirm_close: 1, ce_held: 1, chop_15m: 0, confirm_dir: 'bull', confirm_ms: 1780062000000, entered_ms: 1780062000000 }],
    },
  });
  assert.deepEqual(buildTrendWalkerAdvanceRequests(sameCandleConfirmContext, [tappedWalker]), []);

  const laterConfirmContext = freshContext({
    pillar3: {
      confirmationRows: [{ evidenceRef: 'confirm.later', entry_state: 'confirmed', confirm_close: 1, ce_held: 1, chop_15m: 0, confirm_dir: 'bull', confirm_ms: 1780062360000, entered_ms: 1780062000000, close: 21008 }],
    },
  });
  const confirmRequests = buildTrendWalkerAdvanceRequests(laterConfirmContext, [tappedWalker]);
  assert.equal(confirmRequests.length, 1);
  assert.equal(confirmRequests[0].stage, 'confirmed');
  assert.equal(confirmRequests[0].evidenceRef, 'confirm.later');
});

test('Inversion lifecycle spawns from opposing FVG and confirms on full close-through without separate tap', () => {
  const context = freshContext({
    pillar3: { pdArrays: [bearishOpposingFvg], fvgs: [bearishOpposingFvg], ifvgs: [], insidePdArrays: [], confirmationRows: [] },
  });

  const spawnRequests = buildInversionWalkerSpawnRequests(context);
  assert.equal(spawnRequests.length, 1);
  assert.equal(spawnRequests[0].model, 'Inversion');
  assert.equal(spawnRequests[0].side, 'long');

  const spawned = runInversionWalkerLifecycle({ context, walkers: [] });
  assert.equal(spawned.walkers[0].stage, 'pd_identified');

  const waitingWalker = createWalker({ context, model: 'Inversion', side: 'long', pdArray: bearishOpposingFvg });
  const partialCloseContext = freshContext({
    pillar3: { confirmationRows: [{ evidenceRef: 'inv.partial', entry_state: 'confirmed', confirm_close: 1, ce_held: 1, chop_15m: 0, confirm_dir: 'bull', close: 21020, confirm_ms: 1780062360000 }] },
  });
  assert.deepEqual(buildInversionWalkerAdvanceRequests(partialCloseContext, [{ ...waitingWalker, stage: 'pd_identified' }]), []);

  const fullCloseContext = freshContext({
    pillar3: { confirmationRows: [{ evidenceRef: 'inv.full', entry_state: 'confirmed', confirm_close: 1, ce_held: 1, chop_15m: 0, confirm_dir: 'bull', close: 21032, confirm_ms: 1780062420000 }] },
  });
  const confirmRequests = buildInversionWalkerAdvanceRequests(fullCloseContext, [{ ...waitingWalker, stage: 'pd_identified' }]);
  assert.equal(confirmRequests.length, 1);
  assert.equal(confirmRequests[0].stage, 'confirmed');
  assert.equal(confirmRequests[0].evidenceRef, 'inv.full');
});

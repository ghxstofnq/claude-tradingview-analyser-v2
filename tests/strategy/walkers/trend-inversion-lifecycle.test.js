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

// ---- GXNQ hand-grade rulings, June 9 (2026-06-13) --------------------------
// Trade 4/6: "not a valid inversion — the entry candle didn't invert a
// bullish fvg." Trade 5: "inversion happened at the close of candle 11:12,
// not 11:11." Trade 7: "actually an A+ confirmed Trend continuation."

test('inversion spawn: an ifvg dir is the FLIPPED direction (pine: dir flips on inversion) — the walker trades WITH it', () => {
  // ifvg dir=bull = a violated bear FVG now acting as support. June 9
  // trades 4-6 all shorted bull iFVGs — backwards.
  const bullIfvg = {
    evidenceRef: 'zone:29209.5-29211.5', kind: 'ifvg', dir: 'bull', state: 'inverted',
    size_quality: 'tiny', top: 29211.5, bottom: 29209.5, inverted_ms: 1781017380000,
  };
  const context = freshContext({
    pillar3: { pdArrays: [bullIfvg], fvgs: [], ifvgs: [bullIfvg], insidePdArrays: [], confirmationRows: [] },
  });
  const requests = buildInversionWalkerSpawnRequests(context);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].side, 'long');
});

test('inversion confirm: a confirmation carrying ANOTHER zone\'s bounds never confirms this walker', () => {
  // June 9 trade 4: the violation row for zone 29407.25-29414.75 confirmed a
  // walker holding 29209.5-29211.5 because the close sat below both.
  const walker = createWalker({
    context: freshContext(), model: 'Inversion', side: 'short',
    pdArray: { evidenceRef: 'zone:29209.5-29211.5', kind: 'fvg', dir: 'bull', state: 'fresh', top: 29211.5, bottom: 29209.5 },
  });
  const otherZoneConfirm = freshContext({
    pillar3: {
      confirmationRows: [{
        evidenceRef: 'zone:29407.25-29414.75', entry_state: 'confirmed', confirm_close: 1,
        ce_held: 1, chop_15m: 0, confirm_dir: 'bear', close: 29184,
        zone_top: 29414.75, zone_bottom: 29407.25, confirm_ms: 1781017440000,
      }],
    },
  });
  assert.deepEqual(
    buildInversionWalkerAdvanceRequests(otherZoneConfirm, [{ ...walker, stage: 'pd_identified' }]),
    [],
  );
});

test('trend confirm: a wick tap + full-body close away from the zone confirms in one bar (June 9 trade 7)', () => {
  // 11:53 candle: high 28971.75 wicks into the bear FVG 28965-29000.75 (the
  // engine's close-based entry tracker never stamps it), closes 28911.75
  // bearish with 0.68 body — entry-models.md Trend: tap then full-body
  // close away. The strategy's tap is wick-based (CLAUDE.md 2026-05-18).
  const bearTrendPd = {
    evidenceRef: 'zone:28965-29000.75', kind: 'fvg', dir: 'bear', state: 'fresh',
    size_quality: 'normal', top: 29000.75, bottom: 28965, created_ms: 1781018820000,
  };
  const walker = createWalker({ context: freshContext(), model: 'Trend', side: 'short', pdArray: bearTrendPd });
  const wickTapContext = freshContext({
    pillar3: {
      pdArrays: [bearTrendPd],
      insidePdArrays: [],
      confirmationRows: [{
        evidenceRef: 'gates.engine.confirmation',
        last_bar: {
          time: 1781020320, open: 28954.5, high: 28971.75, low: 28909, close: 28911.75,
          direction: 'bearish', body_ratio: 0.68,
        },
      }],
    },
  });
  const requests = buildTrendWalkerAdvanceRequests(wickTapContext, [{ ...walker, stage: 'pd_identified' }]);
  const confirm = requests.find((r) => r.stage === 'confirmed');
  assert.ok(confirm, `expected a confirm request, got ${JSON.stringify(requests)}`);
});

test('trend confirm: the zone-creating candle itself never self-confirms', () => {
  // At creation the displacement bar's high EQUALS the bear FVG bottom by
  // construction — that is the zone being born, not a retrace tap.
  const bearTrendPd = {
    evidenceRef: 'zone:28965-29000.75', kind: 'fvg', dir: 'bear', state: 'fresh',
    size_quality: 'normal', top: 29000.75, bottom: 28965, created_ms: 1781018820000,
  };
  const walker = createWalker({ context: freshContext(), model: 'Trend', side: 'short', pdArray: bearTrendPd });
  const creationBarContext = freshContext({
    pillar3: {
      pdArrays: [bearTrendPd],
      insidePdArrays: [],
      confirmationRows: [{
        evidenceRef: 'gates.engine.confirmation',
        last_bar: {
          time: 1781018820, open: 29010, high: 28965, low: 28930, close: 28940,
          direction: 'bearish', body_ratio: 0.8,
        },
      }],
    },
  });
  assert.deepEqual(
    buildTrendWalkerAdvanceRequests(creationBarContext, [{ ...walker, stage: 'pd_identified' }])
      .filter((r) => r.stage === 'confirmed'),
    [],
  );
});

test('trend confirm: a zone that has since inverted or invalidated never wick-confirms', () => {
  // June 9 trade 5 shadow: the 0.25-pt bear FVG 29270.75-29271 inverted at
  // 11:10 and invalidated — its walker then wick-"confirmed" at 11:11,
  // front-running the real 11:12 inversion the user graded.
  const deadPd = {
    evidenceRef: 'zone:29270.75-29271', kind: 'fvg', dir: 'bear', state: 'fresh',
    size_quality: 'tiny', top: 29271, bottom: 29270.75, created_ms: 1781016300000,
  };
  const walker = createWalker({ context: freshContext(), model: 'Trend', side: 'short', pdArray: deadPd });
  const context = freshContext({
    pillar3: {
      // the CURRENT row for those bounds is an invalidated bull ifvg
      pdArrays: [{ ...deadPd, kind: 'ifvg', dir: 'bull', state: 'invalidated', inverted_ms: 1781017800000 }],
      insidePdArrays: [],
      confirmationRows: [{
        evidenceRef: 'gates.engine.confirmation',
        last_bar: { time: 1781017860, open: 29290.75, high: 29302, low: 29255, close: 29262, direction: 'bearish', body_ratio: 0.61 },
      }],
    },
  });
  assert.deepEqual(
    buildTrendWalkerAdvanceRequests(context, [{ ...walker, stage: 'pd_identified' }])
      .filter((r) => r.stage === 'confirmed'),
    [],
  );
});

test('trend confirm: a bar that blasts THROUGH the zone is not a tap', () => {
  // A wick that crosses the entire zone and keeps going violated it — the
  // engine inverts such zones; "a quick tap" stays inside the zone.
  const bearPd = {
    evidenceRef: 'zone:29270.75-29280', kind: 'fvg', dir: 'bear', state: 'fresh',
    size_quality: 'normal', top: 29280, bottom: 29270.75, created_ms: 1781016300000,
  };
  const walker = createWalker({ context: freshContext(), model: 'Trend', side: 'short', pdArray: bearPd });
  const context = freshContext({
    pillar3: {
      pdArrays: [bearPd],
      insidePdArrays: [],
      confirmationRows: [{
        evidenceRef: 'gates.engine.confirmation',
        last_bar: { time: 1781017860, open: 29290.75, high: 29302, low: 29255, close: 29262, direction: 'bearish', body_ratio: 0.61 },
      }],
    },
  });
  assert.deepEqual(
    buildTrendWalkerAdvanceRequests(context, [{ ...walker, stage: 'pd_identified' }])
      .filter((r) => r.stage === 'confirmed'),
    [],
  );
});

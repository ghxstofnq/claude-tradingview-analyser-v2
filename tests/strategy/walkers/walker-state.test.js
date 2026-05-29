import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWalker,
  isActiveWalker,
  isTerminalStage,
  WALKER_STAGES,
} from '../../../app/main/strategy/walkers/walker-state.js';
import { spawnWalker } from '../../../app/main/strategy/walkers/walker-spawn.js';
import { advanceWalker } from '../../../app/main/strategy/walkers/walker-advance.js';
import { killWalker } from '../../../app/main/strategy/walkers/walker-kill.js';

function freshContext(overrides = {}) {
  return {
    market: 'MNQ1!',
    session: 'ny-am',
    eventTimeUtc: '2026-05-29T13:45:00.000Z',
    sourceHealth: { status: 'fresh', stale: false, schemaSupported: true, blockers: [] },
    pillar1: { status: 'pass', blockers: [] },
    pillar2: { status: 'pass', blockers: [] },
    pillar3: { pdArrays: [], fvgs: [], ifvgs: [], bprs: [], confirmationRows: [] },
    blockers: [],
    ...overrides,
  };
}

const pdArray = {
  evidenceRef: 'gates.engine.pillar3.fvgs[0]',
  kind: 'fvg',
  dir: 'bullish',
  top: 21000,
  bottom: 20980,
};

test('createWalker creates deterministic event-time state without Date.now fields', () => {
  const context = freshContext();
  const first = createWalker({ context, model: 'MSS', side: 'long', pdArray });
  const second = createWalker({ context, model: 'MSS', side: 'long', pdArray });

  assert.deepEqual(WALKER_STAGES, [
    'watching',
    'pd_identified',
    'tap_seen',
    'confirmation_pending',
    'confirmed',
    'packet_ready',
    'blocked',
    'expired',
  ]);
  assert.equal(first.id, second.id);
  assert.equal(first.market, 'MNQ1!');
  assert.equal(first.session, 'ny-am');
  assert.equal(first.model, 'MSS');
  assert.equal(first.side, 'long');
  assert.equal(first.stage, 'watching');
  assert.equal(first.createdAtUtc, context.eventTimeUtc);
  assert.equal(first.lastUpdatedAtUtc, context.eventTimeUtc);
  assert.equal(first.sourceEventTimeUtc, context.eventTimeUtc);
  assert.equal(first.pdArrayRef, pdArray.evidenceRef);
  assert.equal(first.tapRef, null);
  assert.equal(first.confirmationRef, null);
  assert.deepEqual(first.blockers, []);
  assert.equal(first.evidence.pdArray.rawPayload, pdArray);
  assert.equal(isActiveWalker(first), true);
  assert.equal(isTerminalStage(first.stage), false);
});

test('spawnWalker fails closed when source health or pillar gates are blocked', () => {
  const context = freshContext({
    sourceHealth: { status: 'blocked', stale: true, schemaSupported: true, blockers: ['stale_source'] },
    pillar1: { status: 'blocked', blockers: ['missing_htf_draw'] },
  });

  const result = spawnWalker({ context, model: 'MSS', side: 'long', pdArray, existingWalkers: [] });

  assert.equal(result.spawned, false);
  assert.equal(result.walker, null);
  assert.deepEqual(result.blockers, ['stale_source', 'missing_htf_draw']);
});

test('spawnWalker dedupes active walkers for same market session model side and PD array', () => {
  const context = freshContext();
  const existing = createWalker({ context, model: 'MSS', side: 'long', pdArray });

  const result = spawnWalker({ context, model: 'MSS', side: 'long', pdArray, existingWalkers: [existing] });

  assert.equal(result.spawned, false);
  assert.equal(result.walker, existing);
  assert.deepEqual(result.blockers, ['duplicate_active_walker']);
});

test('advanceWalker only accepts forward lifecycle transitions using event timestamps', () => {
  const context = freshContext();
  const walker = createWalker({ context, model: 'MSS', side: 'long', pdArray });

  const advanced = advanceWalker(walker, {
    eventTimeUtc: '2026-05-29T13:46:00.000Z',
    stage: 'tap_seen',
    evidenceRef: 'gates.engine.pillar3.fvgs[0].entered_ms',
    evidenceKey: 'tap',
    rawPayload: { entered_ms: 1780062360000 },
  });

  assert.equal(advanced.stage, 'tap_seen');
  assert.equal(advanced.lastUpdatedAtUtc, '2026-05-29T13:46:00.000Z');
  assert.equal(advanced.tapRef, 'gates.engine.pillar3.fvgs[0].entered_ms');
  assert.equal(advanced.evidence.tap.rawPayload.entered_ms, 1780062360000);

  const regressed = advanceWalker(advanced, {
    eventTimeUtc: '2026-05-29T13:47:00.000Z',
    stage: 'pd_identified',
    evidenceRef: 'later.but.backward',
  });
  assert.equal(regressed.stage, 'blocked');
  assert.deepEqual(regressed.blockers, ['invalid_stage_regression']);
});

test('killWalker marks active walkers terminal with evidence-backed reason', () => {
  const context = freshContext();
  const walker = createWalker({ context, model: 'Trend', side: 'short', pdArray: { ...pdArray, dir: 'bearish' } });

  const killed = killWalker(walker, {
    eventTimeUtc: '2026-05-29T13:50:00.000Z',
    stage: 'expired',
    reason: 'session_window_closed',
    evidenceRef: 'gates.session.minutes_into_phase',
  });

  assert.equal(killed.stage, 'expired');
  assert.equal(killed.lastUpdatedAtUtc, '2026-05-29T13:50:00.000Z');
  assert.equal(killed.evidence.kill.reason, 'session_window_closed');
  assert.equal(killed.evidence.kill.evidenceRef, 'gates.session.minutes_into_phase');
  assert.deepEqual(killed.blockers, ['session_window_closed']);
  assert.equal(isActiveWalker(killed), false);
  assert.equal(isTerminalStage(killed.stage), true);
});

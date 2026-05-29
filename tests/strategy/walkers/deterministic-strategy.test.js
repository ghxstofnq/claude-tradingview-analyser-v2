import assert from 'node:assert/strict';
import test from 'node:test';

import { runDeterministicWalkerStrategy } from '../../../app/main/strategy/walkers/deterministic-strategy.js';
import { createWalker } from '../../../app/main/strategy/walkers/walker-state.js';

function contextWithPacket(overrides = {}) {
  return {
    market: 'MNQ1!',
    session: 'ny-am',
    eventTimeUtc: '2026-05-29T13:45:00.000Z',
    sourceHealth: { status: 'fresh', stale: false, schemaSupported: true, blockers: [] },
    pillar1: {
      status: 'pass',
      blockers: [],
      untakenTargets: { above: [{ evidenceRef: 'target.pdh', label: 'PDH', price: 21050 }], below: [] },
    },
    pillar2: { status: 'pass', displacement: 'clean', blockers: [] },
    pillar3: {
      pdArrays: [],
      fvgs: [],
      ifvgs: [],
      bprs: [],
      insidePdArrays: [],
      confirmationRows: [],
      structuralStops: [{ evidenceRef: 'stop.mss_swing_low', kind: 'mss_swing_low', price: 20990 }],
    },
    blockers: [],
    ...overrides,
  };
}

const bullishPd = {
  evidenceRef: 'pd.large.bull',
  kind: 'fvg',
  direction: 'bullish',
  dir: 'bull',
  state: 'fresh',
  size_quality: 'large',
};

test('runDeterministicWalkerStrategy transitions executable confirmed walkers to packet_ready and exposes packet truth', () => {
  const context = contextWithPacket();
  const confirmed = {
    ...createWalker({ context, model: 'MSS', side: 'long', pdArray: bullishPd }),
    stage: 'confirmed',
    evidence: {
      pdArray: { evidenceRef: bullishPd.evidenceRef, rawPayload: bullishPd },
      confirmation: {
        evidenceRef: 'confirm.close',
        rawPayload: { close: 21000, confirm_ms: 1780062420000, entry_state: 'confirmed', confirm_close: 1, ce_held: 1, chop_15m: 0, confirm_dir: 'bull' },
      },
    },
  };

  const result = runDeterministicWalkerStrategy({ context, walkers: [confirmed] });

  assert.equal(result.walkers.length, 1);
  assert.equal(result.walkers[0].stage, 'packet_ready');
  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0].status, 'executable');
  assert.equal(result.packets[0].finalVerdict, 'manual_candidate');
  assert.equal(result.bestPacket.entry.price, 21000);
});

test('runDeterministicWalkerStrategy keeps blocked packets visible but final verdict no_trade', () => {
  const context = contextWithPacket({
    pillar1: { status: 'pass', blockers: [], untakenTargets: { above: [{ evidenceRef: 'target.too_close', label: 'near high', price: 21004 }], below: [] } },
  });
  const confirmed = {
    ...createWalker({ context, model: 'Trend', side: 'long', pdArray: bullishPd }),
    stage: 'confirmed',
    evidence: {
      pdArray: { evidenceRef: bullishPd.evidenceRef, rawPayload: bullishPd },
      confirmation: { evidenceRef: 'confirm.close', rawPayload: { close: 21000, confirm_ms: 1780062420000 } },
    },
  };

  const result = runDeterministicWalkerStrategy({ context, walkers: [confirmed] });

  assert.equal(result.walkers[0].stage, 'blocked');
  assert.equal(result.packets[0].status, 'blocked');
  assert.equal(result.packets[0].finalVerdict, 'no_trade');
  assert.ok(result.packets[0].blockers.includes('tp1_below_1_5r'));
  assert.equal(result.bestPacket, null);
});

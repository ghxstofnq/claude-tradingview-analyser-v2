import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIgnitions } from '../../app/main/walker/walker-spawn.js';

test('Inversion aggressive spawn: emits when opposing PD array present + same-dir bias', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [] },
        pillar3: {
          fvgs: [{ state: 'fresh', dir: 'down', tf: 'm5', high: 29830, low: 29826, ce: 29828, ts_ms: now - 60_000 }],
          structure_events: [], failure_swings: [],
        },
      },
      engine_by_tf: { m5: { structure_events: [] } },
      htf_bias: 'bullish',
    },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  const newWalkers = detectIgnitions(input);
  const invW = newWalkers.find((w) => w.model === 'INVERSION');
  assert.ok(invW);
  assert.equal(invW.variant, 'aggressive');
  assert.equal(invW.side, 'long');
  assert.equal(invW.stage, 'spawn');
});

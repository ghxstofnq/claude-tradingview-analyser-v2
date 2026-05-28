import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIgnitions } from '../../app/main/walker/walker-spawn.js';

test('Trend spawn: emits when BoS aligned with HTF bias + fresh same-dir FVG, no opposing MSS', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [] },
        pillar3: {
          fvgs: [{ state: 'fresh', dir: 'up', tf: 'm5', high: 29812, low: 29808, ce: 29810, ts_ms: now - 60_000 }],
          structure_events: [{ event: 'BoS', dir: 'up', displacement: true, ts_ms: now - 90_000, tier: 'internal' }],
          failure_swings: [],
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
  const trendW = newWalkers.find((w) => w.model === 'TREND');
  assert.ok(trendW, 'expected TREND walker');
  assert.equal(trendW.variant, 'standard');
  assert.equal(trendW.side, 'long');
  assert.equal(trendW.stage, 'impulse_done');
  assert.deepEqual(trendW.displacement_fvg, { high: 29812, low: 29808, ce: 29810 });
});

test('Trend spawn: skips if HTF bias not aligned', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [] },
        pillar3: {
          fvgs: [{ state: 'fresh', dir: 'up', tf: 'm5', high: 29812, low: 29808, ce: 29810, ts_ms: now - 60_000 }],
          structure_events: [{ event: 'BoS', dir: 'up', displacement: true, ts_ms: now - 90_000 }],
          failure_swings: [],
        },
      },
      engine_by_tf: { m5: { structure_events: [] } },
      htf_bias: 'bearish',
    },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  assert.equal(detectIgnitions(input).filter((w) => w.model === 'TREND').length, 0);
});

test('Trend spawn: rejects bullish_iFVG (Inversion is correct model)', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [] },
        pillar3: {
          fvgs: [{ state: 'fresh', dir: 'up', kind: 'iFVG', tf: 'm5', high: 29812, low: 29808, ce: 29810, ts_ms: now - 60_000 }],
          structure_events: [{ event: 'BoS', dir: 'up', displacement: true, ts_ms: now - 90_000 }],
          failure_swings: [],
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
  assert.equal(detectIgnitions(input).filter((w) => w.model === 'TREND').length, 0);
});

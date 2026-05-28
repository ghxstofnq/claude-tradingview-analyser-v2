import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIgnitions } from '../../app/main/walker/walker-spawn.js';

const baseInput = {
  gates: { engine: { pillar1: { sweeps: [] }, pillar3: { fvgs: [], structure_events: [], failure_swings: [] } } },
  bars: { m1: [], m5: [] },
  prev: { walkers: [] },
  calendar: { events: [] },
  memory: { walkerSkipLines: [] },
  suppression: { activeTradeSide: null },
};

test('MSS spawn: emits walker when sweep + same-direction failure_swing within 10 min', () => {
  const now = Date.now();
  const input = {
    ...baseInput,
    gates: {
      engine: {
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: {
          fvgs: [],
          structure_events: [],
          failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782.0,
                             new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }],
        },
      },
    },
  };
  const newWalkers = detectIgnitions(input);
  assert.equal(newWalkers.length, 1);
  const w = newWalkers[0];
  assert.equal(w.model, 'MSS');
  assert.equal(w.variant, 'standard');
  assert.equal(w.side, 'long');
  assert.equal(w.stage, 'displacement_done');
  assert.deepEqual(w.swept_pool, { name: 'AS.L', level: 29764.0 });
  assert.deepEqual(w.displacement_fvg, { high: 29785.5, low: 29782.0, ce: 29783.75 });
});

test('MSS spawn: skips if sweep older than 10 min', () => {
  const now = Date.now();
  const input = {
    ...baseInput,
    gates: {
      engine: {
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 11 * 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [],
                   failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782.0,
                                       new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
      },
    },
  };
  const newWalkers = detectIgnitions(input);
  assert.equal(newWalkers.length, 0);
});

test('MSS spawn: skips if a walker already exists for that pool', () => {
  const now = Date.now();
  const input = {
    ...baseInput,
    prev: { walkers: [{ id: 'w1', model: 'MSS', variant: 'standard', swept_pool: { name: 'AS.L', level: 29764.0 } }] },
    gates: {
      engine: {
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [],
                   failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782.0,
                                       new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
      },
    },
  };
  const newWalkers = detectIgnitions(input);
  assert.equal(newWalkers.length, 0);
});

test('MSS sweep_into_5m spawn: emits when sweep on 1m + displacement FVG on 5m', () => {
  const now = Date.now();
  const input = {
    gates: {
      engine: {
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [], failure_swings: [] },
      },
      engine_by_tf: { m5: { fvgs: [{ state: 'fresh', dir: 'up', tf: 'm5', high: 29785.5, low: 29782.0, ce: 29783.75, ts_ms: now - 30_000 }] } },
    },
    bars: { m1: [], m5: [] },
    prev: { walkers: [] },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    suppression: { activeTradeSide: null },
  };
  const newWalkers = detectIgnitions(input);
  const variant = newWalkers.find((w) => w.variant === 'sweep_into_5m');
  assert.ok(variant, 'expected sweep_into_5m walker');
  assert.equal(variant.model, 'MSS');
  assert.equal(variant.side, 'long');
  assert.equal(variant.stage, 'displacement_done_5m');
  assert.deepEqual(variant.displacement_fvg, { high: 29785.5, low: 29782.0, ce: 29783.75 });
});

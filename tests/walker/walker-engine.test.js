import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickWalkers } from '../../app/main/walker/walker-engine.js';

const baseInput = (overrides = {}) => ({
  prev: { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: null, last_5m_close: null } },
  gates: { engine: { meta: { schema: 2 }, pillar1: { sweeps: [] }, pillar3: { fvgs: [], structure_events: [], failure_swings: [] }, pillar2: { current_tf: { range_quality: 'good', displacement: 'clean', candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } },
  bars: { m1: [], m5: [] },
  rules: { walker_max_live: 4, walker_auto_sizing: 'on', max_risk_per_trade: 100 },
  calendar: { events: [] },
  memory: { walkerSkipLines: [] },
  history: { mss: [], trend: [], inversion: [] },
  suppression: { activeTradeSide: null },
  ...overrides,
});

test('tickWalkers: returns {next, triggers} given minimal valid input', () => {
  const result = tickWalkers({
    prev: { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: null, last_5m_close: null } },
    gates: { engine: { meta: { schema: 2 }, pillar1: { sweeps: [] }, pillar3: { fvgs: [], structure_events: [], failure_swings: [] }, pillar2: { current_tf: { range_quality: 'good', displacement: 'clean', candle: 'clean' } } } },
    bars: { m1: [], m5: [] },
    rules: { walker_max_live: 4, walker_auto_sizing: 'on', max_risk_per_trade: 100 },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    history: { mss: [], trend: [], inversion: [] },
    suppression: { activeTradeSide: null },
  });
  assert.ok(result, 'tickWalkers must return an object');
  assert.ok(Array.isArray(result.next.walkers), 'next.walkers must be an array');
  assert.ok(Array.isArray(result.triggers), 'triggers must be an array');
  assert.equal(typeof result.next.proof, 'object');
});

test('tickWalkers: is pure — same input twice yields equal output', () => {
  const input = {
    prev: { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: 1000, last_5m_close: 1000 } },
    gates: { engine: { meta: { schema: 2 }, pillar1: { sweeps: [] }, pillar3: { fvgs: [], structure_events: [], failure_swings: [] }, pillar2: { current_tf: { range_quality: 'good', displacement: 'clean', candle: 'clean' } } } },
    bars: { m1: [], m5: [] },
    rules: { walker_max_live: 4, walker_auto_sizing: 'on', max_risk_per_trade: 100 },
    calendar: { events: [] },
    memory: { walkerSkipLines: [] },
    history: { mss: [], trend: [], inversion: [] },
    suppression: { activeTradeSide: null },
  };
  const a = tickWalkers(input);
  const b = tickWalkers(input);
  assert.deepEqual(a, b, 'pure function must produce identical output for identical input');
});

test('tickWalkers: end-to-end MSS lifecycle in three ticks', () => {
  const now = Date.now();
  let state = { session: 'ny-am', walkers: [], triggers: [], proof: { last_1m_close: null, last_5m_close: null } };

  // Tick 1: sweep + failure_swing -> spawn at displacement_done
  let r = tickWalkers(baseInput({
    prev: state,
    gates: {
      engine: {
        meta: { schema: 2 },
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [],
                   failure_swings: [{ event: 'MSS', dir: 'up', displacement: true, ts_ms: now - 30_000, level: 29782,
                                       new_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75, dir: 'up' } }] },
        pillar2: { current_tf: { candle: 'clean' } },
        confirmation: { last_bar: { volume_acceptable: true } },
      },
      engine_by_tf: { m5: { structure_events: [] } },
    },
    bars: { m1: [{ low: 29784, high: 29790, close: 29787 }], m5: [] },
  }));
  assert.equal(r.next.walkers.length, 1);
  assert.equal(r.next.walkers[0].stage, 'displacement_done');
  state = r.next;

  // Tick 2: bar wicks into FVG -> retrace_pending
  r = tickWalkers(baseInput({
    prev: state,
    gates: {
      engine: {
        meta: { schema: 2 },
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [], failure_swings: [] },
        pillar2: { current_tf: { candle: 'clean' } },
        confirmation: { last_bar: { volume_acceptable: true } },
      },
      engine_by_tf: { m5: { structure_events: [] } },
    },
    bars: { m1: [{ low: 29782.5, high: 29786, close: 29784, body_ratio: 0.5 }], m5: [] },
  }));
  assert.equal(r.next.walkers[0].stage, 'retrace_pending');
  state = r.next;

  // Tick 3: clean close above CE -> confirmation -> trigger
  r = tickWalkers(baseInput({
    prev: state,
    gates: {
      engine: {
        meta: { schema: 2 },
        pillar1: { sweeps: [{ name: 'AS.L', level: 29764.0, swept_at_ms: now - 60_000, dir: 'down' }] },
        pillar3: { fvgs: [], structure_events: [], failure_swings: [] },
        pillar2: { current_tf: { candle: 'clean' } },
        confirmation: { last_bar: { volume_acceptable: true } },
      },
      engine_by_tf: { m5: { structure_events: [] } },
    },
    bars: { m1: [{ low: 29783, high: 29790, close: 29787, body_ratio: 0.72 }], m5: [] },
  }));
  assert.equal(r.triggers.filter((t) => t.outcome === 'fired').length, 1);
  const trig = r.triggers.find((t) => t.outcome === 'fired');
  assert.equal(trig.setup.model, 'MSS');
  assert.equal(trig.setup.side, 'long');
});

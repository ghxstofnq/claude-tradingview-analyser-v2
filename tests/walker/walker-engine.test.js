import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickWalkers } from '../../app/main/walker/walker-engine.js';

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

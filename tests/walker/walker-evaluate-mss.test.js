import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdvance, evaluateKill } from '../../app/main/walker/walker-evaluate.js';

const baseGates = {
  engine: {
    pillar2: { current_tf: { range_quality: 'good', displacement: 'clean', candle: 'clean', volume_acceptable: true } },
    confirmation: { last_bar: { body_ratio: 0.75, direction: 'up', close: 29787, volume_acceptable: true } },
  },
  engine_by_tf: { m5: { structure_events: [] } },
};

test('MSS advance: displacement_done -> retrace_pending when price wicks into FVG', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'displacement_done',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
  };
  const bars = { m1: [{ low: 29782.5, high: 29790, close: 29787 }] };
  const next = evaluateAdvance(walker, { ...baseGates }, bars);
  assert.equal(next.stage, 'retrace_pending');
});

test('MSS advance: retrace_pending -> confirmation on clean 1m close above CE', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
  };
  const bars = { m1: [{ low: 29783, high: 29790, close: 29787, body_ratio: 0.75 }] };
  const next = evaluateAdvance(walker, { ...baseGates }, bars);
  assert.equal(next.stage, 'confirmation');
});

test('MSS advance: confirmation -> trigger emits setup', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'confirmation',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
    swept_pool: { name: 'AS.L', level: 29764.0 },
  };
  const bars = { m1: [{ close: 29787, low: 29783 }] };
  const next = evaluateAdvance(walker, { ...baseGates }, bars);
  assert.equal(next.stage, 'trigger');
  assert.ok(next.setup);
  assert.equal(next.setup.entry, 29787);
  assert.equal(next.setup.stop, 29763.75); // 1 tick below swept_pool.level (0.25 tick)
});

test('MSS advance: confirmation BLOCKED if volume not acceptable', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
  };
  const gates = {
    ...baseGates,
    engine: {
      ...baseGates.engine,
      confirmation: { last_bar: { body_ratio: 0.75, direction: 'up', close: 29787, volume_acceptable: false } },
    },
  };
  const bars = { m1: [{ low: 29783, high: 29790, close: 29787, body_ratio: 0.75 }] };
  const next = evaluateAdvance(walker, gates, bars);
  assert.equal(next.stage, 'retrace_pending', 'should stay pending if volume not acceptable');
});

test('MSS advance: confirmation BLOCKED if 5m has opposing MSS', () => {
  const walker = {
    model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
    displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
  };
  const gates = {
    ...baseGates,
    engine_by_tf: { m5: { structure_events: [{ event: 'MSS', dir: 'down' }] } },
  };
  const bars = { m1: [{ low: 29783, high: 29790, close: 29787, body_ratio: 0.75 }] };
  assert.equal(evaluateAdvance(walker, gates, bars).stage, 'retrace_pending');
});

test('MSS kill: chop_timeout fires after 15 min without advance', () => {
  const w = { model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
              last_advanced_at: Date.now() - 16 * 60_000 };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: {} } }, engine_by_tf: { m5: { structure_events: [] } } };
  const bars = { m1: [{ low: 29783, high: 29790, close: 29787 }] };
  const k = evaluateKill(w, gates, bars);
  assert.equal(k.kill, true);
  assert.equal(k.reason, 'chop_timeout');
});

test('MSS kill: structure_break fires when new low forms below swept pool', () => {
  const w = { model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
              swept_pool: { name: 'AS.L', level: 29764.0 },
              last_advanced_at: Date.now() };
  const bars = { m1: [{ low: 29760, close: 29762, high: 29770 }] };
  const k = evaluateKill(w, {}, bars);
  assert.equal(k.kill, true);
  assert.equal(k.reason, 'structure_break');
});

test('hypothetical R: computed for retrace_pending MSS walker', () => {
  const w = { model: 'MSS', variant: 'standard', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29785.5, low: 29782.0, ce: 29783.75 },
              swept_pool: { name: 'AS.L', level: 29764.0 } };
  const bars = { m1: [{ close: 29787, low: 29783, high: 29790 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'doji_wick' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  assert.equal(next.stage, 'retrace_pending');
  assert.ok(typeof next.hypothetical_r_to_stop === 'number');
  assert.ok(typeof next.hypothetical_r_to_tp1 === 'number');
  assert.ok(next.hypothetical_r_to_stop > 0);
});

test('news pause: retrace_pending walker killed in news window', () => {
  const now = Date.now();
  const w = { model: 'MSS', stage: 'retrace_pending', last_advanced_at: now };
  const gates = { calendar: { events: [{ impact: 'high', ts: now + 10 * 60_000 }] } };
  const k = evaluateKill(w, gates, { m1: [] });
  assert.equal(k.kill, true);
  assert.equal(k.reason, 'news_window');
});

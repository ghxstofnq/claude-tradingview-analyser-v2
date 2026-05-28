import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSizeMultiplier } from '../../app/main/walker/walker-sizing.js';

test('sizing: <10 trades → 1.0x default', () => {
  const r = computeSizeMultiplier({ model: 'MSS', history: { mss: [{ outcome: 'TP1_HIT' }] }, userMax: null, autoSizing: 'on' });
  assert.equal(r.factor, 1.0);
  assert.match(r.reason, /insufficient sample/i);
});

test('sizing: 65% win rate → 1.2x', () => {
  const history = { mss: Array(20).fill(null).map((_, i) => ({ outcome: i < 13 ? 'TP1_HIT' : 'STOPPED' })) };
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'on' });
  assert.equal(r.factor, 1.2);
  assert.match(r.reason, /65%|13W.7L/);
});

test('sizing: 35% win rate → 0.5x', () => {
  const history = { mss: Array(20).fill(null).map((_, i) => ({ outcome: i < 7 ? 'TP1_HIT' : 'STOPPED' })) };
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'on' });
  assert.equal(r.factor, 0.5);
});

test('sizing: 50% win rate → 1.0x', () => {
  const history = { mss: Array(20).fill(null).map((_, i) => ({ outcome: i < 10 ? 'TP1_HIT' : 'STOPPED' })) };
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'on' });
  assert.equal(r.factor, 1.0);
});

test('sizing: autoSizing off → 1.0x regardless of win rate', () => {
  const history = { mss: Array(20).fill({ outcome: 'TP1_HIT' }) };
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'off' });
  assert.equal(r.factor, 1.0);
  assert.match(r.reason, /disabled/i);
});

test('sizing: TP1_HIT + TP2_HIT + STOPPED_AT_BE all count as wins', () => {
  const history = { mss: [
    ...Array(8).fill({ outcome: 'TP1_HIT' }),
    ...Array(4).fill({ outcome: 'TP2_HIT' }),
    ...Array(3).fill({ outcome: 'STOPPED_AT_BE' }),
    ...Array(5).fill({ outcome: 'STOPPED' }),
  ]};
  const r = computeSizeMultiplier({ model: 'MSS', history, userMax: null, autoSizing: 'on' });
  // 15 wins / 20 trades = 75% → 1.2x
  assert.equal(r.factor, 1.2);
});

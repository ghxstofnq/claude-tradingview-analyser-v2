import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../app/main/strategy/walkers/execution-packet.js';

const { classifySetupModel, mechanismOf } = __test;

// Lanto's MODEL = Reversal (turns the leg) vs Continuation (rides it); the
// lifecycle name is the MECHANISM. Leg direction from leg_high_ms vs leg_low_ms.
const ctx = (legHighMs, legLowMs) => ({ pillar2: { legHighMs, legLowMs } });

test('short on an up-leg = Reversal; short on a down-leg = Continuation', () => {
  assert.equal(classifySetupModel(ctx(200, 100), 'short'), 'Reversal');      // high most recent → up-leg
  assert.equal(classifySetupModel(ctx(100, 200), 'short'), 'Continuation');  // low most recent → down-leg
});

test('long on a down-leg = Reversal; long on an up-leg = Continuation', () => {
  assert.equal(classifySetupModel(ctx(100, 200), 'long'), 'Reversal');       // low most recent → down-leg
  assert.equal(classifySetupModel(ctx(200, 100), 'long'), 'Continuation');   // high most recent → up-leg
});

test('unreadable / equal leg stamps → null (cannot classify)', () => {
  assert.equal(classifySetupModel(ctx(NaN, 100), 'short'), null);
  assert.equal(classifySetupModel(ctx(100, 100), 'short'), null);
  assert.equal(classifySetupModel({ pillar2: {} }, 'short'), null);
});

test('mechanism: inversion lifecycle vs fvg_retrace (MSS/Trend)', () => {
  assert.equal(mechanismOf('Inversion'), 'inversion');
  assert.equal(mechanismOf('MSS'), 'fvg_retrace');
  assert.equal(mechanismOf('Trend'), 'fvg_retrace');
});

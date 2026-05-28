import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdvance } from '../../app/main/walker/walker-evaluate.js';

test('Inversion aggressive: spawn -> inversion_violation on close through opposing FVG', () => {
  const w = { model: 'INVERSION', variant: 'aggressive', side: 'long', stage: 'spawn',
              displacement_fvg: { high: 29830, low: 29826, ce: 29828 } };
  const bars = { m1: [{ close: 29832, low: 29827, high: 29833, body_ratio: 0.72 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  assert.equal(next.stage, 'inversion_violation');
});

test('Inversion aggressive: inversion_violation -> confirmation on clean close above former bearish FVG', () => {
  const w = { model: 'INVERSION', variant: 'aggressive', side: 'long', stage: 'inversion_violation',
              displacement_fvg: { high: 29830, low: 29826, ce: 29828 } };
  const bars = { m1: [{ close: 29833, low: 29830.5, high: 29834, body_ratio: 0.7 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  assert.equal(evaluateAdvance(w, gates, bars).stage, 'confirmation');
});

test('Inversion aggressive: confirmation -> trigger emits setup', () => {
  const w = { model: 'INVERSION', variant: 'aggressive', side: 'long', stage: 'confirmation',
              displacement_fvg: { high: 29830, low: 29826, ce: 29828 } };
  const bars = { m1: [{ close: 29834, low: 29830 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  assert.equal(next.stage, 'trigger');
  assert.equal(next.setup.model, 'INVERSION');
});

test('Inversion patient: inversion_violation -> retrace_pending on wick back into iFVG', () => {
  const w = { model: 'INVERSION', variant: 'patient', side: 'long', stage: 'inversion_violation',
              displacement_fvg: { high: 29830, low: 29826, ce: 29828 } };
  const bars = { m1: [{ close: 29829, low: 29827, high: 29832, body_ratio: 0.3 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  assert.equal(next.stage, 'retrace_pending');
});

test('Inversion patient: retrace_pending -> confirmation on clean close past violated FVG', () => {
  const w = { model: 'INVERSION', variant: 'patient', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29830, low: 29826, ce: 29828 } };
  const bars = { m1: [{ close: 29833, low: 29829, high: 29834, body_ratio: 0.7 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  assert.equal(evaluateAdvance(w, gates, bars).stage, 'confirmation');
});

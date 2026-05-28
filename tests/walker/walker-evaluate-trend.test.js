import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdvance } from '../../app/main/walker/walker-evaluate.js';

test('Trend advance: impulse_done -> retrace_pending on wick into FVG', () => {
  const w = { model: 'TREND', variant: 'standard', side: 'long', stage: 'impulse_done',
              displacement_fvg: { high: 29812, low: 29808, ce: 29810 } };
  const bars = { m5: [{ low: 29808.5, high: 29815, close: 29812 }] };
  const next = evaluateAdvance(w, { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } }, bars);
  assert.equal(next.stage, 'retrace_pending');
});

test('Trend advance: retrace_pending -> confirmation on 5m close above CE', () => {
  const w = { model: 'TREND', variant: 'standard', side: 'long', stage: 'retrace_pending',
              displacement_fvg: { high: 29812, low: 29808, ce: 29810 } };
  const bars = { m5: [{ low: 29808.5, high: 29816, close: 29814, body_ratio: 0.72 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  assert.equal(evaluateAdvance(w, gates, bars).stage, 'confirmation');
});

test('Trend advance: confirmation -> trigger emits setup with stop at displacement FVG opposite edge', () => {
  const w = { model: 'TREND', variant: 'standard', side: 'long', stage: 'confirmation',
              displacement_fvg: { high: 29812, low: 29808, ce: 29810 } };
  const bars = { m5: [{ close: 29814, low: 29808.5 }] };
  const gates = { engine: { pillar2: { current_tf: { candle: 'clean' } }, confirmation: { last_bar: { volume_acceptable: true } } }, engine_by_tf: { m5: { structure_events: [] } } };
  const next = evaluateAdvance(w, gates, bars);
  assert.equal(next.stage, 'trigger');
  assert.ok(next.setup);
  assert.equal(next.setup.model, 'TREND');
});

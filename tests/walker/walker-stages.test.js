import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, isTerminalStage, nextStageOf } from '../../app/main/walker/walker-stages.js';

test('STAGES: MSS standard chain', () => {
  assert.deepEqual(STAGES.MSS_standard, ['spawn', 'displacement_done', 'retrace_pending', 'confirmation', 'trigger']);
});

test('STAGES: MSS sweep_into_5m chain', () => {
  assert.deepEqual(STAGES.MSS_sweep_into_5m, ['spawn', 'displacement_done_5m', 'retrace_pending', 'confirmation', 'trigger']);
});

test('STAGES: Trend standard chain', () => {
  assert.deepEqual(STAGES.TREND_standard, ['spawn', 'impulse_done', 'retrace_pending', 'confirmation', 'trigger']);
});

test('STAGES: Inversion aggressive chain', () => {
  assert.deepEqual(STAGES.INVERSION_aggressive, ['spawn', 'inversion_violation', 'confirmation', 'trigger']);
});

test('STAGES: Inversion patient chain', () => {
  assert.deepEqual(STAGES.INVERSION_patient, ['spawn', 'inversion_violation', 'retrace_pending', 'confirmation', 'trigger']);
});

test('isTerminalStage: trigger is terminal', () => {
  assert.equal(isTerminalStage('trigger'), true);
  assert.equal(isTerminalStage('confirmation'), false);
});

test('nextStageOf: walks the MSS_standard chain', () => {
  assert.equal(nextStageOf('MSS_standard', 'spawn'), 'displacement_done');
  assert.equal(nextStageOf('MSS_standard', 'displacement_done'), 'retrace_pending');
  assert.equal(nextStageOf('MSS_standard', 'retrace_pending'), 'confirmation');
  assert.equal(nextStageOf('MSS_standard', 'confirmation'), 'trigger');
  assert.equal(nextStageOf('MSS_standard', 'trigger'), null);
});

test('nextStageOf: unknown chain returns null', () => {
  assert.equal(nextStageOf('UNKNOWN_chain', 'spawn'), null);
});

// Stage chains per entry-model variant. Pure data.
// Spec: docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md

export const STAGES = Object.freeze({
  MSS_standard:         ['spawn', 'displacement_done',    'retrace_pending', 'confirmation', 'trigger'],
  MSS_sweep_into_5m:    ['spawn', 'displacement_done_5m', 'retrace_pending', 'confirmation', 'trigger'],
  TREND_standard:       ['spawn', 'impulse_done',         'retrace_pending', 'confirmation', 'trigger'],
  INVERSION_aggressive: ['spawn', 'inversion_violation',                     'confirmation', 'trigger'],
  INVERSION_patient:    ['spawn', 'inversion_violation',  'retrace_pending', 'confirmation', 'trigger'],
});

export function isTerminalStage(stage) {
  return stage === 'trigger';
}

export function nextStageOf(chain, currentStage) {
  const seq = STAGES[chain];
  if (!seq) return null;
  const idx = seq.indexOf(currentStage);
  if (idx < 0 || idx >= seq.length - 1) return null;
  return seq[idx + 1];
}

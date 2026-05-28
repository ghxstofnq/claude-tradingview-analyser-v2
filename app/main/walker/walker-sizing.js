// Upgrade 7: position-size multiplier from rolling win rate. Pure function.
// 20-trade window per model. <10 trades = 1.0x default. <40% = 0.5x cooldown.
// 40-60% = 1.0x. >60% = 1.2x boost. Hard cap from userMax enforced downstream
// by the trade executor (not here — keep this function pure).

const MIN_SAMPLE = 10;
const HISTORY_WINDOW = 20;
const WIN_OUTCOMES = new Set(['TP1_HIT', 'TP2_HIT', 'STOPPED_AT_BE']);

export function computeSizeMultiplier({ model, history, userMax, autoSizing }) {
  if (autoSizing === 'off') {
    return { factor: 1.0, reason: 'auto-sizing disabled in USER.md' };
  }
  const key = String(model).toLowerCase();
  const trades = (history?.[key] ?? []).slice(-HISTORY_WINDOW);
  if (trades.length < MIN_SAMPLE) {
    return { factor: 1.0, reason: `insufficient sample (${trades.length}/${MIN_SAMPLE} trades)` };
  }
  const wins = trades.filter((t) => WIN_OUTCOMES.has(t.outcome)).length;
  const rate = wins / trades.length;
  const losses = trades.length - wins;
  const reason = `${model} last ${trades.length}: ${wins}W/${losses}L · ${Math.round(rate * 100)}%`;
  let factor;
  if (rate < 0.4) factor = 0.5;
  else if (rate > 0.6) factor = 1.2;
  else factor = 1.0;
  return { factor, reason };
}

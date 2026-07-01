import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStrategyContext } from '../app/main/strategy/context/build-strategy-context.js';

function bundleWithCoherence({ currentCoherence, m15Bars }) {
  return {
    market: 'MNQ1!',
    session: 'ny-am',
    gates: {
      engine: {
        meta: { schemaSupported: true, stale: false },
        rows: [{ kind: 'fvg', dir: 'bull', top: 10, bottom: 9, ce: 9.5, state: 'fresh' }],
        pillar1: { htfBias: 'bearish', htfDraw: 'AS.L', primaryDraw: 'AS.L' },
        pillar2: {
          current_tf: {
            candle: 'normal',
            displacement: 'clean',
            range_quality: 'good',
            coherence: currentCoherence,
          },
        },
      },
    },
    bars_by_tf: {
      m15: { last_5_bars: m15Bars },
    },
  };
}

test('strategy context uses captured M15 coherence over noisy current-TF coherence', () => {
  // 2026-06-09 10:27 ET shape: the 1m/current-TF row is noisy/choppy (0.15),
  // but the Stage-G chop signal is M15 directional efficiency. These M15 closes
  // compute to 0.81 and should allow the approved Option-A inversion reversal.
  const context = buildStrategyContext(bundleWithCoherence({
    currentCoherence: 0.15,
    m15Bars: [
      { close: 30030.5 },
      { close: 30059.5 },
      { close: 29964.75 },
      { close: 29784.25 },
    ],
  }));

  assert.equal(context.pillar2.coherence, 0.81);
});

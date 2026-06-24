import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategyContext } from '../app/main/strategy/context/build-strategy-context.js';

// Stage-G 2-S1: the inversion reversal-established gate + the coherence no-trade
// veto read leg extremes + coherence off context.pillar2. The parser already
// extracts them from the engine quality row (ict-engine-parser.js); this guards
// that buildPillar2 threads them through (and null-safes a row that omits them).

function ctxWithQuality(quality) {
  return buildStrategyContext({
    market: 'MNQ',
    session: 'ny-am',
    gates: { engine: { pillar2: { current_tf: { candle: 'clean', displacement: 'clean', ...quality } } } },
  });
}

test('threads leg_high/leg_low/coherence/range_vs_normal from the quality row', () => {
  const p2 = ctxWithQuality({
    leg_high: 30139.75, leg_low: 29376.5, leg_high_ms: 1781013000000, leg_low_ms: 1781016000000,
    coherence: 0.8, range_vs_normal: 1.2, atr_14: 13.25,
  }).pillar2;
  assert.equal(p2.legHigh, 30139.75);
  assert.equal(p2.legLow, 29376.5);
  assert.equal(p2.legHighMs, 1781013000000);
  assert.equal(p2.legLowMs, 1781016000000);
  assert.equal(p2.coherence, 0.8);
  assert.equal(p2.rangeVsNormal, 1.2);
});

test('null-safes a quality row that omits the leg/coherence fields', () => {
  const p2 = ctxWithQuality({ atr_14: 19 }).pillar2;
  assert.equal(p2.legHigh, null);
  assert.equal(p2.legLow, null);
  assert.equal(p2.coherence, null);
  assert.equal(p2.rangeVsNormal, null);
});

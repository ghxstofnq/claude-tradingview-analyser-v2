import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSetupAgainstCandidate } from '../app/main/tools/surface.js';

function validCandidate() {
  return {
    best_candidate: {
      model: 'MSS', side: 'long',
      entry: { value: 29998.5, cite: 'engine_by_tf.m5.fvgs[3].top' },
      stop: { value: 29981.25, cite: 'bars_by_tf.m5.last_5_bars[0].low', kind: 'fvg_candle1_low' },
      stop_options: [
        { kind: 'fvg_candle1_low', value: 29981.25, cite: 'bars_by_tf.m5.last_5_bars[0].low', rationale: 'x' },
        { kind: 'swing_pivot', value: 29982.25, cite: 'engine.swings.internal[7]', rationale: 'y' },
      ],
      tp1: { value: 30015, cite: 'pillar1.mnq.overnight.untaken_above[0]' },
      tp2: { value: 30119, cite: 'pillar1.mnq.overnight.untaken_above[1]' },
      grade_proposed: 'A+',
      grade_capped: 'B',
    },
  };
}

function validBundle() {
  return {
    engine_by_tf: { m5: { fvgs: [{}, {}, {}, { top: 29998.5 }] } },
    bars_by_tf: { m5: { last_5_bars: [{ low: 29981.25 }] } },
    pillar1: { mnq: { overnight: { untaken_above: [{ price: 30015 }, { price: 30119 }] } } },
    gates: { engine: { pillar1: { session_levels: { AS_H: { price: 29990, swept: true, valid_as_target: false } } } } },
  };
}

test('validator: valid payload passes', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.doesNotThrow(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()));
});

test('validator: throws when entry_cite does not resolve', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[99].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /does not resolve/);
});

test('validator: throws when tp1_cite points at swept level', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 29990, tp1_cite: 'gates.engine.pillar1.session_levels.AS_H', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /swept|valid_as_target/i);
});

test('validator: throws when stop value not in stop_options', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29970, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /stop_options/);
});

test('validator: throws when grade exceeds grade_capped', () => {
  const payload = { model: 'MSS', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'A+' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /grade.*exceeds/);
});

test('validator: throws when model/side mismatch with detector', () => {
  const payload = { model: 'Trend', side: 'long', entry: 29998.5, entry_cite: 'engine_by_tf.m5.fvgs[3].top', stop: 29981.25, stop_cite: 'bars_by_tf.m5.last_5_bars[0].low', tp1: 30015, tp1_cite: 'pillar1.mnq.overnight.untaken_above[0]', tp2: 30119, tp2_cite: 'pillar1.mnq.overnight.untaken_above[1]', grade: 'B' };
  assert.throws(() => validateSetupAgainstCandidate(payload, validCandidate(), validBundle()), /model\/side.*does not match/);
});

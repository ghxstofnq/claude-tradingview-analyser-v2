import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTfTrack, mergeFiveMinuteTrack, attachHtfSnapshot } from '../cli/lib/tape-recorder.js';

// Stage-G multi-TF recorder: m5 + m15 + HTF snapshot must COEXIST in
// engine_by_tf (the old mergeFiveMinuteTrack overwrote it). These guard the
// additive merge the faithful gates depend on.

const entry = (ts) => ({ event: { ts, tf: '1m' }, inputs: { bundle: { engine: { e: '1m' } } } });
const tfEntry = (ts, tag) => ({ event: { ts, tf: 'Xm' }, inputs: { bundle: { engine: { e: tag }, bars: { last_5_bars: [tag] } } } });

test('mergeTfTrack is additive — m5 and m15 coexist', () => {
  const ones = [entry('2026-06-09T14:00:00.000Z')];
  const fives = [tfEntry('2026-06-09T13:55:00.000Z', 'm5v')];
  const fifteens = [tfEntry('2026-06-09T13:45:00.000Z', 'm15v')];
  let out = mergeTfTrack(ones, fives, 'm5');
  out = mergeTfTrack(out, fifteens, 'm15');
  const ebt = out[0].inputs.bundle.engine_by_tf;
  assert.equal(ebt.m5.e, 'm5v');
  assert.equal(ebt.m15.e, 'm15v');
  assert.equal(out[0].inputs.bundle.bars_by_tf.m5.last_5_bars[0], 'm5v');
  assert.equal(out[0].inputs.bundle.bars_by_tf.m15.last_5_bars[0], 'm15v');
});

test('mergeFiveMinuteTrack still works (back-compat wrapper)', () => {
  const out = mergeFiveMinuteTrack([entry('2026-06-09T14:00:00.000Z')], [tfEntry('2026-06-09T13:55:00.000Z', 'm5v')]);
  assert.equal(out[0].inputs.bundle.engine_by_tf.m5.e, 'm5v');
});

test('attachHtfSnapshot adds h4/h1/daily and drops nulls, preserving m5/m15', () => {
  let out = mergeTfTrack([entry('2026-06-09T14:00:00.000Z')], [tfEntry('2026-06-09T13:55:00.000Z', 'm5v')], 'm5');
  out = attachHtfSnapshot(out, { h4: { e: 'h4v' }, h1: { e: 'h1v' }, daily: null });
  const ebt = out[0].inputs.bundle.engine_by_tf;
  assert.equal(ebt.m5.e, 'm5v');
  assert.equal(ebt.h4.e, 'h4v');
  assert.equal(ebt.h1.e, 'h1v');
  assert.equal('daily' in ebt, false);
});

test('attachHtfSnapshot with no present TFs is a no-op', () => {
  const ones = [entry('2026-06-09T14:00:00.000Z')];
  assert.deepEqual(attachHtfSnapshot(ones, { h4: null }), ones);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowVerdict, pillar2Verdict } from '../cli/lib/pillar2-verdict.js';

// Convenience builders for schema-4 quality rows.
const clean = { range_quality: 'good', displacement: 'clean', candle: 'engulfing', regime: 'displacement' };
const tight = { range_quality: 'tight', displacement: 'weak', candle: 'doji_wick', regime: 'consolidation' };
const choppy = { range_quality: 'good', displacement: 'weak', candle: 'doji_wick', regime: 'consolidation' };
const dojiTrend = { range_quality: 'good', displacement: 'clean', candle: 'doji_wick', regime: 'displacement' };
const na = { range_quality: 'na', displacement: 'na', candle: 'normal', regime: 'consolidation' };

// ── rowVerdict ──────────────────────────────────────────────────────────
test('clean displacement-regime, non-doji → good', () => {
  assert.equal(rowVerdict(clean), 'good');
});

test('REGRESSION: range_quality "tight" → poor (old regex missed this)', () => {
  // The verbatim "28pt/3h = stand aside" test (PRICE 30:12). The old verdict
  // matched /poor|chop|doji/ which never appears in the schema-4 range enum.
  assert.equal(rowVerdict({ ...clean, range_quality: 'tight' }), 'poor');
});

test('REGRESSION: consolidation + weak displacement → poor (oracle 06-17)', () => {
  // Range normal but two-sided / no displacement — "stand aside on price
  // quality". "weak" never matched the old regex either.
  assert.equal(rowVerdict(choppy), 'poor');
});

test('consolidation + doji delivery → poor', () => {
  assert.equal(rowVerdict({ range_quality: 'good', displacement: 'acceptable', candle: 'doji_wick', regime: 'consolidation' }), 'poor');
});

test('displacement-regime undercut by a doji candle → marginal', () => {
  assert.equal(rowVerdict(dojiTrend), 'marginal');
});

test('na/na row → null (not enough bars)', () => {
  assert.equal(rowVerdict(na), null);
  assert.equal(rowVerdict(null), null);
});

// ── pillar2Verdict (session aggregation) ────────────────────────────────
test('06-16 shape: both LTF clean → good / pass', () => {
  assert.deepEqual(pillar2Verdict({ m5: clean, m15: clean }), { verdict: 'good', status: 'pass' });
});

test('06-17 shape: both LTF choppy → poor / fail (master-gate stand-aside)', () => {
  assert.deepEqual(pillar2Verdict({ m5: choppy, m15: choppy }), { verdict: 'poor', status: 'fail' });
});

test('tight 3h range on one LTF vetoes alone (5m tight, 15m clean → poor)', () => {
  // The macro stand-aside: a tight 3h range is a dead environment regardless of
  // a single clean bar on the other TF (28pt/3h, PRICE 30:12).
  assert.deepEqual(pillar2Verdict({ m5: tight, m15: clean }), { verdict: 'poor', status: 'fail' });
});

test('06-18 shape: mixed soft-poor + clean LTF → marginal, NOT a veto', () => {
  // One TF choppy (weak disp, range normal — not tight), the other displacing
  // cleanly = "some displacement but sloppy" → tradeable B, downsized.
  assert.deepEqual(pillar2Verdict({ m5: choppy, m15: clean }), { verdict: 'marginal', status: 'weak' });
});

test('one marginal + one good → marginal / weak', () => {
  assert.deepEqual(pillar2Verdict({ m5: dojiTrend, m15: clean }), { verdict: 'marginal', status: 'weak' });
});

test('falls back to current_tf when both LTF rows are absent', () => {
  assert.deepEqual(pillar2Verdict({ current_tf: clean }), { verdict: 'good', status: 'pass' });
});

test('no quality data at all → conservative poor', () => {
  assert.deepEqual(pillar2Verdict({}), { verdict: 'poor', status: 'fail' });
  assert.deepEqual(pillar2Verdict({ m5: na, m15: na, current_tf: na }), { verdict: 'poor', status: 'fail' });
});

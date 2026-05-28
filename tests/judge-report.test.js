import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally, agreementPct, replayAccuracyReport } from '../scripts/judge-report.js';

test('tally counts verdicts per dimension', () => {
  const results = [
    { dimensions: { grade: 'agree', htf_bias: 'agree' } },
    { dimensions: { grade: 'disagree', htf_bias: 'partial' } },
  ];
  const t = tally(results);
  assert.deepEqual(t.grade, { agree: 1, partial: 0, disagree: 1 });
  assert.deepEqual(t.htf_bias, { agree: 1, partial: 1, disagree: 0 });
});

test('agreementPct scores partial as half credit', () => {
  assert.equal(agreementPct({ agree: 1, partial: 0, disagree: 1 }), 50);
  assert.equal(agreementPct({ agree: 1, partial: 1, disagree: 0 }), 75);
  assert.equal(agreementPct({ agree: 0, partial: 0, disagree: 0 }), null);
});

test('replayAccuracyReport counts false candidates, missed valid setups, wrong side/model, and correct no-trades', () => {
  const report = replayAccuracyReport([
    { fixture: 'ok-valid', expected: { outcome: 'trade', model: 'MSS', side: 'long' }, actual: { outcome: 'trade', model: 'MSS', side: 'long' } },
    { fixture: 'ok-no-trade', expected: { outcome: 'no_trade' }, actual: { outcome: 'no_trade', blockers: [{ reason: 'waiting' }] } },
    { fixture: 'false-candidate', expected: { outcome: 'no_trade' }, actual: { outcome: 'trade', model: 'Trend', side: 'long' } },
    { fixture: 'missed-valid', expected: { outcome: 'trade', model: 'Inversion', side: 'short' }, actual: { outcome: 'no_trade' } },
    { fixture: 'wrong-model', expected: { outcome: 'trade', model: 'MSS', side: 'long' }, actual: { outcome: 'trade', model: 'Trend', side: 'long' } },
    { fixture: 'wrong-side', expected: { outcome: 'trade', model: 'MSS', side: 'long' }, actual: { outcome: 'trade', model: 'MSS', side: 'short' } },
  ]);

  assert.equal(report.total, 6);
  assert.equal(report.correct_trades, 1);
  assert.equal(report.correct_no_trades, 1);
  assert.equal(report.false_candidates, 1);
  assert.equal(report.missed_valid_setups, 1);
  assert.equal(report.wrong_model, 1);
  assert.equal(report.wrong_side, 1);
  assert.equal(report.mismatches.length, 4);
  assert.deepEqual(report.mismatches.map((m) => m.fixture), ['false-candidate', 'missed-valid', 'wrong-model', 'wrong-side']);
});

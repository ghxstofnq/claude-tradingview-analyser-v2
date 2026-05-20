import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally, agreementPct } from '../scripts/judge-report.js';

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

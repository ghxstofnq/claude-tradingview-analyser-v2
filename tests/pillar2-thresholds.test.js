import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol, pillar2Thresholds } from '../cli/lib/pillar2-thresholds.js';

test('normalizeSymbol strips the exchange prefix and upper-cases', () => {
  assert.equal(normalizeSymbol('CME_MINI:MNQ1!'), 'MNQ1!');
  assert.equal(normalizeSymbol('mnq1!'), 'MNQ1!');
  assert.equal(normalizeSymbol('  CME_MINI:MES1!  '), 'MES1!');
  assert.equal(normalizeSymbol(''), '');
  assert.equal(normalizeSymbol(null), '');
});

test('pillar2Thresholds returns the calibrated MNQ minimum', () => {
  assert.equal(pillar2Thresholds('CME_MINI:MNQ1!').range_acceptable_min, 40);
});

test('pillar2Thresholds returns null for an uncalibrated symbol', () => {
  assert.equal(pillar2Thresholds('CME_MINI:MES1!').range_acceptable_min, null);
});

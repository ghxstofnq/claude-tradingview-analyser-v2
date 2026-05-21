import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastBarFacts } from '../cli/lib/last-bar.js';

test('lastBarFacts returns nulls for an empty or missing array', () => {
  assert.deepEqual(lastBarFacts([], 100), { bar: null, age_seconds: null });
  assert.deepEqual(lastBarFacts(undefined, 100), { bar: null, age_seconds: null });
});

test('lastBarFacts classifies a strong bullish bar', () => {
  const { bar, age_seconds } = lastBarFacts(
    [{ time: 1, open: 0, high: 0, low: 0, close: 0 },
     { time: 1000, open: 100, high: 112, low: 99, close: 111 }],
    1060,
  );
  assert.equal(bar.direction, 'bullish');
  assert.equal(bar.body_ratio, 0.85); // |111-100| / (112-99) = 11/13 = 0.846 -> 0.85
  assert.equal(bar.range, 13);
  assert.equal(bar.close_position_in_range, 0.92); // (111-99)/13
  assert.equal(age_seconds, 60);
});

test('lastBarFacts flags a doji by tiny body ratio', () => {
  const { bar } = lastBarFacts([{ time: 5, open: 100, high: 110, low: 90, close: 100.5 }], 5);
  assert.equal(bar.direction, 'doji'); // body 0.5 / range 20 = 0.025 < 0.1
  assert.equal(bar.body_ratio, 0.03);
});

test('lastBarFacts age_seconds is null without a quote time', () => {
  const { age_seconds } = lastBarFacts([{ time: 5, open: 1, high: 2, low: 0, close: 1.5 }]);
  assert.equal(age_seconds, null);
});

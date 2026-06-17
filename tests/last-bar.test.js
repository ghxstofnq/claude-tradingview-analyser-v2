import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastBarFacts, dropFormingBar } from '../cli/lib/last-bar.js';

const CLOSED = { time: 1000, open: 100, high: 110, low: 95, close: 108 };
const FORMING = { time: 1060, open: 108, high: 108, low: 108, close: 108 }; // O=H=L=C, just opened

test('dropFormingBar removes the still-forming last candle', () => {
  // quote 15s into the 60s forming bar -> period not elapsed -> drop it
  const out = dropFormingBar([CLOSED, FORMING], 1075);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], CLOSED);
});

test('dropFormingBar keeps a fully-closed last bar', () => {
  // quote 65s past the last bar -> its period elapsed -> not forming -> keep
  const out = dropFormingBar([CLOSED, FORMING], 1125);
  assert.equal(out.length, 2);
});

test('dropFormingBar keeps the array when timing cannot be verified', () => {
  assert.deepEqual(dropFormingBar([CLOSED, FORMING], undefined), [CLOSED, FORMING]);
  assert.deepEqual(dropFormingBar([CLOSED], 1075), [CLOSED]); // <2 bars
  assert.deepEqual(dropFormingBar(undefined, 1075), []);
});

test('dropFormingBar fix: lastBarFacts then reads the real closed candle, not a doji', () => {
  const dropped = dropFormingBar([CLOSED, FORMING], 1075);
  const { bar } = lastBarFacts(dropped, 1075);
  assert.equal(bar.direction, 'bullish');   // the real closed candle, not the flat forming doji
  assert.ok(bar.range > 0);
});

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

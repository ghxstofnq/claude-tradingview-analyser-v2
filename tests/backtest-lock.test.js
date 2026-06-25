// Unit tests for the live/backtest chart-coordination lock.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isBacktestActive, acquireChartForBacktest, releaseChartAfterBacktest, _resetBacktestLock,
} from "../app/main/backtest-lock.js";

test("acquire holds the chart; release is debounced", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  _resetBacktestLock();
  assert.equal(isBacktestActive(), false);
  acquireChartForBacktest();
  assert.equal(isBacktestActive(), true);
  releaseChartAfterBacktest({ debounceMs: 1000 });
  assert.equal(isBacktestActive(), true);   // still held through the debounce
  t.mock.timers.tick(1000);
  assert.equal(isBacktestActive(), false);  // released after it fires
  _resetBacktestLock();
  t.mock.timers.reset();
});

test("a study's next job cancels the pending release — the lock holds across jobs", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  _resetBacktestLock();
  acquireChartForBacktest();
  releaseChartAfterBacktest({ debounceMs: 1000 });
  acquireChartForBacktest();                 // next job starts before the debounce fires
  t.mock.timers.tick(1000);
  assert.equal(isBacktestActive(), true);    // never released — held across the study
  _resetBacktestLock();
  t.mock.timers.reset();
});

test("onRelease fires once the lock finally clears (resume hook)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  _resetBacktestLock();
  let resumed = 0;
  acquireChartForBacktest();
  releaseChartAfterBacktest({ debounceMs: 500, onRelease: () => { resumed++; } });
  assert.equal(resumed, 0);
  t.mock.timers.tick(500);
  assert.equal(resumed, 1);
  assert.equal(isBacktestActive(), false);
  _resetBacktestLock();
  t.mock.timers.reset();
});

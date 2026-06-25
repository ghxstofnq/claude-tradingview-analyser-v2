// app/main/backtest-lock.js
// Coordinates the live loop with backtests. Both drive the single TV chart
// (CDP 9225), so a running backtest takes priority: the live detector is
// paused and the session supervisor stands down (it reads isBacktestActive)
// for the duration, then live re-arms automatically once the lock clears.
//
// A multi-job study runs as a sequence of backtest:start calls with short gaps
// between jobs, so release is debounced — the lock is held across the whole
// study instead of thrashing live (pause/re-arm) in every gap.

let active = false;
let releaseTimer = null;

export function isBacktestActive() {
  return active;
}

// A backtest job is starting — hold the chart. Cancels any pending release so
// the next job in a study keeps the lock.
export function acquireChartForBacktest() {
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
  active = true;
}

// A backtest job finished — release after a debounce. If another job starts
// within the window (the next study job), acquire cancels this and the lock
// holds. onRelease fires once the lock actually clears, so the caller can nudge
// the supervisor to re-arm immediately instead of waiting for its next tick.
export function releaseChartAfterBacktest({ debounceMs = 12000, onRelease } = {}) {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    active = false;
    releaseTimer = null;
    try { onRelease?.(); } catch { /* best-effort */ }
  }, debounceMs);
}

// Test / shutdown helper — clear immediately.
export function _resetBacktestLock() {
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
  active = false;
}

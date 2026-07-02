// cli/lib/scan-freshness.js
// Absolute wall-clock freshness gate for the LIVE walker fold (audit C1).
// compute-engine-gates' `stale` measures engine RENDER-LAG at capture time, not
// how old the on-disk bundle is NOW. When the fast scan throws (CDP hiccup / TV
// busy), the previous bundle stays on disk reporting itself fresh and can be
// folded into an execution packet at stale prices. This gate blocks that.
//
// LIVE ONLY: the caller must pass replay=true (or simply not call this) for
// replay/backtest/tape folds — their bundle.timestamp is a historical replay
// time, so a wall-clock comparison would false-fire. The production caller
// (runDeterministicPacketTruthForBar) only runs on the live, non-replay path.

export const SCAN_STALE_THRESHOLD_MS = 120_000; // one 1m close + generous render/settle grace

// Returns "scan_stale" when the bundle is too old to trade on, else null.
export function scanStaleBlocker({ bundleTimestamp, nowMs = Date.now(), replay = false, thresholdMs = SCAN_STALE_THRESHOLD_MS } = {}) {
  if (replay) return null; // replay/backtest use bar-clock, not wall-clock
  const t = typeof bundleTimestamp === "number" ? bundleTimestamp : Date.parse(bundleTimestamp);
  if (!Number.isFinite(t)) return null; // no parseable timestamp — don't invent staleness (other gates cover missing data)
  return nowMs - t > thresholdMs ? "scan_stale" : null;
}

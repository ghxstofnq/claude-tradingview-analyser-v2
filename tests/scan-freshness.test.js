// Regression for audit C1: a stale on-disk scan bundle must not be folded into
// a live packet. The gate is LIVE-only — replay/backtest use bar-clock.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanStaleBlocker, SCAN_STALE_THRESHOLD_MS } from "../cli/lib/scan-freshness.js";

const now = 1_800_000_000_000;
const iso = (ms) => new Date(ms).toISOString();

describe("scanStaleBlocker (C1)", () => {
  it("fresh bundle → no block", () => {
    assert.equal(scanStaleBlocker({ bundleTimestamp: iso(now - 5_000), nowMs: now }), null);
  });
  it("bundle older than the threshold → scan_stale", () => {
    assert.equal(scanStaleBlocker({ bundleTimestamp: iso(now - (SCAN_STALE_THRESHOLD_MS + 1_000)), nowMs: now }), "scan_stale");
  });
  it("replay is exempt (bar-clock, not wall-clock)", () => {
    assert.equal(scanStaleBlocker({ bundleTimestamp: iso(now - 3_600_000), nowMs: now, replay: true }), null);
  });
  it("unparseable timestamp → no invented staleness (other gates cover missing data)", () => {
    assert.equal(scanStaleBlocker({ bundleTimestamp: "not-a-date", nowMs: now }), null);
    assert.equal(scanStaleBlocker({ bundleTimestamp: undefined, nowMs: now }), null);
  });
  it("accepts a numeric epoch timestamp too", () => {
    assert.equal(scanStaleBlocker({ bundleTimestamp: now - 1_000, nowMs: now }), null);
    assert.equal(scanStaleBlocker({ bundleTimestamp: now - (SCAN_STALE_THRESHOLD_MS + 1), nowMs: now }), "scan_stale");
  });
});

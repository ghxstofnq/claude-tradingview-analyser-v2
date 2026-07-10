// Contract tests for the Task C5 page-containment layer. Renderer components
// can't render under node --test (no DOM / JSX loader), so the boundary
// contract is proven through its pure decision helpers + the exported stale
// helpers used by the hooks.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RETRIES,
  BOUNDARY_ACTIONS,
  boundaryActions,
  isEmergency,
  shouldReset,
  retriesExhausted,
} from "../app/renderer/src/ErrorBoundary.helpers.js";
import { deriveHealthStale } from "../app/renderer/src/hooks/useHealth.js";
import { deriveExecStale } from "../app/renderer/src/hooks/useExecutionState.js";

describe("boundary variant actions", () => {
  it("a page boundary offers RETRY only", () => {
    assert.deepEqual(boundaryActions("page"), ["retry"]);
  });
  it("an emergency (money-path) boundary offers RETRY + OPEN SYSTEM + FLATTEN", () => {
    assert.deepEqual(boundaryActions("emergency"), ["retry", "open_system", "flatten"]);
  });
  it("a crashed money-path page keeps a FLATTEN affordance (TopBar/flatten stay reachable)", () => {
    // The live/orders page uses the emergency variant → its fallback still
    // offers flatten; the sibling TopBar boundary is a separate 'page' boundary
    // that isn't affected by the page crash.
    assert.ok(boundaryActions("emergency").includes("flatten"));
    assert.ok(!boundaryActions("page").includes("flatten"));
  });
  it("unknown variant falls back to the page action set", () => {
    assert.deepEqual(boundaryActions("nonsense"), BOUNDARY_ACTIONS.page);
    assert.deepEqual(boundaryActions(undefined), BOUNDARY_ACTIONS.page);
  });
  it("isEmergency is true only for the emergency variant", () => {
    assert.equal(isEmergency("emergency"), true);
    assert.equal(isEmergency("page"), false);
  });
  it("action sets are frozen", () => {
    assert.throws(() => { BOUNDARY_ACTIONS.emergency.push("nuke"); });
  });
});

describe("per-page reset on switch", () => {
  it("resets when the resetKey changes", () => {
    assert.equal(shouldReset("live", "review"), true);
  });
  it("does not reset when the key is unchanged", () => {
    assert.equal(shouldReset("live", "live"), false);
  });
});

describe("retry exhaustion", () => {
  it("exhausts at MAX_RETRIES", () => {
    assert.equal(retriesExhausted(MAX_RETRIES - 1), false);
    assert.equal(retriesExhausted(MAX_RETRIES), true);
    assert.equal(retriesExhausted(MAX_RETRIES + 1), true);
  });
});

describe("deriveHealthStale (useHealth stale flag)", () => {
  const now = 1_000_000_000_000;
  it("no health at all → stale", () => {
    assert.equal(deriveHealthStale(null, now), true);
    assert.equal(deriveHealthStale(undefined, now), true);
  });
  it("loop stale/down → stale regardless of recv age", () => {
    assert.equal(deriveHealthStale({ loop: "stale", _recv_at: now }, now), true);
    assert.equal(deriveHealthStale({ loop: "down", _recv_at: now }, now), true);
  });
  it("healthy + fresh recv → not stale", () => {
    assert.equal(deriveHealthStale({ loop: "healthy", _recv_at: now - 3000 }, now), false);
  });
  it("healthy but bridge quiet (>12s) → stale", () => {
    assert.equal(deriveHealthStale({ loop: "healthy", _recv_at: now - 15000 }, now), true);
  });
  it("no _recv_at yet → stale (fail-closed)", () => {
    assert.equal(deriveHealthStale({ loop: "healthy" }, now), true);
  });
});

describe("deriveExecStale (useExecutionState stale flag)", () => {
  const now = 1_000_000_000_000;
  it("no successful read yet → stale (fail-closed)", () => {
    assert.equal(deriveExecStale(null, now), true);
  });
  it("fresh read → not stale", () => {
    assert.equal(deriveExecStale(now - 2000, now), false);
  });
  it("read older than the window → stale", () => {
    assert.equal(deriveExecStale(now - 8000, now), true);
  });
});

// Deterministic, bounded serialization for the anomaly explainer (Track 2 §2b
// item 5). serializeExplainContext turns {event, readiness, health} into the ONE
// user-message string the explain turn reads. It must be pure (same input →
// identical output) and bounded (a huge health/error payload can never blow the
// turn context).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { serializeExplainContext, boundedText } from "../app/main/explain-context.js";

const SAMPLE = {
  event: { kind: "app_error", source: "ipc:execution", message: "broker read timed out", level: "error" },
  readiness: {
    summary: { mode: "locked" },
    rows: [
      { id: "detector", label: "Detector bar-data", status: "fail", reason: "bar-close heartbeat stale", action: "restart_detector" },
      { id: "broker_reconciliation", label: "Broker reconciliation", status: "fail", reason: "broker/journal mismatch", action: "retry_reconcile" },
      { id: "tests", label: "Tests / build", status: "pass", reason: "suite green" },
    ],
  },
  health: {
    loop: "down", cdp: "up", heartbeat_age_s: 140, turn_lag_s: 5,
    reconciliation: { healthy: false, state: "ORPHAN_POSITION" },
    protection: { healthy: false, state: "CRITICAL_NO_STOP", blocked: true, blocker: "no_protective_stop" },
  },
};

describe("serializeExplainContext — deterministic", () => {
  it("returns byte-identical output for identical input", () => {
    const a = serializeExplainContext(SAMPLE);
    const b = serializeExplainContext(JSON.parse(JSON.stringify(SAMPLE)));
    assert.equal(a, b, "same input must serialize identically (no clock, no randomness)");
  });

  it("includes the event, the non-pass readiness rows, and the whitelisted health fields", () => {
    const out = serializeExplainContext(SAMPLE);
    assert.match(out, /broker read timed out/, "carries the event message");
    assert.match(out, /ipc:execution/, "carries the event source");
    assert.match(out, /bar-close heartbeat stale/, "carries a red readiness reason");
    assert.match(out, /restart_detector/, "carries the readiness action token");
    assert.match(out, /loop: down/, "carries the health loop");
    assert.match(out, /protection:.*CRITICAL_NO_STOP/, "carries protection state");
    assert.match(out, /gates green/, "summarizes the green gate count");
  });

  it("excludes green readiness rows from the blocker list", () => {
    const out = serializeExplainContext(SAMPLE);
    // 'tests' is a pass row — its reason must not appear as a blocker line.
    assert.doesNotMatch(out, /suite green/, "green rows are not blockers and must not be listed");
  });

  it("names only real recovery verbs in the instruction footer", () => {
    const out = serializeExplainContext(SAMPLE);
    for (const verb of ["retry reconcile", "protect", "flatten", "restart detector", "re-run verification"]) {
      assert.ok(out.includes(verb), `footer must offer the real recovery verb "${verb}"`);
    }
    assert.match(out, /No invented buttons/i, "footer must forbid invented buttons");
    assert.match(out, /Not a trade signal/i, "footer must state it is not a trade signal");
  });

  it("degrades gracefully when readiness / health are missing", () => {
    const out = serializeExplainContext({ event: { kind: "app_error", message: "x" } });
    assert.match(out, /READINESS: \(unavailable\)/);
    assert.match(out, /health snapshot unavailable/);
    assert.doesNotThrow(() => serializeExplainContext({}));
    assert.doesNotThrow(() => serializeExplainContext());
  });
});

describe("serializeExplainContext — bounded (huge payloads truncated)", () => {
  it("truncates a giant error message and never ships it whole", () => {
    const huge = "A".repeat(50_000);
    const out = serializeExplainContext({ event: { kind: "app_error", message: huge } });
    assert.ok(!out.includes("A".repeat(2000)), "a 50k message must be truncated, not embedded whole");
    assert.ok(out.length < 6000, `output must stay bounded (was ${out.length})`);
  });

  it("caps the whole block even when health carries an unexpected giant blob", () => {
    const health = { loop: "down", junk: "Z".repeat(200_000), nested: { blob: "Q".repeat(200_000) } };
    const out = serializeExplainContext({ event: { message: "x" }, health });
    assert.ok(!out.includes("Z".repeat(500)), "unwhitelisted health junk must be dropped, not serialized");
    assert.ok(!out.includes("Q".repeat(500)), "nested health blobs must be dropped too");
    assert.ok(out.length <= 4000, `whole block must respect the MAX_TOTAL ceiling (was ${out.length})`);
  });

  it("caps the number of non-pass readiness rows listed", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}`, status: "fail", reason: `reason ${i}` }));
    const out = serializeExplainContext({ event: {}, readiness: { rows } });
    assert.match(out, /and \d+ more non-pass row\(s\)/, "over-long readiness lists must be truncated with a tally");
  });
});

describe("boundedText — single-line, length-capped", () => {
  it("collapses whitespace to a single line", () => {
    assert.equal(boundedText("a\n  b\t c"), "a b c");
  });
  it("truncates with an ellipsis marker over the cap", () => {
    const out = boundedText("x".repeat(100), 10);
    assert.ok(out.length <= 10, "must respect the cap");
    assert.ok(out.endsWith("…"), "truncation must be visible");
  });
  it("coerces non-strings and null-safes", () => {
    assert.equal(boundedText(null), "");
    assert.equal(boundedText(42), "42");
    assert.equal(boundedText(true), "true");
  });
});

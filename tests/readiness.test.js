// Pure unit tests for the readiness reducer (app/main/readiness.js).
// No Electron, no IO — the reducer is fed plain fact objects.

import test from "node:test";
import assert from "node:assert/strict";
import {
  composeReadiness,
  READINESS_ROW_IDS,
  READINESS_STATUS,
} from "../app/main/readiness.js";

const NOW = 1_000_000_000_000;

// A facts bundle where every row is green.
function allGreenFacts() {
  const gate = (id) => ({ status: "pass", reason: `${id} ok`, evidence: { ok: true }, as_of: NOW });
  return {
    now: NOW,
    goLive: {
      tests: gate("tests"),
      corpus: gate("corpus"),
      parity: gate("parity"),
      strategy_approval: gate("approval"),
    },
    version: { state: "current", sha: "abc1234", boot_sha: "abc1234", behind: 0, restart_needed: false, pull_needed: false, as_of: NOW },
    pine: { cdp: "up", schema: 4, schema_supported: true, code_rev: 1, expected_code_rev: 1, emit_ms: NOW - 3000, as_of: NOW },
    detector: { loop: "healthy", heartbeat_age_s: 4, cdp: "up", turn_lag_s: 2, as_of: NOW },
    account: { connected: true, route: true, needsConfirm: false, level: null, name: "Paper", live: false, as_of: NOW },
    reconciliation: { healthy: true, state: "HEALTHY", as_of: NOW },
    protection: { healthy: true, state: "NO_POSITION", blocked: false, blocker: null, as_of: NOW },
    automation: { mode: "manual", autoPaused: false, as_of: NOW },
  };
}

test("all-green facts → arm true, every row pass, correct order", () => {
  const r = composeReadiness(allGreenFacts());
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => x.id), READINESS_ROW_IDS);
  for (const row of r.rows) assert.equal(row.status, READINESS_STATUS.PASS, `${row.id} should pass`);
  assert.equal(r.summary.arm, true);
  assert.equal(r.summary.paper, true);
  assert.equal(r.summary.mode, "auto_ready");
  assert.equal(r.summary.worst, "pass");
  assert.deepEqual(r.summary.blockers, []);
});

test("every row carries a real source + reason + evidence object or null", () => {
  const r = composeReadiness(allGreenFacts());
  for (const row of r.rows) {
    assert.ok(typeof row.source === "string" && row.source.length > 0, `${row.id} source`);
    assert.ok(typeof row.reason === "string" && row.reason.trim().length > 0, `${row.id} reason`);
    assert.ok(row.evidence === null || (typeof row.evidence === "object" && !Array.isArray(row.evidence)), `${row.id} evidence`);
  }
});

test("age_s computed from as_of / heartbeat", () => {
  const f = allGreenFacts();
  f.version.as_of = NOW - 30_000; // 30s old
  const r = composeReadiness(f);
  const rc = r.rows.find((x) => x.id === "running_code");
  assert.equal(rc.age_s, 30);
  // detector uses the real heartbeat age, not as_of
  assert.equal(r.rows.find((x) => x.id === "detector").age_s, 4);
});

test("stale running code (restart_needed) is a critical blocker", () => {
  const f = allGreenFacts();
  f.version.restart_needed = true;
  f.version.boot_sha = "old0000";
  f.version.sha = "new1111";
  const r = composeReadiness(f);
  const row = r.rows.find((x) => x.id === "running_code");
  assert.equal(row.status, "fail");
  assert.equal(r.summary.arm, false);
  assert.equal(r.summary.paper, true, "stale code blocks arm but not manual/paper");
  assert.ok(r.summary.blockers.some((b) => b.id === "running_code"));
});

test("pull_needed is a soft (amber) block, not a hard fail", () => {
  const f = allGreenFacts();
  f.version.pull_needed = true;
  f.version.behind = 3;
  const r = composeReadiness(f);
  const row = r.rows.find((x) => x.id === "running_code");
  assert.equal(row.status, "warn");
  assert.equal(r.summary.arm, false);
  assert.ok(r.summary.pending.some((p) => p.id === "running_code"));
  assert.equal(r.summary.blockers.length, 0);
});

test("CDP down makes pine + detector critical fails and blocks arm", () => {
  const f = allGreenFacts();
  f.pine.cdp = "down";
  f.detector.loop = "down";
  f.detector.cdp = "down";
  const r = composeReadiness(f);
  assert.equal(r.rows.find((x) => x.id === "pine").status, "fail");
  assert.equal(r.rows.find((x) => x.id === "detector").status, "fail");
  assert.equal(r.summary.arm, false);
  assert.equal(r.summary.worst, "fail");
});

test("pine unverifiable (no emit) is a warn — blocks arm, allows paper", () => {
  const f = allGreenFacts();
  f.pine.code_rev = null;
  const r = composeReadiness(f);
  assert.equal(r.rows.find((x) => x.id === "pine").status, "warn");
  assert.equal(r.summary.arm, false);
  assert.equal(r.summary.paper, true);
});

test("pine code_rev drift is a hard fail", () => {
  const f = allGreenFacts();
  f.pine.code_rev = 1;
  f.pine.expected_code_rev = 2;
  const r = composeReadiness(f);
  assert.equal(r.rows.find((x) => x.id === "pine").status, "fail");
});

test("unconfirmed LIVE account is a critical fail; paper-unconfirmed is pending", () => {
  const live = allGreenFacts();
  live.account = { connected: true, route: false, needsConfirm: true, level: "live", name: "Tradovate", live: true, as_of: NOW };
  const rl = composeReadiness(live);
  assert.equal(rl.rows.find((x) => x.id === "broker_account").status, "fail");
  assert.equal(rl.summary.arm, false);

  const paper = allGreenFacts();
  paper.account = { connected: true, route: false, needsConfirm: true, level: "paper", name: "Paper", live: false, as_of: NOW };
  const rp = composeReadiness(paper);
  assert.equal(rp.rows.find((x) => x.id === "broker_account").status, "pending");
  assert.equal(rp.summary.arm, false);
});

test("armed LIVE account exposes the revert_sim action", () => {
  const f = allGreenFacts();
  f.account = { connected: true, route: true, needsConfirm: false, level: null, name: "Tradovate", live: true, as_of: NOW };
  const r = composeReadiness(f);
  const row = r.rows.find((x) => x.id === "broker_account");
  assert.equal(row.status, "pass");
  assert.equal(row.action, "revert_sim");
});

test("a confirmed protection breach blocks paper/manual too (safety row)", () => {
  const f = allGreenFacts();
  f.protection = { healthy: false, state: "CRITICAL_NO_STOP", blocked: true, blocker: "no_protective_stop", as_of: NOW };
  const r = composeReadiness(f);
  assert.equal(r.rows.find((x) => x.id === "protective_stop").status, "fail");
  assert.equal(r.summary.arm, false);
  assert.equal(r.summary.paper, false, "unprotected open position must block manual/paper");
  assert.equal(r.summary.mode, "locked");
  assert.equal(r.summary.safety_red, true);
});

test("reconciliation mismatch blocks arm but NOT manual (operator can recover)", () => {
  const f = allGreenFacts();
  f.reconciliation = { healthy: false, state: "ORPHAN_POSITION", as_of: NOW };
  const r = composeReadiness(f);
  assert.equal(r.rows.find((x) => x.id === "broker_reconciliation").status, "fail");
  assert.equal(r.summary.arm, false);
  assert.equal(r.summary.paper, true);
});

test("reconciliation UNKNOWN / null is a soft warn (boot / connecting)", () => {
  const f = allGreenFacts();
  f.reconciliation = { healthy: false, state: "UNKNOWN", as_of: NOW };
  const r = composeReadiness(f);
  assert.equal(r.rows.find((x) => x.id === "broker_reconciliation").status, "warn");
  assert.equal(r.summary.arm, false);
});

test("AUTO paused surfaces a warning row but never blocks arm by itself", () => {
  const f = allGreenFacts();
  f.automation = { mode: "auto", autoPaused: true, autoPauseReason: "detector not running", as_of: NOW };
  const r = composeReadiness(f);
  const row = r.rows.find((x) => x.id === "automation");
  assert.equal(row.status, "warn");
  assert.equal(row.severity, "warning");
  assert.ok(r.summary.warnings.some((w) => w.id === "automation"));
});

test("missing fact groups render UNAVAILABLE, never a fabricated pass", () => {
  const r = composeReadiness({ now: NOW });
  for (const row of r.rows) {
    if (row.id === "automation") continue; // automation defaults to manual-pass only when present
    assert.ok(["unavailable", "warn", "pending"].includes(row.status), `${row.id} => ${row.status}`);
  }
  // Every critical row absent → cannot arm.
  assert.equal(r.summary.arm, false);
  assert.equal(r.rows.find((x) => x.id === "tests").status, "unavailable");
  assert.equal(r.rows.find((x) => x.id === "automation").status, "unavailable");
});

test("malformed input (non-object) is handled fail-closed", () => {
  for (const bad of [null, undefined, 42, "x", []]) {
    const r = composeReadiness(bad);
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, READINESS_ROW_IDS.length);
    assert.equal(r.summary.arm, false);
  }
});

test("a go-live gate with a garbage status coerces to a non-pass", () => {
  const f = allGreenFacts();
  f.goLive.corpus = { status: "banana", reason: "weird", evidence: {}, as_of: NOW };
  const r = composeReadiness(f);
  const row = r.rows.find((x) => x.id === "corpus");
  assert.notEqual(row.status, "pass");
  assert.equal(r.summary.arm, false);
});

test("strategy approval pending is a critical soft-block", () => {
  const f = allGreenFacts();
  f.goLive.strategy_approval = { status: "pending", reason: "no approval on record", evidence: {}, as_of: NOW };
  const r = composeReadiness(f);
  assert.equal(r.rows.find((x) => x.id === "strategy_approval").status, "pending");
  assert.equal(r.summary.arm, false);
  assert.ok(r.summary.pending.some((p) => p.id === "strategy_approval"));
});

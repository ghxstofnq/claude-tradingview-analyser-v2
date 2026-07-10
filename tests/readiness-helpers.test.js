// Renderer-side readiness view-model tests (app/renderer/src/Readiness.helpers.js).
// Pure — asserts the fail-closed sanitizer never reads a broken payload as ready.

import test from "node:test";
import assert from "node:assert/strict";
import { composeReadiness, READINESS_ROW_IDS } from "../app/main/readiness.js";
import { readinessView, readinessBadge, formatAge, statusTone } from "../app/renderer/src/Readiness.helpers.js";

const NOW = 1_000_000_000_000;

function greenReadiness() {
  const gate = (id) => ({ status: "pass", reason: `${id} ok`, evidence: { ok: true }, as_of: NOW });
  return composeReadiness({
    now: NOW,
    goLive: { tests: gate("tests"), corpus: gate("corpus"), parity: gate("parity"), strategy_approval: gate("approval") },
    version: { sha: "abc1234", boot_sha: "abc1234", restart_needed: false, pull_needed: false, behind: 0, as_of: NOW },
    pine: { cdp: "up", schema: 4, schema_supported: true, code_rev: 1, expected_code_rev: 1, emit_ms: NOW, as_of: NOW },
    detector: { loop: "healthy", heartbeat_age_s: 3, cdp: "up", turn_lag_s: 1, as_of: NOW },
    account: { connected: true, route: true, needsConfirm: false, level: null, name: "Paper", live: false, as_of: NOW },
    reconciliation: { healthy: true, state: "HEALTHY", as_of: NOW },
    protection: { healthy: true, state: "NO_POSITION", blocked: false, blocker: null, as_of: NOW },
    automation: { mode: "manual", autoPaused: false, as_of: NOW },
  });
}

test("a valid all-green readiness is trusted, arm-ready, badge READY", () => {
  const view = readinessView(greenReadiness());
  assert.equal(view.trusted, true);
  assert.equal(view.rows.length, READINESS_ROW_IDS.length);
  assert.equal(view.summary.arm, true);
  assert.equal(readinessBadge(view).text, "READY");
  assert.equal(readinessBadge(view).tone, "ok");
});

test("every sanitized row carries a tone + label", () => {
  const view = readinessView(greenReadiness());
  for (const row of view.rows) {
    assert.ok(row.label && typeof row.label === "string");
    assert.ok(["ok", "warn", "bad"].includes(row.tone));
  }
});

test("malformed payloads are fail-closed: not trusted, not armable", () => {
  for (const bad of [null, undefined, {}, { rows: "nope" }, { rows: [] }, 5]) {
    const view = readinessView(bad);
    assert.equal(view.trusted, false, JSON.stringify(bad));
    assert.equal(view.summary.arm, false);
    assert.equal(readinessBadge(view).text, "UNKNOWN");
    // Every row still renders — as unavailable, never fabricated.
    assert.equal(view.rows.length, READINESS_ROW_IDS.length);
    assert.ok(view.rows.every((r) => r.status === "unavailable"));
  }
});

test("a row with the wrong id / bad status is coerced to unavailable", () => {
  const r = greenReadiness();
  r.rows[0] = { id: "tests", status: "banana", reason: "", evidence: null };
  const view = readinessView(r);
  const tests = view.rows.find((x) => x.id === "tests");
  assert.equal(tests.status, "unavailable");
  assert.equal(view.summary.arm, false);
});

test("summary is re-derived from rows, never trusted blindly", () => {
  // Hand a payload whose summary LIES (claims arm) but a critical row is red.
  const r = greenReadiness();
  r.rows.find((x) => x.id === "detector").status = "fail";
  r.summary.arm = true; // the lie
  const view = readinessView(r);
  assert.equal(view.summary.arm, false, "re-derived arm must ignore the lying summary");
  // A non-safety critical fail blocks arming but paper/manual stays open.
  assert.notEqual(readinessBadge(view).text, "READY");
});

test("a confirmed protective breach yields safety_red + paper false", () => {
  const r = greenReadiness();
  const stop = r.rows.find((x) => x.id === "protective_stop");
  stop.status = "fail";
  const view = readinessView(r);
  assert.equal(view.summary.safety_red, true);
  assert.equal(view.summary.paper, false);
  assert.equal(view.summary.mode, "locked");
});

test("severity is pinned — a forged warning severity on a critical row can't defeat the arm gate", () => {
  // The proven exploit: {status:"fail", severity:"warning"} on running_code would
  // drop out of the critical set and read as READY while rendering red.
  const r = greenReadiness();
  const rc = r.rows.find((x) => x.id === "running_code");
  rc.status = "fail";
  rc.severity = "warning"; // the forge
  const view = readinessView(r);
  const row = view.rows.find((x) => x.id === "running_code");
  assert.equal(row.severity, "critical", "severity must be pinned from the renderer map, not the payload");
  assert.equal(row.status, "fail");
  assert.equal(view.summary.arm, false, "forged severity must not let a red critical row arm");
  assert.notEqual(readinessBadge(view).text, "READY");
});

test("automation stays warning severity even if the payload forges it critical", () => {
  const r = greenReadiness();
  const auto = r.rows.find((x) => x.id === "automation");
  auto.status = "warn";
  auto.severity = "critical"; // forge the warning row up to critical
  const view = readinessView(r);
  assert.equal(view.rows.find((x) => x.id === "automation").severity, "warning");
  // A warn on the warning-severity automation row does NOT block arm.
  assert.equal(view.summary.arm, true);
});

test("only whitelisted action tokens survive sanitization", () => {
  const r = greenReadiness();
  const det = r.rows.find((x) => x.id === "detector");
  det.action = "rm -rf"; // not a whitelisted action
  const view = readinessView(r);
  assert.equal(view.rows.find((x) => x.id === "detector").action, null);
});

test("formatAge + statusTone", () => {
  assert.equal(formatAge(5), "5s");
  assert.equal(formatAge(90), "1m");
  assert.equal(formatAge(7200), "2h");
  assert.equal(formatAge(null), "");
  assert.equal(formatAge(-3), "");
  assert.equal(statusTone("pass"), "ok");
  assert.equal(statusTone("warn"), "warn");
  assert.equal(statusTone("fail"), "bad");
  assert.equal(statusTone("unavailable"), "bad");
});

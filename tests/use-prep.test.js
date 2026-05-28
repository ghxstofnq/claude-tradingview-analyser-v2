// tests/use-prep.test.js
// Pure-function tests for the usePrep hook's reducer + deriveState helper.
// Doesn't render React — just exercises the state-machine logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reducer, INITIAL, deriveState } from "../app/renderer/src/hooks/usePrep.js";

test("INITIAL — empty brief, not loading, no error", () => {
  assert.equal(INITIAL.brief, null);
  assert.equal(INITIAL.isLoading, false);
  assert.equal(INITIAL.error, null);
});

test("reducer — BRIEF_LOADED stores brief + clears loading + clears error", () => {
  const brief = { date: "2026-05-28", pillar_grade: "A+", prose_summary: "..." };
  const s = reducer({ brief: null, isLoading: true, error: "prev" }, { type: "BRIEF_LOADED", brief });
  assert.equal(s.brief, brief);
  assert.equal(s.isLoading, false);
  assert.equal(s.error, null);
});

test("reducer — RUN_BRIEF sets loading", () => {
  const s = reducer(INITIAL, { type: "RUN_BRIEF" });
  assert.equal(s.isLoading, true);
  assert.equal(s.error, null);
});

test("reducer — RUN_BRIEF_ERROR captures error message + clears loading", () => {
  const s = reducer({ ...INITIAL, isLoading: true }, { type: "RUN_BRIEF_ERROR", message: "rate_limit" });
  assert.equal(s.isLoading, false);
  assert.equal(s.error, "rate_limit");
});

test("reducer — RUN_BRIEF_DONE just clears loading (no error change)", () => {
  const s = reducer({ ...INITIAL, isLoading: true }, { type: "RUN_BRIEF_DONE" });
  assert.equal(s.isLoading, false);
});

test("reducer — unknown action returns same state", () => {
  const s = reducer(INITIAL, { type: "WAT" });
  assert.equal(s, INITIAL);
});

test("deriveState — no brief → returns { hasBrief: false }", () => {
  const d = deriveState({ brief: null });
  assert.equal(d.hasBrief, false);
});

test("deriveState — brief present → exposes all fields the popover needs", () => {
  const brief = {
    date: "2026-05-28", session: "ny-am",
    pillar_grade: "A+",
    prose_summary: "Long bearish narrative here that is at least fifty chars long.",
    htf_bias: [{ tf: "DAILY", bias: "BEARISH", note: "PDH took (engine.X)" }],
    primary_draw: { tf: "h4", top: 29105, bottom: 29070, cite: "engine_by_tf.h4.fvgs[0]" },
    key_levels: [{ name: "PDH", price: 29105, state: "taken" }],
    pillar2_verdict: "good",
    scenarios: [{ id: "scn-1", grade: "A+" }],
    chain_status: "clean",
  };
  const d = deriveState({ brief });
  assert.equal(d.hasBrief, true);
  assert.equal(d.grade, "A+");
  assert.equal(d.proseSummary, brief.prose_summary);
  assert.equal(d.htfBias.length, 1);
  assert.equal(d.primaryDraw, brief.primary_draw);
  assert.equal(d.keyLevels.length, 1);
  assert.equal(d.pillar2, "good");
  assert.equal(d.scenarios.length, 1);
  assert.equal(d.chainStatus, "clean");
  assert.equal(d.date, "2026-05-28");
  assert.equal(d.session, "ny-am");
});

test("deriveState — brief with missing optional fields uses safe defaults", () => {
  const brief = { date: "2026-05-28", session: "ny-am", pillar_grade: "B" };
  const d = deriveState({ brief });
  assert.equal(d.hasBrief, true);
  assert.equal(d.grade, "B");
  assert.equal(d.proseSummary, null);
  assert.deepEqual(d.htfBias, []);
  assert.equal(d.primaryDraw, null);
  assert.deepEqual(d.keyLevels, []);
  assert.deepEqual(d.scenarios, []);
  assert.equal(d.chainStatus, "clean");
});

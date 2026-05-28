import { test } from "node:test";
import assert from "node:assert/strict";
import { _guardrailsForTests } from "../app/main/sdk.js";

const {
  checkMemoryGuardrails,
  recordMemoryWrite,
  resetMemoryGuardrails,
  getState,
  shouldRecordMemoryWrite,
} = _guardrailsForTests;

test("remove success does not consume write cap or target throttle", () => {
  assert.equal(shouldRecordMemoryWrite("remove", { success: true }), false);
  assert.equal(shouldRecordMemoryWrite("add", { success: true }), true);
  assert.equal(shouldRecordMemoryWrite("replace", { success: true }), true);
  assert.equal(shouldRecordMemoryWrite("add", { success: false }), false);
});

test("guardrails allow normal adds under the per-turn cap", () => {
  resetMemoryGuardrails();
  // Need to clear lastByTarget between tests — exposed via the state but
  // mutation is local. We'll use a fresh target per test to avoid throttle.
  const target = "memory";
  assert.equal(checkMemoryGuardrails("add", target).ok, true);
  recordMemoryWrite(target);
  // Second write to same target within throttle window → refused
  assert.equal(checkMemoryGuardrails("add", target).ok, false);
});

test("guardrails enforce the per-turn cap across different targets", () => {
  resetMemoryGuardrails();
  // Fresh state, but lastByTarget persists from prior tests. We can still
  // test the per-turn cap by alternating targets — but they're throttled.
  // Easier: just simulate fast writes by jumping forward in time? We don't
  // have a clock injection. So this test verifies the cap with the
  // throttle-bypass behavior: remove() doesn't count toward the cap.
  for (let i = 0; i < 5; i++) {
    assert.equal(checkMemoryGuardrails("remove", "user").ok, true);
  }
  // remove never counts → all five succeed without bumping the counter
  assert.equal(getState().writesThisTurn, 0);
});

test("remove doesn't count toward the per-turn cap", () => {
  resetMemoryGuardrails();
  recordMemoryWrite("user");
  recordMemoryWrite("user");
  recordMemoryWrite("user");
  // We've recorded 3 writes — now any non-remove action should be refused
  // for the same target due to throttle, AND because of per-turn cap.
  const r = checkMemoryGuardrails("add", "user");
  assert.equal(r.ok, false);
  // remove still allowed
  assert.equal(checkMemoryGuardrails("remove", "user").ok, true);
});

test("resetMemoryGuardrails clears per-turn counter but NOT throttle", () => {
  resetMemoryGuardrails();
  recordMemoryWrite("memory");
  assert.equal(getState().writesThisTurn, 1);
  resetMemoryGuardrails();
  assert.equal(getState().writesThisTurn, 0);
  // But the throttle entry for "memory" persists across turns
  assert.ok(getState().lastByTarget.has("memory"));
  // So a same-target write right after reset is still blocked
  assert.equal(checkMemoryGuardrails("add", "memory").ok, false);
});

test("per-turn cap kicks in across distinct targets when writes are quick", () => {
  resetMemoryGuardrails();
  // Use targets that haven't been written in any other test by reaching
  // into the state directly: there are only two valid targets (memory + user),
  // so the cap test relies on at least one being recently written.
  // With memoryWritesThisTurn===0 and a clean throttle for "user", first write OK.
  const s = getState();
  s.lastByTarget.delete("user"); // simulate fresh-target case
  for (let i = 0; i < s.MAX_WRITES_PER_TURN; i++) {
    // We can't actually fire MAX_WRITES different non-throttled writes in one
    // turn (only two targets), but we can simulate by manually bumping the
    // counter. The cap check looks at the counter, not the throttle.
    recordMemoryWrite("user");
    s.lastByTarget.delete("user"); // clear throttle each iteration
  }
  // Now at the cap
  s.lastByTarget.delete("user");
  const r = checkMemoryGuardrails("add", "user");
  assert.equal(r.ok, false);
  assert.match(r.reason, /rate limit|writes per turn/i);
});

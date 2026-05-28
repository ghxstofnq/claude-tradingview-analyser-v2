import test from "node:test";
import assert from "node:assert/strict";
import { resetSession, isClaudeAuthBlocked, _authCircuitForTests } from "../app/main/sdk.js";

test("sdk auth circuit breaker survives scoped session reset", () => {
  _authCircuitForTests.clear();
  _authCircuitForTests.block("Not logged in");

  resetSession("chat");

  assert.equal(isClaudeAuthBlocked()?.message, "Not logged in");
  _authCircuitForTests.clear();
});

test("sdk auth circuit breaker clears on full session reset", () => {
  _authCircuitForTests.clear();
  _authCircuitForTests.block("Not logged in");

  resetSession();

  assert.equal(isClaudeAuthBlocked(), null);
});

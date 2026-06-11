import test from "node:test";
import assert from "node:assert/strict";
import {
  providerOverrideForScheduledTurnForTests as providerOverrideForScheduledTurn,
  shouldUseDirectScheduledTurnForTests as shouldUseDirectScheduledTurn,
  shouldRetryScheduledTurnForTests as shouldRetry,
} from "../app/main/scheduled-turn.js";

test("scheduled-turn retry policy: auth errors are not retried", () => {
  assert.equal(
    shouldRetry({ errorMessage: "Claude Code returned an error result: Not logged in · Please run /login" }),
    false,
  );
  assert.equal(shouldRetry({ errorMessage: "401 Unauthorized" }), false);
});

test("scheduled-turn retry policy: auth circuit breaker suppresses retry", () => {
  assert.equal(shouldRetry({ errorMessage: "temporary network blip", authBlocked: true }), false);
});

test("scheduled-turn retry policy: transient first failures still retry once", () => {
  assert.equal(shouldRetry({ errorMessage: "ECONNRESET socket hang up" }), true);
  assert.equal(shouldRetry({ errorMessage: "ECONNRESET socket hang up", isRetry: true }), false);
});

test("scheduled-turn provider routing: tool-requiring scheduled turns can force Claude", () => {
  assert.equal(providerOverrideForScheduledTurn({ purpose: "brief", providerOverride: "claude" }), "claude");
  assert.equal(providerOverrideForScheduledTurn({ purpose: "brief" }), null);
});

test("scheduled-turn provider routing: deterministic-first — a direct runner always wins over the LLM path", () => {
  // 2026-06-12: production briefs were riding the Codex MCP turn (600s
  // timeouts, two failures on June 11 alone) while a reliable deterministic
  // path sat as fallback-only. Deterministic extraction is the architecture
  // (docs/research/ai-trading-analysis.md); the LLM decorates, it does not
  // gate the brief landing.
  const codexMcpToolRequired = { name: "codex", toolRequired: true, supportsToolCalling: true };
  const codexTextOnlyToolRequired = { name: "codex", toolRequired: true, supportsToolCalling: false };
  const claudeToolRequired = { name: "claude", toolRequired: true, supportsToolCalling: true };
  assert.equal(shouldUseDirectScheduledTurn({ provider: codexMcpToolRequired, directRunFn: async () => {} }), true);
  assert.equal(shouldUseDirectScheduledTurn({ provider: codexTextOnlyToolRequired, directRunFn: async () => {} }), true);
  assert.equal(shouldUseDirectScheduledTurn({ provider: claudeToolRequired, directRunFn: async () => {} }), true);
  assert.equal(shouldUseDirectScheduledTurn({ provider: codexTextOnlyToolRequired }), false);
});

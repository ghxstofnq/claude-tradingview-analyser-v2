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

test("scheduled-turn auth gate: deterministic-first purposes run while auth is blocked", async () => {
  const { shouldSkipForAuth } = await import("../app/main/scheduled-turn.js");
  // 2026-06-12: the London wrap (directRunFn present) was skipped
  // claude_auth_blocked even though its deterministic path needs no LLM.
  assert.equal(shouldSkipForAuth({ authMsg: "Claude not logged in", hasDirectRun: true }), false);
  assert.equal(shouldSkipForAuth({ authMsg: "Claude not logged in", hasDirectRun: false }), true);
  assert.equal(shouldSkipForAuth({ authMsg: null, hasDirectRun: false }), false);
});

test("summary.md renders Codex commentary when present", async () => {
  // The London 2026-06-12 wrap carried a full codex_analysis block in
  // summary.json while summary.md (what REVIEW renders) showed none of it.
  const { __test } = await import("../app/main/tools/surface.js");
  const md = __test.renderSummaryMd({
    session: "london",
    ts: "2026-06-12T10:26:00.000Z",
    bias_picture: "ctx",
    what_happened: "quiet",
    watch_next_session: ["PWH untaken"],
    codex_analysis: {
      commentary: "Chain recap only; no confirmed setups.",
      risk_challenges: ["No setup lines persisted."],
      confidence_note: "Moderate confidence.",
    },
  });
  assert.match(md, /## Analysis \(Codex commentary\)/);
  assert.match(md, /Chain recap only/);
  assert.match(md, /No setup lines persisted/);
  assert.match(md, /Moderate confidence/);
});

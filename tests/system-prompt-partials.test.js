// Asserts that for each of the 6 purposes, the composed system prompt
// contains the structural section markers it MUST have. These tests
// guard against accidentally dropping a section during the partials
// migration. They complement the byte-identical check in
// scripts/verify-prompts-byte-identical.js (which is the strict gate
// run after each extraction).

import { test } from "node:test";
import assert from "node:assert/strict";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";

// Each purpose's composed prompt MUST contain every marker in its row.
// Markers are strings searched with includes(); each must appear EXACTLY
// once (no duplicates).
const EXPECTED_SECTIONS = {
  "bar-close": [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## ALERT GUIDANCE",
    "<bundle_fields>",
    '<phase name="open_reaction">\n',
    '<phase name="entry_hunt">\n',
    "<anti_patterns>\n",
    "<ict_vocabulary>",
    "<examples>",
    "<output_json>",
  ],
  brief: [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## ALERT GUIDANCE",
    "<bundle_fields>",
    '<phase name="brief">\n',
    "<ict_vocabulary>",
  ],
  "catch-up": [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "<bundle_fields>",
    '<phase name="open_reaction">\n',
    '<phase name="catch_up">\n',
    '<phase name="entry_hunt">\n',
    "<anti_patterns>\n",
    "<ict_vocabulary>",
    "<examples>",
    "<output_json>",
  ],
  chat: [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## ALERT GUIDANCE",
    "## PERSISTENT MEMORY GUIDANCE",
  ],
  wrap: [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## PERSISTENT MEMORY GUIDANCE",
    '<phase name="post_session">\n',
  ],
  review: [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## REVIEW TURN PROTOCOL",
    "## PERSISTENT MEMORY GUIDANCE",
  ],
};

for (const [purpose, sections] of Object.entries(EXPECTED_SECTIONS)) {
  test(`${purpose}: composed prompt contains every expected section exactly once`, async () => {
    const prompt = joinSystemPrompt(await loadSystemPrompt(purpose));
    for (const marker of sections) {
      const count = prompt.split(marker).length - 1;
      assert.equal(
        count,
        1,
        `${purpose} expected exactly 1 occurrence of "${marker}", found ${count}`
      );
    }
  });
}

test("composed prompt for chat does NOT contain analysis-only sections", async () => {
  const prompt = joinSystemPrompt(await loadSystemPrompt("chat"));
  assert.ok(!prompt.includes("<bundle_fields>"), "chat must not carry bundle_fields");
  assert.ok(!prompt.includes("<examples>"), "chat must not carry examples");
  assert.ok(!prompt.includes("<anti_patterns>\n"), "chat must not carry anti_patterns");
});

test("composed prompt for review does NOT contain analysis-only sections", async () => {
  const prompt = joinSystemPrompt(await loadSystemPrompt("review"));
  assert.ok(!prompt.includes("<bundle_fields>"), "review must not carry bundle_fields");
  assert.ok(!prompt.includes("<examples>"), "review must not carry examples");
});

test("composed prompt for wrap does NOT contain analysis-only sections", async () => {
  const prompt = joinSystemPrompt(await loadSystemPrompt("wrap"));
  assert.ok(!prompt.includes("<bundle_fields>"), "wrap must not carry bundle_fields");
  assert.ok(!prompt.includes("<examples>"), "wrap must not carry examples");
});

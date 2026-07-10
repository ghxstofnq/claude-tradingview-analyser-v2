import { test } from "node:test";
import assert from "node:assert/strict";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";

const PURPOSES = ["chat", "review", "wrap", "brief", "bar-close", "journal", "coach", "analysis"];

test("kernel content present in every purpose", async () => {
  for (const purpose of PURPOSES) {
    const prompt = joinSystemPrompt(await loadSystemPrompt(purpose));
    assert.match(prompt, /Cite or omit/i, `${purpose}: missing rule "cite or omit"`);
    assert.match(prompt, /No arithmetic/i, `${purpose}: missing rule "no arithmetic"`);
    assert.match(prompt, /Grade enum only/i, `${purpose}: missing rule "grade enum only"`);
    assert.match(prompt, /strategy_authority|3-pillar/i, `${purpose}: missing strategy authority`);
  }
});

test("per-purpose content present", async () => {
  // Body markers that are unique to each phase block (NOT the routing
  // reference in kernel.md — that one mentions `<phase name="brief">` as
  // a routing hint, so we use body-specific phrases instead).
  const cases = [
    ["brief", /publish the PREP-panel SESSION BRIEF/i],
    ["bar-close", /You are in entry hunt\. The deterministic walker chain/i],
    ["bar-close", /first 15 min of NY's reaction/i],
    ["wrap", /write a one-paragraph wrap to this session/i],
    ["chat", /ALERT GUIDANCE|alert tool call/i],
    ["chat", /PERSISTENT MEMORY GUIDANCE/i],
    ["review", /REVIEW TURN PROTOCOL/i],
    ["review", /PERSISTENT MEMORY GUIDANCE/i],
    ["wrap", /PERSISTENT MEMORY GUIDANCE/i],
    ["journal", /JOURNAL NOTE PROTOCOL/i],
    ["journal", /post-close journaling only/i],
    ["coach", /COACH READ PROTOCOL/i],
    ["coach", /Retrospective only|retrospective coaching read/i],
    ["analysis", /DEEP-READ ANALYSIS/i],
    ["analysis", /not a (?:trade )?signal/i],
  ];
  for (const [purpose, pattern] of cases) {
    const prompt = joinSystemPrompt(await loadSystemPrompt(purpose));
    assert.match(prompt, pattern, `${purpose}: missing per-purpose content matching ${pattern}`);
  }
});

test("chat does NOT contain analysis content", async () => {
  const chat = joinSystemPrompt(await loadSystemPrompt("chat"));
  assert.doesNotMatch(chat, /You are in entry hunt\. The deterministic walker chain/, "chat should not have entry_hunt phase body");
  assert.doesNotMatch(chat, /publish the PREP-panel SESSION BRIEF/, "chat should not have brief phase body");
  assert.doesNotMatch(chat, /first 15 min of NY's reaction/, "chat should not have open_reaction phase body");
  assert.doesNotMatch(chat, /<examples>/, "chat should not have entry-model examples");
  assert.doesNotMatch(chat, /<bundle_fields>/, "chat should not have bundle_fields");
});

test("review does NOT contain analysis content", async () => {
  const review = joinSystemPrompt(await loadSystemPrompt("review"));
  assert.doesNotMatch(review, /You are in entry hunt\. The deterministic walker chain/, "review should not have entry_hunt phase body");
  assert.doesNotMatch(review, /publish the PREP-panel SESSION BRIEF/, "review should not have brief phase body");
  assert.doesNotMatch(review, /<examples>/, "review should not have entry-model examples");
  assert.doesNotMatch(review, /<bundle_fields>/, "review should not have bundle_fields");
});

test("journal does NOT contain analysis content", async () => {
  const journal = joinSystemPrompt(await loadSystemPrompt("journal"));
  assert.doesNotMatch(journal, /You are in entry hunt\. The deterministic walker chain/, "journal should not have entry_hunt phase body");
  assert.doesNotMatch(journal, /publish the PREP-panel SESSION BRIEF/, "journal should not have brief phase body");
  assert.doesNotMatch(journal, /<examples>/, "journal should not have entry-model examples");
  assert.doesNotMatch(journal, /<bundle_fields>/, "journal should not have bundle_fields");
});

test("coach does NOT contain analysis content", async () => {
  const coach = joinSystemPrompt(await loadSystemPrompt("coach"));
  assert.doesNotMatch(coach, /You are in entry hunt\. The deterministic walker chain/, "coach should not have entry_hunt phase body");
  assert.doesNotMatch(coach, /publish the PREP-panel SESSION BRIEF/, "coach should not have brief phase body");
  assert.doesNotMatch(coach, /<examples>/, "coach should not have entry-model examples");
  assert.doesNotMatch(coach, /<bundle_fields>/, "coach should not have bundle_fields");
});

test("wrap does NOT contain entry-hunt or brief content", async () => {
  const wrap = joinSystemPrompt(await loadSystemPrompt("wrap"));
  assert.doesNotMatch(wrap, /You are in entry hunt\. The deterministic walker chain/, "wrap should not have entry_hunt phase body");
  assert.doesNotMatch(wrap, /publish the PREP-panel SESSION BRIEF/, "wrap should not have brief phase body");
  assert.doesNotMatch(wrap, /<examples>/, "wrap should not have entry-model examples");
});

test("dead content not present anywhere", async () => {
  for (const purpose of PURPOSES) {
    const prompt = joinSystemPrompt(await loadSystemPrompt(purpose));
    assert.doesNotMatch(prompt, /entry_hunt_legacy_DISABLED/, `${purpose}: contains DISABLED block`);
    assert.doesNotMatch(prompt, /<phase name="pre_session">/, `${purpose}: contains dead pre_session phase`);
  }
});

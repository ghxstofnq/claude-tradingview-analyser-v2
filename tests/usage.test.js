import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUsageFromResult, summarizeUsage } from "../app/main/usage.js";

const SAMPLE_RESULT = {
  type: "result",
  subtype: "success",
  duration_ms: 12345,
  duration_api_ms: 11000,
  is_error: false,
  num_turns: 1,
  result: "ok",
  stop_reason: "end_turn",
  total_cost_usd: 0.0421,
  usage: {
    input_tokens: 1500,
    output_tokens: 800,
    cache_read_input_tokens: 30000,
    cache_creation_input_tokens: 5000,
  },
  modelUsage: {
    "claude-opus-4-7": {
      inputTokens: 1500,
      outputTokens: 800,
      cacheReadInputTokens: 30000,
      cacheCreationInputTokens: 5000,
      webSearchRequests: 0,
      costUSD: 0.0421,
      contextWindow: 200000,
      maxOutputTokens: 8192,
    },
  },
};

test("extractUsageFromResult returns null for non-result messages", () => {
  assert.equal(extractUsageFromResult(null), null);
  assert.equal(extractUsageFromResult({ type: "assistant" }), null);
  assert.equal(extractUsageFromResult({ type: "result", subtype: "error" }), null);
});

test("extractUsageFromResult pulls cost + usage + models", () => {
  const u = extractUsageFromResult(SAMPLE_RESULT);
  assert.equal(u.cost_usd, 0.0421);
  assert.equal(u.input_tokens, 1500);
  assert.equal(u.output_tokens, 800);
  assert.equal(u.cache_read, 30000);
  assert.equal(u.cache_creation, 5000);
  assert.equal(u.models.length, 1);
  assert.equal(u.models[0].model, "claude-opus-4-7");
  assert.equal(u.models[0].cost_usd, 0.0421);
});

test("extractUsageFromResult is robust to missing fields", () => {
  const u = extractUsageFromResult({
    type: "result",
    subtype: "success",
    is_error: false,
  });
  assert.equal(u.cost_usd, 0);
  assert.equal(u.input_tokens, 0);
  assert.equal(u.models.length, 0);
});

test("summarizeUsage sums cost + tokens across succeeded rows", () => {
  const today = new Date().toISOString();
  const rows = [
    { ts: today, kind: "bar-close", event: "succeeded", usage: { cost_usd: 0.05, input_tokens: 1000, output_tokens: 200, models: [{ model: "opus", cost_usd: 0.05, input_tokens: 1000, output_tokens: 200, cache_read: 0, cache_creation: 0 }] } },
    { ts: today, kind: "bar-close", event: "succeeded", usage: { cost_usd: 0.03, input_tokens: 800, output_tokens: 150, models: [{ model: "opus", cost_usd: 0.03, input_tokens: 800, output_tokens: 150, cache_read: 0, cache_creation: 0 }] } },
    { ts: today, kind: "chat", event: "succeeded", usage: { cost_usd: 0.12, input_tokens: 2000, output_tokens: 500, models: [{ model: "opus", cost_usd: 0.12, input_tokens: 2000, output_tokens: 500, cache_read: 0, cache_creation: 0 }] } },
    { ts: today, kind: "bar-close", event: "failed" }, // ignored — no usage
  ];
  const sum = summarizeUsage(rows);
  assert.equal(sum.total_cost_usd, 0.2);
  assert.equal(sum.total_turns, 3);
  assert.equal(sum.total_input, 3800);
  assert.equal(sum.total_output, 850);
  assert.equal(sum.by_purpose["bar-close"].turns, 2);
  assert.equal(sum.by_purpose["bar-close"].cost_usd, 0.08);
  assert.equal(sum.by_purpose.chat.turns, 1);
  assert.equal(sum.by_model.opus.turns, 3);
});

test("summarizeUsage filters by day in ET", () => {
  // A row from yesterday and a row from today (ET).
  const yest = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const today = new Date().toISOString();
  const rows = [
    { ts: yest, kind: "chat", event: "succeeded", usage: { cost_usd: 0.5, input_tokens: 100, output_tokens: 100, models: [] } },
    { ts: today, kind: "chat", event: "succeeded", usage: { cost_usd: 0.1, input_tokens: 100, output_tokens: 100, models: [] } },
  ];
  // Today's date in ET.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  const todayET = `${get("year")}-${get("month")}-${get("day")}`;
  const sum = summarizeUsage(rows, { day: todayET });
  assert.equal(sum.total_turns, 1);
  assert.equal(sum.total_cost_usd, 0.1);
});

test("summarizeUsage handles empty + invalid input", () => {
  const e1 = summarizeUsage([]);
  assert.equal(e1.total_cost_usd, 0);
  assert.equal(e1.total_turns, 0);
  const e2 = summarizeUsage(null);
  assert.equal(e2.total_turns, 0);
});

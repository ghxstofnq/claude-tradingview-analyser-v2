import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, describeError } from "../app/main/error-classifier.js";

test("classifies rate-limit messages", () => {
  for (const msg of [
    "429 Too Many Requests",
    "rate limit exceeded",
    "Quota exceeded for requests per minute",
  ]) {
    const c = classifyError(msg);
    assert.equal(c.kind, "rate_limit", msg);
    assert.equal(c.retryable, true);
  }
});

test("classifies context-overflow messages", () => {
  for (const msg of [
    "prompt is too long",
    "input length exceeds the maximum context window",
    "too many tokens in request",
  ]) {
    assert.equal(classifyError(msg).kind, "context_overflow", msg);
  }
  assert.equal(classifyError("prompt is too long").retryable, false);
});

test("classifies content-filter refusals", () => {
  for (const msg of [
    "Anthropic content filter blocked this request",
    "the model refused to respond due to content policy",
    "moderation flag",
  ]) {
    assert.equal(classifyError(msg).kind, "content_filter", msg);
  }
});

test("classifies auth failures", () => {
  for (const msg of [
    "401 Unauthorized",
    "invalid api key",
    "OAuth token expired",
    "Forbidden 403",
    "Claude Code returned an error result: Not logged in · Please run /login",
    "login required",
  ]) {
    assert.equal(classifyError(msg).kind, "auth", msg);
  }
  assert.equal(classifyError("401 Unauthorized").retryable, false);
});

test("classifies network errors", () => {
  for (const msg of [
    "fetch failed: ECONNREFUSED",
    "socket hang up",
    "ENOTFOUND api.anthropic.com",
    "TLS handshake failed",
  ]) {
    assert.equal(classifyError(msg).kind, "network", msg);
  }
  assert.equal(classifyError("ECONNREFUSED").retryable, true);
});

test("classifies our own wall-clock timeouts and cancels", () => {
  assert.equal(classifyError("userTurn timed out after 90000ms (purpose=bar-close)").kind, "timeout");
  assert.equal(classifyError("turn cancelled by user (purpose=chat)").kind, "timeout");
});

test("classifies MCP tool errors", () => {
  assert.equal(classifyError("MCP tool surface_setup failed: invalid args").kind, "tool_error");
});

test("falls back to unknown + retryable", () => {
  const c = classifyError("something weird happened");
  assert.equal(c.kind, "unknown");
  assert.equal(c.retryable, true);
});

test("handles Error objects + plain strings + null", () => {
  assert.equal(classifyError(new Error("429 rate limit")).kind, "rate_limit");
  assert.equal(classifyError("plain string").kind, "unknown");
  assert.equal(classifyError(null).kind, "unknown");
  assert.equal(classifyError(undefined).kind, "unknown");
});

test("describeError gives a short human-readable label", () => {
  assert.match(describeError({ kind: "rate_limit", message: "" }), /rate.?limit/i);
  assert.match(describeError({ kind: "context_overflow", message: "" }), /context|new chat/i);
  assert.match(describeError({ kind: "auth", message: "" }), /authentication|credentials/i);
  assert.match(
    describeError({ kind: "unknown", message: "very long error message that should be truncated to 120 chars max so the dashboard chip stays readable across narrow viewports" }),
    /very long error/,
  );
});

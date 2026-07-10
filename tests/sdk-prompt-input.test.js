// tests/sdk-prompt-input.test.js
// Pins buildTurnPromptInput — the seam every LLM turn's prompt rides through.
// The trading-narration path (images:null) MUST stay the byte-identical string
// prompt; only journal (Claude + a valid base64 image) switches to the
// streaming-input async iterable.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTurnPromptInput } from "../app/main/sdk.js";

const CLAUDE = { name: "claude" };
const CODEX = { name: "codex" };
const TEXT = "the exact user turn text";

describe("buildTurnPromptInput — string-prompt path (unchanged for every non-journal turn)", () => {
  it("images:null → returns the exact string (===)", () => {
    assert.strictEqual(buildTurnPromptInput({ text: TEXT, images: null, provider: CLAUDE }), TEXT);
  });
  it("images:[] → returns the exact string", () => {
    assert.strictEqual(buildTurnPromptInput({ text: TEXT, images: [], provider: CLAUDE }), TEXT);
  });
  it("non-Claude provider + a valid image → still the string (Codex is text-only)", () => {
    const out = buildTurnPromptInput({ text: TEXT, images: [{ data: "AAAA", media_type: "image/png" }], provider: CODEX });
    assert.strictEqual(out, TEXT);
  });
  it("only malformed image entries → dropped → falls back to the string", () => {
    const out = buildTurnPromptInput({ text: TEXT, images: [{ media_type: "image/png" }, { data: "" }, null], provider: CLAUDE });
    assert.strictEqual(out, TEXT);
  });
});

describe("buildTurnPromptInput — streaming-input path (journal image carve-out)", () => {
  it("Claude + a valid base64 image → single-yield async iterable of [text, image]", async () => {
    const out = buildTurnPromptInput({
      text: TEXT,
      images: [{ data: "AAAA", media_type: "image/png" }, { data: "" }],
      provider: CLAUDE,
    });
    assert.notEqual(typeof out, "string", "should be an async iterable, not a string");
    const yielded = [];
    for await (const m of out) yielded.push(m);
    assert.equal(yielded.length, 1, "yields exactly one user message then completes");
    const msg = yielded[0];
    assert.equal(msg.type, "user");
    assert.equal(msg.parent_tool_use_id, null);
    assert.equal(msg.message.role, "user");
    assert.deepEqual(msg.message.content, [
      { type: "text", text: TEXT },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("defaults a missing media_type to image/png", async () => {
    const out = buildTurnPromptInput({ text: TEXT, images: [{ data: "BBBB" }], provider: CLAUDE });
    const first = (await out[Symbol.asyncIterator]().next()).value;
    assert.equal(first.message.content[1].source.media_type, "image/png");
  });
});

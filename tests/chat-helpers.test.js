// Unit tests for CHAT helpers: the default provider + the BRAIN narration
// routing predicate.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeChatProvider, DEFAULT_CHAT_PROVIDER } from "../app/renderer/src/provider-popover-contract.js";
import { isNarrationPurpose } from "../app/renderer/src/hooks/useChat.js";

describe("DEFAULT_CHAT_PROVIDER", () => {
  it("defaults to claude (matches the 2026-06-12 backend DEFAULT_PROVIDER flip)", () => {
    assert.equal(DEFAULT_CHAT_PROVIDER, "claude");
    assert.equal(normalizeChatProvider(undefined), "claude");
    assert.equal(normalizeChatProvider(""), "claude");
  });
  it("still resolves codex when explicitly asked", () => {
    assert.equal(normalizeChatProvider("codex"), "codex");
  });
});

describe("isNarrationPurpose", () => {
  it("true for the per-bar narration purposes (rendered into BRAIN)", () => {
    assert.equal(isNarrationPurpose("bar-close"), true);
    assert.equal(isNarrationPurpose("catch-up"), true);
    assert.equal(isNarrationPurpose("catch_up"), true);
  });
  it("false for brief/wrap/review/chat and undefined (must NOT leak into BRAIN)", () => {
    assert.equal(isNarrationPurpose("brief"), false);
    assert.equal(isNarrationPurpose("wrap"), false);
    assert.equal(isNarrationPurpose("review"), false);
    assert.equal(isNarrationPurpose("chat"), false);
    assert.equal(isNarrationPurpose(undefined), false);
    assert.equal(isNarrationPurpose(null), false);
  });
});

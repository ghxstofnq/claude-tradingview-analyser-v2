// tests/journal-prompt-helpers.test.js
// Pure draft-labeling helper for JournalPrompt (Track 2, ruled 2026-07-10).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { journalDraftState, MANUAL_PLACEHOLDER, DRAFT_LABEL } from "../app/renderer/src/shell/JournalPrompt.helpers.js";

describe("journalDraftState", () => {
  it("absent suggestion → manual flow unchanged (no draft, manual placeholder)", () => {
    for (const row of [null, undefined, {}, { suggested_note: null }, { suggested_note: "" }, { suggested_note: "   " }]) {
      const s = journalDraftState(row);
      assert.equal(s.hasDraft, false);
      assert.equal(s.text, "");
      assert.equal(s.label, null);
      assert.equal(s.placeholder, MANUAL_PLACEHOLDER);
    }
  });

  it("non-empty suggestion → labeled draft, trimmed seed text", () => {
    const s = journalDraftState({ suggested_note: "  chased the entry — pillar 2 was marginal.  " });
    assert.equal(s.hasDraft, true);
    assert.equal(s.text, "chased the entry — pillar 2 was marginal.");
    assert.equal(s.label, DRAFT_LABEL);
    assert.match(s.label, /CLAUDE DRAFT/);
    // Placeholder stays the manual prompt; the seed text is what the user sees.
    assert.equal(s.placeholder, MANUAL_PLACEHOLDER);
  });

  it("ignores a non-string suggestion", () => {
    const s = journalDraftState({ suggested_note: 42 });
    assert.equal(s.hasDraft, false);
    assert.equal(s.text, "");
  });
});

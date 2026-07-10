// tests/journal-prompt-helpers.test.js
// Pure draft-labeling helper for JournalPrompt (Track 2, ruled 2026-07-10).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { journalDraftState, reduceJournalClose, MANUAL_PLACEHOLDER, DRAFT_LABEL } from "../app/renderer/src/shell/JournalPrompt.helpers.js";

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

describe("reduceJournalClose", () => {
  it("raises a fresh close when no card is open", () => {
    const next = reduceJournalClose(null, { id: "a", r: 1 }, new Set());
    assert.deepEqual(next, { id: "a", r: 1 });
  });

  it("IGNORES a later emit for an already-handled (saved/dismissed) id", () => {
    const handled = new Set(["a"]);
    // The late draft emit for a dismissed row must not re-open a card.
    assert.equal(reduceJournalClose(null, { id: "a", suggested_note: "draft" }, handled), null);
    const openOther = { id: "b" };
    assert.equal(reduceJournalClose(openOther, { id: "a", suggested_note: "draft" }, handled), openOther);
  });

  it("MERGES a late emit into the currently-open card of the same id (no re-open)", () => {
    const prev = { id: "a", r: 1, screenshot: null, suggested_note: null };
    const next = reduceJournalClose(prev, { id: "a", suggested_note: "claude draft", screenshot: "x.png" }, new Set());
    assert.equal(next.id, "a");
    assert.equal(next.suggested_note, "claude draft");
    assert.equal(next.screenshot, "x.png");
    assert.equal(next.r, 1, "existing fields preserved");
  });

  it("replaces the open card when a different-id (unhandled) close arrives", () => {
    const prev = { id: "a" };
    const next = reduceJournalClose(prev, { id: "b" }, new Set());
    assert.deepEqual(next, { id: "b" });
  });

  it("keeps prev on a malformed row (no id)", () => {
    const prev = { id: "a" };
    assert.equal(reduceJournalClose(prev, null, new Set()), prev);
    assert.equal(reduceJournalClose(prev, {}, new Set()), prev);
  });
});

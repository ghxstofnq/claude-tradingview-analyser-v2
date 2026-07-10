// Pure helpers for JournalPrompt — draft-labeling logic, extracted so it can be
// unit-tested under node --test (the .jsx itself can't be imported by tests).
//
// The post-close journal turn (Track 2, ruled 2026-07-10) fills `suggested_note`
// on the journal row asynchronously. When present, the prompt pre-fills its
// input with the draft and labels it as Claude's. An absent/empty suggestion
// leaves the manual flow identical.

const MANUAL_PLACEHOLDER = "weakest pillar? (optional — journaled either way)";
const DRAFT_LABEL = "CLAUDE DRAFT — edit or accept";

// Given a journal row, return the draft state the component renders from:
//   hasDraft    — a non-empty Claude suggestion is present on the row
//   text        — the trimmed draft to seed the input with ("" when none)
//   label       — the draft badge text (null when none)
//   placeholder — the input placeholder (manual prompt; unchanged by drafts)
export function journalDraftState(row) {
  const raw = row && typeof row.suggested_note === "string" ? row.suggested_note.trim() : "";
  const hasDraft = raw.length > 0;
  return {
    hasDraft,
    text: hasDraft ? raw : "",
    label: hasDraft ? DRAFT_LABEL : null,
    placeholder: MANUAL_PLACEHOLDER,
  };
}

export { MANUAL_PLACEHOLDER, DRAFT_LABEL };

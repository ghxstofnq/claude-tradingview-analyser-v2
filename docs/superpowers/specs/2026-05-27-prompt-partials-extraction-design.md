# Prompt Partials Extraction — Design

**Date:** 2026-05-27
**Branch:** `feat/prompt-partials-extraction`
**Status:** Approved (design); plan + implementation pending.
**Predecessor:** [2026-05-27-prompt-kernel-split-design.md](2026-05-27-prompt-kernel-split-design.md) (PR 1, shipped).
**Successor:** PR 3 — cache breakpoint placement fix (separate spec).

---

## Goal

Deduplicate the seven-to-nine prompt blocks that PR 1 left byte-identical across multiple phase files. Move each into a single canonical `partials/<name>.md` file. Compose phase + partials in `loadSystemPrompt(purpose)`.

**Constraint: loss-free.** The composed system prompt for each purpose must be byte-identical to today (modulo whitespace), proven by trigram-overlap ≥ 99.5% against the pre-PR baseline. No token-cost reduction. No behavioral change.

**Wins:**
- Single source of truth — eliminates drift risk when editing shared content.
- Cheaper future edits — touch one file, not three.
- Smaller, more focused phase files — each contains only what is unique to that phase.

**Non-goals:**
- Token reduction (would require dropping partials per-purpose; deferred).
- Lazy loading via `Skill` tool (separate PR if ever pursued — risky for load-bearing examples).
- Cache breakpoint placement fix (PR 3).
- Any content edits to the extracted blocks — pure mechanical extraction.

---

## Background

PR 1 split `analyze.md` (66 KB monolith) into `kernel.md` (5 KB shared) + `phase-<purpose>.md` (one per purpose). It removed 20.6 KB of dead code and dropped chat/wrap/review prompts from 67 KB to 2-9 KB.

bar-close and catch-up still ship 29 KB and 30 KB respectively, and they are 92% byte-identical: only the `<phase catch_up>` block distinguishes them. brief stays at 19 KB, sharing `<bundle_fields>` and `<ict_vocabulary>` with the larger two.

Across the six phase files there are nine duplicated blocks totaling ~38 KB of duplicate disk content (~25 KB unique payload). Editing any one of them today requires editing two or three files in lockstep.

---

## Inventory of duplicated content

Byte-identical across the files listed; verified with `diff`.

| Block | Size | Files | Times |
|---|---|---|---|
| `<bundle_fields>` | 5.6 KB | bar-close, brief, catch-up | 3 |
| `<ict_vocabulary>` | 2.2 KB | bar-close, brief, catch-up | 3 |
| `## ALERT GUIDANCE` (analysis variant) | 1.4 KB | bar-close, brief, catch-up | 3 |
| `## PERSISTENT MEMORY GUIDANCE` | 1.0 KB | chat, wrap, review | 3 |
| `<phase name="open_reaction">` | 6.1 KB | bar-close, catch-up | 2 |
| `<examples>` | 6.5 KB | bar-close, catch-up | 2 |
| `<phase name="entry_hunt">` | 2.7 KB | bar-close, catch-up | 2 |
| `<anti_patterns>` | 2.3 KB | bar-close, catch-up | 2 |
| `<output_json>` | 0.6 KB | bar-close, catch-up | 2 |

Not extracted:
- `## OUTPUT PROTOCOL — TOOL SURFACES` — common 3-line prefix but each phase appends its own surface-tool guidance. Stays inline; the common prefix is too small to be worth a partial.
- chat's `## ALERT GUIDANCE` variant — different content (alert-management vs analysis-time alerts). Used only in chat. Stays inline.

---

## Composition mechanism

**Per-partial markers in the phase body.** Each insertion point is an HTML comment of the form `<!-- @partial:NAME -->`. The loader replaces each marker with the contents of `partials/NAME.md`.

Loader (`loadSystemPrompt(purpose)`):
1. Reads `kernel.md` and `phase-<purpose>.md`.
2. Scans the phase body for `<!-- @partial:NAME -->` markers.
3. For each unique marker, resolves `partials/NAME.md` and reads it (via the same mtime cache as PR 1).
4. Replaces each marker with the partial's content. A marker that appears twice in the same body throws (catches accidental double-include during refactor).
5. Returns `memory_block + kernel + composed_phase`.

**Why per-partial markers (not a frontmatter list + single marker):**
- Preserves byte-identical ordering. brief currently has `<bundle_fields>` *before* the brief phase block and `<ict_vocabulary>` *after* it. A single ordered list forces all imports to one position; per-partial markers preserve current positions exactly.
- Same applies to catch-up: it has its unique `<phase catch_up>` block wedged *between* `<phase open_reaction>` (partial) and `<phase entry_hunt>` (partial). Per-partial markers keep that exact layout.
- Self-documenting: the phase file's body shows exactly where each partial lands, in order.
- No frontmatter parser needed — frontmatter stays as today (just `description:`).

**Marker syntax:** standard HTML comment, won't render in any markdown viewer. The regex is `<!-- @partial:([a-z0-9-]+) -->` — strict whitelist of lowercase + digits + hyphens for partial names, no slashes (prevents path traversal).

**Scope of names:** flat — partials live directly under `partials/`. No subdirectories.

---

## Target file structure

```
app/main/prompts/
  kernel.md                           (unchanged)
  partials/
    bundle-fields.md                  (5.6 KB)
    ict-vocab.md                      (2.2 KB)
    alert-guidance-analysis.md        (1.4 KB)
    memory-guidance.md                (1.0 KB)
    open-reaction-phase.md            (6.1 KB)
    entry-hunt-phase.md               (2.7 KB)
    examples.md                       (6.5 KB)
    anti-patterns.md                  (2.3 KB)
    output-json.md                    (0.6 KB)
  phase-bar-close.md                  (slim: OUTPUT PROTOCOL header + 9 imports)
  phase-brief.md                      (slim: OUTPUT PROTOCOL + 8-step procedure + 3 imports)
  phase-catch-up.md                   (slim: OUTPUT PROTOCOL + catch_up phase block + 7 imports)
  phase-chat.md                       (slim: + 1 import for memory-guidance)
  phase-wrap.md                       (slim: post_session phase + 1 import)
  phase-review.md                     (slim: review protocol + 1 import)
```

### Per-phase markers (in body order)

| Phase | Markers in body, in order |
|---|---|
| bar-close | alert-guidance-analysis, bundle-fields, open-reaction-phase, entry-hunt-phase, anti-patterns, ict-vocab, examples, output-json |
| brief | alert-guidance-analysis, bundle-fields, **[brief-unique phase block]**, ict-vocab |
| catch-up | alert-guidance-analysis, bundle-fields, open-reaction-phase, **[catch-up-unique phase block]**, entry-hunt-phase, anti-patterns, ict-vocab, examples, output-json |
| chat | **[chat-unique ALERT GUIDANCE + OUTPUT PROTOCOL]**, memory-guidance |
| wrap | **[post_session phase block]**, memory-guidance |
| review | **[review protocol]**, memory-guidance |

Bracketed names are unique inline content in that phase's body — kept inline because they appear in only one phase file. The markers are interleaved with that unique content to preserve current ordering exactly.

---

## Composed prompt — equivalence to today

For each of the six purposes the composed output of `loadSystemPrompt(purpose)` must be byte-identical to the current PR-1 output, modulo whitespace.

Each composed prompt is a deterministic function of:
- The kernel (unchanged)
- The phase file's unique body
- Each named partial, in the order declared

Because partials are extracted byte-for-byte from the current phase files, and the marker preserves the insertion position, the composed prompt cannot differ from today's prompt by anything other than the join character between partials (a single `\n\n`, matching what currently separates them inside the phase files).

Verification mechanism: trigram-overlap ≥ 99.5% against the snapshot captured before the PR (same script as PR 1, extended baseline dir).

---

## Verification strategy

1. **Snapshot the current composed prompts** for all six purposes before any code changes. Reuse `scripts/snapshot-prompts.js` from PR 1; write to `tests/.tmp-prompt-snapshots/pre-partials/`.
2. **Per-purpose section-marker tests** in `tests/system-prompt-partials.test.js`:
   - For each purpose, the composed prompt contains every block marker present in the pre-PR baseline (`<bundle_fields>`, `<phase name="open_reaction">`, `<phase name="entry_hunt">`, `<anti_patterns>`, `<ict_vocabulary>`, `<examples>`, `<output_json>`, `## ALERT GUIDANCE`, `## PERSISTENT MEMORY GUIDANCE`).
   - For each purpose, the composed prompt also contains the phase-unique markers (e.g. brief's `<phase name="brief">`, catch-up's `<phase name="catch_up">`).
   - The ordering of markers in the composed prompt matches the ordering in the baseline.
3. **Trigram overlap ≥ 99.5%** against `pre-partials/` baseline via the existing `scripts/diff-prompt-shape.js`. Stricter than PR 1's 99% because pure dedup should produce no fabricated content.
4. **Smoke fixtures** (`npm run smoke:fixtures`) must stay 16/16.
5. **Unit suite** (`npm run test:unit`) must stay 360/1 (or improve).
6. **Manual smoke**: Electron boot, observe the `[sdk] init ok, prompt length (<purpose>) N` log line for at least bar-close and brief. N must match pre-PR baseline within ±50 bytes (whitespace tolerance).
7. **No-duplicate test**: for each composed prompt, assert each extracted partial's first-line marker appears exactly once (catches accidental double-include if the marker logic regresses).

---

## Loader changes (`app/main/sdk.js`)

Existing in PR 1:
- `_promptCache: Map<absPath, {text, mtime}>` for hot-reload with last-known-good fallback.
- `loadPromptFile(absPath, label)` helper.
- `loadSystemPrompt(purpose)` reads kernel + phase, returns composed string.

New for PR 2 — added to a new pure helper module `app/main/prompt-composer.js` (so it can be unit-tested without booting Electron / the SDK / Zod):
- `PARTIAL_MARKER_RE = /<!-- @partial:([a-z0-9-]+) -->/g` — regex for marker discovery.
- `findPartialReferences(body)` — returns ordered array of unique partial names referenced; throws if any name appears twice.
- `composePhaseWithPartials(body, partialContents)` — `partialContents` is `Map<name, string>`. Returns body with each marker replaced by its corresponding string. Throws if a referenced partial is missing from the map.

`loadSystemPrompt(purpose)` in `app/main/sdk.js` extended:
- Reads phase file (no frontmatter parsing change — frontmatter still flat `description:` only).
- Calls `findPartialReferences(body)` to get names.
- For each name, reads `partials/<name>.md` via existing `loadPromptFile`.
- Calls `composePhaseWithPartials(body, partialContents)`.
- Returns `memory + kernel + "\n\n" + composedPhase`.

Cache: each partial is its own `loadPromptFile` call → same mtime cache → no extra disk I/O on unchanged turns.

Error handling: if a declared partial cannot be read (file missing, empty after mtime stat), use the last-known-good copy from `_promptCache`; if there isn't one, throw — there is no acceptable fallback because the composed prompt would be missing a load-bearing section.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Partial accidentally not referenced by a phase that needs it | Per-purpose section-marker tests fail loudly on missing blocks |
| Ordering drift (partial inserted in wrong position) | Marker-order test + trigram-overlap diff against pre-PR baseline |
| Marker name typo (e.g. `@partial:bundle_fields` instead of `bundle-fields`) | Loader throws "no partial file for name X" with the file path — easy to spot |
| Path-traversal via marker name | Marker regex whitelists `[a-z0-9-]+` only; no slashes, no dots, no uppercase |
| Loader reads a partial mid-edit | Existing `_promptCache` mtime + `PROMPT_MIN_LENGTH` guard from PR 1 |
| Same marker accidentally written twice in one phase file | `findPartialReferences` throws on duplicate within a file |
| Partial file accidentally pasted back into a phase file body | No-duplicate test asserts each extracted section's first-line marker appears exactly once per composed prompt |

---

## Out of scope

- **Token-cost reduction.** Composed prompt is identical to today; per-turn token budget unchanged. A future PR could drop ict_vocab or examples per-purpose if telemetry shows they aren't needed for that purpose's quality — but that needs separate analysis and is *not* loss-free.
- **`Skill` tool wiring.** Would require adding `Skill` to allowedTools, exposing `.claude/skills/`, and teaching the model when to invoke. Risky for load-bearing content like examples.
- **Cache breakpoint placement fix.** PR 3's job.
- **Content edits** to any block being extracted. Pure mechanical extraction. If a content edit is needed, do it in a separate commit *after* PR 2 lands.

---

## Acceptance criteria

PR 2 ships when ALL of:

- [ ] Nine partial files created under `app/main/prompts/partials/`, each byte-identical to the block it replaces.
- [ ] Six phase files updated to embed `<!-- @partial:NAME -->` markers in place of the extracted blocks.
- [ ] `loadSystemPrompt(purpose)` composes phase + partials per the spec.
- [ ] All six purposes' composed prompts pass trigram overlap ≥ 99.5% against pre-PR baseline (target: byte-identical modulo trailing whitespace).
- [ ] Per-purpose section-marker tests + no-duplicate tests pass.
- [ ] `npm run smoke:fixtures` passes 16/16.
- [ ] `npm run test:unit` passes (no regression vs current 360/1).
- [ ] Manual smoke: Electron boot + brief turn + bar-close turn, prompt-length logs within ±50 bytes of pre-PR baseline.
- [ ] CLAUDE.md gains an architecture-decision row for PR 2.
- [ ] PR opened on `feat/prompt-partials-extraction` branched off current `main`.

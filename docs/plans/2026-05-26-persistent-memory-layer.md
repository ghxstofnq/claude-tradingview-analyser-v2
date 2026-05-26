# Persistent Memory Layer — Implementation Plan

**Goal:** add cross-day persistent memory for the in-app Claude session, modeled on Hermes Agent's memory architecture. Claude restarts blank every morning today; this PR makes him remember trader preferences and cross-day market lessons across sessions.

**Architecture:** four Hermes-inspired layers, one PR:
1. Two char-capped Markdown files in `state/memory/` (`USER.md` + `MEMORY.md`)
2. Frozen-snapshot injection into the per-purpose system prompt, byte-stable per `userTurn` (prefix-cache friendly)
3. A `memory` MCP tool exposed to chat / wrap / review purposes only
4. A post-wrap "review" turn — auto-fires after each session wrap to extract durable lessons into memory

**Tech stack:** existing Electron main process, Node ESM, the existing `@anthropic-ai/claude-agent-sdk` integration in `app/main/sdk.js`, `node:test` + `node:assert/strict`.

**Authority:** [docs/research/hermes-memory-architecture.md](../research/hermes-memory-architecture.md) for the Hermes findings; [docs/research/ai-consistency.md](../research/ai-consistency.md) for prompt-engineering best practices; Anthropic's consolidated prompting guide for Opus 4.7's literal-instruction-following behaviour.

---

## Why this is safe (research / strategy check)

- **`docs/research/ai-consistency.md`** — Anthropic's prefix cache TTL is 5 minutes. Mid-session prompt changes force re-encodes. Hermes' frozen-snapshot pattern is the canonical fix. Our `xhigh` effort setting (PR #56) amplifies this; per-turn re-encoding becomes meaningful budget at high effort.
- **`docs/research/ai-trading-analysis.md`** — adds a layer of persistent context the model reads but doesn't write to mid-bar-close. No conflict with the cite-or-reject rule (memory is not bundle data; it is qualitative cross-day context). No conflict with no-arithmetic (memory contents are declarative facts, not numeric computations).
- **`docs/strategy/trading-strategy-2026.md`** — strategy is silent on cross-day memory. The trader's preferences (sizing, sessions, instruments) and durable market patterns (PCE-day chop, NY-AM-fades-after-fast-Asia, etc.) are real signals that aren't in the strategy spec. Memory captures them outside the strategy without contradicting it.
- **Naming collision check** — existing `app/main/session-memory.js` handles *intra-day per-session* files (pillar1.md, brief.json, etc.). The new module is named `app/main/persistent-memory.js` to keep the cross-day vs intra-day distinction obvious.

## Convention decisions

- **Cross-day memory lives in `state/memory/`** (gitignored — `state/` is already in `.gitignore`).
- **Two targets, mirroring Hermes:** `user` = trader profile (preferences, sizing, instruments traded, schedule); `memory` = cross-day market lessons + agent-side observations.
- **Char limits, not token limits:** 2000 for `MEMORY.md`, 1500 for `USER.md`. Model-independent.
- **`§\n` delimiter** between entries (multiline-safe).
- **Substring matching** for replace/remove, not IDs. Direct port of Hermes' UX.
- **Per-`userTurn` re-read:** memory loads from disk at the start of each `userTurn`, gets frozen for the duration of that turn, then re-reads for the next turn. Prefix cache hits when the bytes are identical (i.e., no write happened between turns). Cache misses once when a write lands, then warms again. This is the right trade for our cadence — bar-close fires 1/min, chat is sparse.
- **Tool exposure is purpose-scoped:** chat / wrap / review purposes can write memory; brief / bar-close / catch-up purposes are read-only (no tool exposed). This prevents a 420×/day write surface from bar-close.
- **Review turn fires once per session wrap.** Not after every turn (Hermes' default). Our wrap cadence is 3-4 times per day vs Hermes' chat cadence; once per wrap is enough.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `app/main/persistent-memory.js` | **new** | The `PersistentMemory` class: file I/O, atomic writes, char-cap enforcement, external-drift detection, snapshot rendering. Pure module — no Electron, no MCP. |
| `app/main/sdk.js` | edit | (a) Load persistent memory at the start of each `userTurn`, prepend `<persistent_memory>` block to the system prompt; (b) register the `memory` MCP tool with the per-purpose tool whitelist; (c) add the `review` purpose to `PROTOCOL_BY_PURPOSE` with `REVIEW_PROTOCOL` and `MEMORY_GUIDANCE` fragments; (d) compose `MEMORY_GUIDANCE` into `chat` and `wrap` protocol fragments. |
| `app/main/session-wrap.js` | edit | Fire a follow-up `userTurn` with `purpose: "review"` after the wrap turn successfully calls `surface_session_summary`. |
| `app/main/session-brief.js` | edit | Read the last 5 days of `state/session/<date>/<session>/summary.md` files (where they exist) and inject as a `<recent_sessions>` block in the brief turn's user message. |
| `tests/persistent-memory.test.js` | **new** | Unit coverage for the store: add / replace / remove, char-cap enforcement, atomic writes, external-drift detection, snapshot rendering with usage indicator. |
| `state/memory/` | runtime | Directory created on first write. `USER.md` + `MEMORY.md` files created lazily. Both gitignored. |
| `CLAUDE.md` | edit | Add a decision-row entry for the persistent-memory layer; add a section under "Layout" pointing at `state/memory/`. |

No changes to: `cli/`, `tests/fixtures/`, `app/main/prompts/analyze.md`, `app/main/bar-close.js` (bar-close is read-only for memory), `app/renderer/`.

---

## Phase 1 — The persistent-memory module

**File:** `app/main/persistent-memory.js` (new)
**Test:** `tests/persistent-memory.test.js` (new)

A self-contained, fully unit-tested pure module. Ships independently of the SDK wiring.

### Task 1.1 — Class skeleton + read

- [ ] Export class `PersistentMemory` with constructor accepting `{ memoryCharLimit = 2000, userCharLimit = 1500, baseDir }`.
- [ ] `async load()` — read `<baseDir>/MEMORY.md` and `<baseDir>/USER.md`; populate `memoryEntries` and `userEntries` arrays (split by `\n§\n`, trim, drop empty); capture frozen `_snapshot` with rendered blocks.
- [ ] `formatForSystemPrompt(target)` — return the frozen snapshot block for `"memory"` or `"user"`, or `null` if empty. Header line includes usage indicator: `MEMORY (cross-day notes) [42% — 856/2000 chars]`.

### Task 1.2 — Mutating actions

- [ ] `async add(target, content)` — append a new `§`-delimited entry. Refuse if it would exceed the char cap; return structured error JSON with `current_entries` + `usage`. Reject exact duplicates. Atomic write via `.tmp` + rename.
- [ ] `async replace(target, oldText, newContent)` — locate the entry containing `oldText` (substring match). Refuse on ambiguous match (multiple non-identical entries match). Refuse if replacement would exceed cap.
- [ ] `async remove(target, oldText)` — same matching rules; remove the entry.
- [ ] Returns: all mutating actions return `{ success, target, entries, usage, entry_count, message }` matching Hermes' shape verbatim — keeps the tool's response schema consistent.

### Task 1.3 — External-drift detection + atomic writes

- [ ] Before any write, `_detectExternalDrift(target)` checks whether the on-disk file's content round-trips through our parser/serializer AND whether any single parsed entry exceeds the char cap. Either signal indicates external writer touched the file (manual edit, sister process). Refuse the write and back up to `<file>.bak.<ts>`. Mirror Hermes' `_drift_error` response shape.
- [ ] Atomic write: write to `<file>.tmp` then `fs.rename`. Readers either see the old file or the new file, never partial. Matches the project's existing pattern (`utils/atomicWrite` etc).
- [ ] No file-level OS locking in v1 — Electron main process is single-threaded JS; our mutex (`_turnInFlight` in `sdk.js`) already serializes all writes. Document this assumption in code comments.

### Task 1.4 — Tests

- [ ] `add` increments entries, returns usage.
- [ ] `add` refuses duplicate.
- [ ] `add` refuses cap overflow with structured error.
- [ ] `replace` substring-matches; refuses ambiguous match.
- [ ] `remove` works on substring match.
- [ ] `formatForSystemPrompt` returns frozen snapshot with header; returns null on empty.
- [ ] Atomic write: tempfile present mid-write, renamed at end.
- [ ] External-drift detection: writing a file with a >cap entry → tool refuses, backup exists.
- [ ] Snapshot is frozen — adding mid-test doesn't change `formatForSystemPrompt` until reload.

---

## Phase 2 — Wire into the SDK

**File:** `app/main/sdk.js` (edit)

### Task 2.1 — Load + inject

- [ ] At module init, instantiate one `PersistentMemory` keyed to `state/memory/`.
- [ ] In `runOneTurn` (start of each `userTurn`), call `memory.load()` so the snapshot is fresh for the turn but byte-stable across the turn.
- [ ] Inject the snapshot into `loadSystemPrompt(purpose)`: prepend a `<persistent_memory>` block (containing the `user` block + the `memory` block, rendered with the header indicators) before the `analyze.md` base. This puts memory in the most cache-stable position — first content in the prompt.
- [ ] If both blocks are empty, omit the `<persistent_memory>` block entirely. No empty tag.

### Task 2.2 — The `memory` tool

- [ ] Register `mcp__tv__memory` in `buildMcpServer()`, alongside the existing surface / alert tools.
- [ ] Tool shape (Zod schema): `{ action: enum["add","replace","remove"], target: enum["memory","user"], content?: string, old_text?: string }`.
- [ ] Tool description: the behavioral guidance prompt (adapted from Hermes' `MEMORY_SCHEMA` description for our trading domain). Full text in Phase 3 below.
- [ ] Handler delegates to the `PersistentMemory` instance; returns the JSON result.

### Task 2.3 — Per-purpose tool whitelist

- [ ] Modify `_allowedToolNames` to be a *function of purpose* not a flat array. Each purpose gets a different whitelist:
  - `chat` + `wrap` + `review`: existing tools + `mcp__tv__memory`
  - `brief` + `bar-close` + `catch-up`: existing tools, NO memory
- [ ] In `runOneTurn`, pass the purpose-specific whitelist to `query()` instead of the global one.

### Task 2.4 — `MEMORY_GUIDANCE` + `REVIEW_PROTOCOL` fragments

- [ ] Add new prompt fragment `MEMORY_GUIDANCE` (the declarative-vs-imperative rule, the skip list). Full text in Phase 3.
- [ ] Add new prompt fragment `REVIEW_PROTOCOL` (instructions for the post-wrap review turn — the "be active, save lessons, not session artifacts" prompt).
- [ ] Add `"review"` to `PROTOCOL_BY_PURPOSE`: `CORE_PROTOCOL + REVIEW_PROTOCOL + MEMORY_GUIDANCE` (no analysis, no alerts).
- [ ] Compose `MEMORY_GUIDANCE` into the existing `chat` and `wrap` purpose fragments.
- [ ] No changes to `bar-close` / `catch-up` / `brief` — read-only, no guidance needed.

---

## Phase 3 — The prompts

These are the load-bearing parts. Full text proposed below; tunable during implementation.

### The tool description (in `sdk.js` tool registration)

```
Save durable facts to persistent memory that survives across trading days.
Memory injects into every future session as part of the system prompt — keep
it compact, declarative, and focused on facts that will still matter in a week.

WHEN TO SAVE (proactively, don't wait to be asked):
- Trader corrects you ("stop calling tiny FVGs A+", "I don't trade Mondays")
- Trader expresses a preference (sizing rule, sessions traded, instruments to skip)
- A cross-day market pattern surfaces (e.g. PCE-day chop, NY AM fades after fast Asia)
- You learn a chart-reading nuance specific to this trader's setup

PRIORITY: trader corrections + preferences > cross-day market patterns > facts
about the trader's environment. The most valuable memory is one that prevents
the trader from having to remind you again.

DO NOT save:
- Today's setups / today's PnL / today's session outcomes — those live in
  state/session/<date>/<session>/summary.md
- Specific PR numbers, commit SHAs, file counts, anything stale in a week
- Single-occurrence chart events that resolved
- Negative claims about indicators or tools ("the engine is broken")
- One-off task narratives ("the trader asked about MES today")

DECLARATIVE PHRASING (important): write memories as facts, not directives.
- "Trader uses structural stops below the FVG low" ✓
- "Always set stops below the FVG low" ✗
- "Trader skips Wednesdays during FOMC weeks" ✓
- "Don't trade Wednesdays" ✗
Imperative phrasing gets re-read as a standing order every turn — it can
override the trader's current request. Facts are applied contextually.

TWO TARGETS:
- target="user" → who the trader is (preferences, schedule, instruments, style)
- target="memory" → cross-day lessons (recurring patterns, durable observations)

ACTIONS:
- add: append a new entry
- replace: find existing entry by old_text (unique substring), replace it
- remove: find by old_text, delete

If a write would exceed the char limit, the tool refuses and tells you which
entries to remove first.
```

### `MEMORY_GUIDANCE` (system-prompt fragment for chat / wrap / review)

```
You have persistent memory across trading days (the <persistent_memory>
block at the top of this prompt). Save durable facts using the memory tool:
trader preferences, recurring market patterns, instrument quirks, stable
rules.

Memory is part of the system prompt on every future session — keep it
compact and focused on facts that will still matter in a week.

Prioritize what reduces future correction — the most valuable memory is one
that prevents the trader from having to remind you again. Trader corrections
and preferences matter more than market trivia.

Do NOT save today's setups, today's PnL, "fixed bug X", "session X wrapped"
— those live in state/session/<date>/<session>/summary.md. If a fact will
be stale in a week, it does not belong in memory.

Write memories as declarative facts, not instructions to yourself. "Trader
uses structural stops" ✓ — "Always use structural stops" ✗. Imperative
phrasing gets re-read as a standing order in later sessions and can override
the trader's current request.
```

### `REVIEW_PROTOCOL` (system-prompt fragment for the review purpose)

```
This is a session-review turn. The session just wrapped — its summary.md
and setups.jsonl are on disk. Your job is to extract anything worth
remembering across days.

Be ACTIVE. Most sessions produce at least one update. A pass that does
nothing is a missed learning opportunity, not a neutral outcome.

Read first:
1. <sdir>/summary.md (just written)
2. <sdir>/setups.jsonl
3. Existing persistent memory (already in your system prompt as
   <persistent_memory>)

Signals that warrant a memory update (any one is enough):
- Trader revealed a preference, schedule, or rule that wasn't in memory yet
- Trader corrected your grading, sizing, or reading of a setup
- A market pattern recurred across days (not just today — at least 2-3
  occurrences in recent memory or your own observation)
- A setup type repeatedly failed or succeeded in a way that should bias
  future grading
- You discovered a chart-reading nuance specific to this trader's setup

Do NOT save:
- "Today's NY AM wrapped" / "Setup X fired" — that's what summary.md is for
- Today's specific prices, today's session IDs
- Single-occurrence events that resolved
- Negative claims about indicators or tools

Write memory as declarative facts, not directives. "Trader skips PCE days" ✓
— "Don't trade on PCE days" ✗.

"Nothing to save" is a real option but should NOT be the default. If
genuinely nothing stands out, say "Nothing to save." and stop. Otherwise,
use the memory tool to write what you found.

Do NOT call any surface_* tool in this turn — review is memory-only.
```

---

## Phase 4 — Wire the post-wrap review turn

**File:** `app/main/session-wrap.js` (edit)

### Task 4.1 — Fire-after-wrap

- [ ] In the existing `_driver` config (or its `postValidate` hook), add a callback that runs after the wrap turn's `turn_complete` event AND the wrap successfully called `surface_session_summary`.
- [ ] The callback fires a new `userTurn` with `purpose: "review"` and a short user message:

```
Review the ${SESSION} session that just wrapped. Read <sdir>/summary.md and
<sdir>/setups.jsonl, then update persistent memory per your system prompt
guidance.
```

- [ ] Use `tightTimeout: 60_000` — review turns are bounded; failure shouldn't block the next session.
- [ ] Record a metric: `recordMetric({ kind: "review", event: "started", session })`. Match the existing brief / wrap / bar-close metric pattern.

### Task 4.2 — Safety guards

- [ ] If `surface_session_summary` was NOT called (wrap turn failed validation), skip the review. The metric records `event: "skipped"`.
- [ ] If memory is at >90% capacity for either target, the review turn's user message includes a hint: "memory is at <N>% — consider consolidating before adding". (The model may opt to replace existing entries instead of adding new ones.)

---

## Phase 5 — Pre-session recent-context injection (brief turn)

**File:** `app/main/session-brief.js` (edit)

The cheap approximation of Layer 5 (FTS5 session search). Inject the last 5 days of session summaries into the brief turn so Claude sees yesterday's verdict and recent patterns before grading today.

### Task 5.1 — Read recent summaries

- [ ] Helper function: `readRecentSessions(maxDays=5)` reads `state/session/<date>/<session>/summary.md` for the last 5 calendar days that have a folder. Returns an array of `{ date, session, summary_text }` entries.
- [ ] Skip days with no folder. Skip sessions without `summary.md` (e.g., a session that didn't wrap because of an app restart).
- [ ] Cap total injected text at ~4000 chars; truncate oldest first if over.

### Task 5.2 — Inject into the brief turn's user message

- [ ] Prepend the brief turn's user message with a `<recent_sessions>` block:

```
<recent_sessions>
For cross-session context — what the model saw and graded over the last few
days. Use this to spot recurring patterns and to avoid contradicting recent
verdicts without good cause.

2026-05-25 ny-am
<summary text, abbreviated to first paragraph if long>

2026-05-25 ny-pm
<summary text>

...
</recent_sessions>

<existing brief turn user message>
```

- [ ] If no recent summaries exist (fresh project), omit the block.

---

## Phase 6 — `CLAUDE.md` update

**File:** `CLAUDE.md` (edit)

### Task 6.1 — Architecture decision row

Add to the decisions table:

```
| 2026-05-26 | Persistent memory layer (cross-day) | Adds `state/memory/{USER.md, MEMORY.md}` with frozen-snapshot injection + a `memory` MCP tool. Modeled on Hermes Agent — see [docs/research/hermes-memory-architecture.md](docs/research/hermes-memory-architecture.md). Closes the cross-day gap: until this PR Claude restarted blank every morning. |
```

### Task 6.2 — Layout section

Add `state/memory/` to the layout map under `state/`:

```
state/
  ...
  memory/                      gitignored; created on first write
    USER.md                    trader profile (preferences, schedule, instruments)
    MEMORY.md                  cross-day market lessons + observations
  ...
```

---

## Verification

### Local tests

- [ ] `npm run test:unit` — 96 existing + the new persistent-memory tests, all pass.
- [ ] `npm run smoke:fixtures` — 6/6, no change (memory isn't in citation paths).

### Live observation (post-merge)

- [ ] One trading day, NY AM + NY PM:
  - Trigger 1+ chat turn where the trader corrects the model. Verify `state/memory/USER.md` gets an entry.
  - Wrap fires. Review turn fires next. Inspect: did Claude write anything? Was it declarative?
  - Next day pre-session brief. Verify the `<recent_sessions>` block contains the prior day's summaries. Verify the system prompt includes the `<persistent_memory>` block.
  - Cost check: per-turn token cost. Compare to a baseline turn without memory. Memory adds ~2-4KB to the prompt; we expect cache hits on second and subsequent turns of each session purpose.

### Rollback plan

- If memory injection breaks something subtle (cache misses, content drift, behavior shift), revert the SDK changes only — the standalone module + its tests can stay. Single-line revert: comment out the `<persistent_memory>` injection in `loadSystemPrompt`. Tool registration stays disabled until re-enabled.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Memory mid-session writes invalidate prefix cache more than expected | Medium | Per-`userTurn` re-read keeps the snapshot byte-stable across a turn; only writes from chat/wrap cause invalidation, and those fire infrequently vs bar-close. |
| Bar-close cost rises measurably | Low | Memory is read-only for bar-close; the file content is small (~3-5KB). Cache hits on every consecutive bar-close turn until a chat write lands. |
| Review turn produces noise (saves session artifacts despite the prompt) | Medium | Tool description + REVIEW_PROTOCOL both list the skip list explicitly. Iterate the prompt if the first few reviews drift. Char cap also bounds damage — bad entries can be `remove`d. |
| External-drift detection false-positive (trader hand-edits MEMORY.md correctly) | Low | Drift detection only triggers when content wouldn't round-trip through the parser/serializer OR an entry exceeds the cap. A correctly-formatted hand edit (entries separated by `§\n`, each under cap) round-trips fine. |
| Memory contradicts the strategy spec or CLAUDE.md hard constraints | Medium | Memory is BELOW system-prompt rules in the prompt assembly; CLAUDE.md constraints + analyze.md rules win. Any contradiction the trader sees, they can `memory(action="remove", ...)` via chat. |
| Snapshot drift between sessions (chat session sees write, bar-close doesn't until next turn) | Low | Acceptable — bar-close runs every minute; one-bar delay for memory updates is fine. |

---

## What's NOT in this PR

Explicitly deferred to keep scope tight:

- **FTS5 session search** — full conversation-history indexing. Phase 5 (recent-summary injection) covers the highest-value query with much less plumbing. Re-evaluate once we have a baseline of cross-session calls.
- **Context compression** — our chat sessions don't routinely exceed limits today. When we add it, adopt Hermes' compression-summary fencing language verbatim.
- **External memory providers** (Honcho / Mem0 / etc.) — single-user desktop app doesn't need them.
- **Threat scanning** of memory contents — our memory inputs come from the trader and Claude only; no untrusted observed content. Risk profile doesn't justify the complexity.
- **`<memory-context>` streaming sanitizer** — we don't fence memory in the UI; no leakage path.
- **Skills system** (background curator agent for skill maintenance) — we don't have skills the way Hermes does. Our "skills" are baked into the strategy spec.
- **Per-bar-close memory writes** — explicitly avoided. 420×/day write surface is wrong; review-once-per-wrap is sufficient.

---

## Self-review

- **Spec coverage:** four Hermes layers (1-4 + 6) ported with our scope; layers 5 / 7 / 8 deferred with stated reasons.
- **Single-PR scope:** 5 files changed, 1 new file, 1 new test file, ~600 LOC estimated. Reviewable in one sitting.
- **No code semantics changed downstream:** gates / parser / verifier / unit tests of existing modules unchanged.
- **Memory doesn't break existing citations:** memory is prompt-side context, not bundle data; `scripts/verify-citations.js` ignores it.
- **Rollback is single-line.**
- **Authority cited:** Hermes architecture doc + Anthropic prompting guide + research base.
- **Naming-collision check passed:** new module is `persistent-memory.js`; existing `session-memory.js` (intra-day) stays distinct.

---

## Implementation order (suggested)

Logical dependency order for the actual coding:

1. Phase 1 (module + tests) — foundation, no downstream deps
2. Phase 2.1 + 2.2 (load + inject + tool registration) — depends on Phase 1
3. Phase 3 (prompts) — content tweak, no infra
4. Phase 2.3 (per-purpose tool whitelist) — small but lets us prove memory tool works in chat
5. Phase 2.4 (review purpose + protocol fragments)
6. Phase 4 (wire post-wrap review fire)
7. Phase 5 (recent-context injection in brief)
8. Phase 6 (CLAUDE.md)
9. Verification — `test:unit`, `smoke:fixtures`, manual trace, git diff review

Estimated total work: **1.5 - 2 days of focused implementation + 1 trading day of live observation.**

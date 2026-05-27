# Prompt Kernel Split — Design

**Date:** 2026-05-27
**Status:** Spec, pending plan
**Driver:** Today's system prompt is a 66 KB / ~16,500-token monolith (`app/main/prompts/analyze.md`) shipped to every turn regardless of purpose. Research (Hermes Agent architecture + Anthropic context-engineering guidance) found 20.6 KB of dead code and structural mis-fit between content scope and turn purpose.

## Goal

Split `app/main/prompts/analyze.md` into a shared kernel + one phase file per purpose. Delete two dead sections (~20 KB). **Loss-free behavior** — same model output for the same inputs.

This is PR 1 of a 3-PR sequence:
- **PR 1 (this spec):** kernel split + dead code removal
- PR 2 (deferred): extract examples + vocabulary to Claude Code Skills
- PR 3 (deferred): fix cache-breakpoint placement + `excludeDynamicSections`

## Why now

1. **Dead code shipping every turn.** `<phase name="entry_hunt_legacy_DISABLED">` (14,177 chars) was marked DISABLED months ago and never removed. `<phase name="pre_session">` (6,440 chars) was replaced by the brief turn months ago and is no longer routed to. Together: 20,617 chars (~31% of the prompt) shipped on every turn for zero behavior.

2. **Context rot.** Anthropic's published anti-pattern: as context grows, model recall degrades. Chroma's July-2025 study measured 13.9-85% accuracy drops as context grows even with perfect retrieval. Our worked examples sit in the U-curve middle (positions 5-15) where lost-in-the-middle drops are worst.

3. **Per-purpose mis-fit.** A `chat` or `review` turn never reads the engine bundle, never grades a setup, never walks the 7-step checklist — but ships the full bundle_fields, ict_vocabulary, examples, anti_patterns, and entry_hunt phase block on every message. Roughly 90% of the prompt is irrelevant for those purposes.

4. **Research backing.** Anthropic's Agent SDK `preset + append` pattern explicitly endorses per-purpose system prompts ([modifying-system-prompts docs](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)). Hermes Agent's three-tier prompt structure (stable / context / volatile) is the canonical organization. The components exist — they're just composed wrong today.

## Approach

Two-file composition per purpose:

```
memory_block (frozen-snapshot)  +  kernel.md  +  phase-<purpose>.md
```

The **kernel** holds what every purpose needs: 8 rules, strategy authority, compressed phase-routing table. The **phase file** for each purpose holds what THAT purpose needs: its phase block, the protocol fragments it uses, and any vocabulary / examples / anti-patterns relevant to its work.

Duplication across phase files is intentional: each phase file is self-contained and editable independently. Disk cost is trivial; cognitive cost of cross-file coupling is not.

## File layout

```
app/main/prompts/
  kernel.md             # ~3 KB, shared by all 6 purposes
  phase-bar-close.md    # ~15 KB (entry_hunt + open_reaction + vocab + examples + anti_patterns)
  phase-brief.md        # ~10 KB
  phase-catch-up.md     # ~5-8 KB (catch_up + entry_hunt fallthrough content)
  phase-wrap.md         # ~1.5 KB
  phase-chat.md         # ~1 KB
  phase-review.md       # ~2 KB
```

Flat layout, no nesting. `analyze.md` is deleted after migration.

## Composition logic

`loadSystemPrompt(purpose)` in `app/main/sdk.js` changes:

**Before:**
```
memPrefix + base(analyze.md, 66 KB) + protocol_fragment(from PROTOCOL_BY_PURPOSE)
```

**After:**
```
memPrefix + kernel.md + phase-<purpose>.md
```

The code-side `PROTOCOL_BY_PURPOSE` map and its constituent string fragments (`CORE_PROTOCOL`, `ANALYSIS_PROTOCOL`, `BRIEF_PROTOCOL`, `WRAP_PROTOCOL`, `ALERTS_PROTOCOL`, `MEMORY_GUIDANCE`, `REVIEW_PROTOCOL`) are removed from `sdk.js`. Those fragments move into the per-purpose `.md` files. Each phase file becomes the single source of truth for "what does this purpose need."

Hot-reload behavior:
- The existing `_lastGoodBase` + `_lastGoodMtime` mechanism becomes a `Map(purpose → {kernelText, kernelMtime, phaseText, phaseMtime})`
- Mtime is checked on each file independently
- The existing `PROMPT_MIN_LENGTH` (1000) and `PROMPT_MAX_LENGTH` (500_000) bounds apply per file
- Mid-edit torn-read falls back to last-known-good per file

## What goes where

### Content sections from `analyze.md`

| Original section | Chars | Destination |
|---|---|---|
| preamble | 219 | kernel.md |
| strategy_authority | 807 | kernel.md |
| how_to_run | 1,079 | kernel.md (compressed to ~400 chars — two capture commands + when-to-use note only) |
| bundle_fields | 5,651 | phase-bar-close.md, phase-brief.md, phase-catch-up.md |
| rules (the 8 rules) | 2,180 | kernel.md |
| phase_routing | 1,825 | kernel.md (compressed to ~500 chars — routing table + one-sentence brief-turns clarification) |
| phase:pre_session | 6,440 | **DELETE** (replaced by brief turn) |
| phase:brief | 9,619 | phase-brief.md |
| phase:open_reaction | 5,187 | phase-bar-close.md, phase-catch-up.md |
| phase:entry_hunt | 2,702 | phase-bar-close.md |
| anti_patterns | 2,281 | phase-bar-close.md, phase-catch-up.md |
| phase:entry_hunt_legacy_DISABLED | 14,177 | **DELETE** |
| phase:catch_up | 2,083 | phase-catch-up.md |
| phase:post_session | 1,502 | phase-wrap.md |
| phase:other (London optional) | 772 | phase-wrap.md |
| ict_vocabulary | 2,221 | phase-bar-close.md, phase-brief.md, phase-catch-up.md |
| examples (worked A+ / B / no-trade) | 6,509 | phase-bar-close.md, phase-catch-up.md |
| output_json | 629 | phase-bar-close.md, phase-catch-up.md |

### Code-side fragments from `sdk.js`

| Fragment | Approx chars | Destination |
|---|---|---|
| CORE_PROTOCOL | ~500 | every phase file (universal) |
| ANALYSIS_PROTOCOL | ~1,000 | phase-bar-close.md, phase-catch-up.md |
| BRIEF_PROTOCOL | ~700 | phase-brief.md |
| WRAP_PROTOCOL | ~300 | phase-wrap.md |
| ALERTS_PROTOCOL | ~1,200 | phase-bar-close.md, phase-brief.md, phase-chat.md |
| MEMORY_GUIDANCE | ~800 | phase-chat.md, phase-wrap.md, phase-review.md |
| REVIEW_PROTOCOL | ~1,500 | phase-review.md |

### Compressions (exact text to be specified in the plan)

- **how_to_run** (1,079 → ~400 chars): keep the two capture commands (`./bin/tv analyze --out ...` and `./bin/tv analyze --pillar3-only --baseline ...`) and one sentence on when each runs. Cut: the multi-paragraph polling/baseline-reuse discussion (already covered in `bundle_fields` for the analysis purposes that need it).
- **phase_routing** (1,825 → ~500 chars): keep the routing table + the one-sentence brief-turns clarification. Cut: the file-layout explanation paragraphs (move that into the phase files where it's actually used).

## Expected savings

Composition for each purpose is `kernel.md (~4 KB) + phase-<purpose>.md`. Per-purpose phase-file sizes computed from the content-section table above:

| Purpose | Today (KB) | After (KB) | Reduction |
|---|---|---|---|
| chat | 66 | ~7 | ~10× |
| review | 66 | ~7 | ~10× |
| wrap | 66 | ~8 | ~8× |
| brief | 66 | ~24 | ~2.7× |
| bar-close | 66 | ~32 | ~2× |
| catch-up | 66 | ~31 | ~2.1× |

The low-frequency purposes (chat / review / wrap) see the biggest multipliers because they shed all the analysis content. The high-frequency `bar-close` turn shows the smallest multiplier but still drops 34 KB — and it fires ~420×/day, so the absolute savings dominate.

At $0.50/MTok cache-read for Opus 4.7, dropping ~8,500 tokens of standing prompt on bar-close saves ~$0.004/turn. ~420 bar-close turns/day × $0.004 ≈ $1.70/day from bar-close alone; chat / wrap / review / brief / catch-up add the remainder. Realistic estimate: **~$2/day, ~$700/year** on prompt-token cost. Plus accuracy lift from killing context rot in the U-curve middle (not directly priced).

Note: the lion's share of the savings is the 20.6 KB dead-code deletion — that's flat across every purpose. The per-purpose split gives proportionally more on chat / wrap / review than on the analysis purposes, but every turn benefits from the deletion.

## What does NOT change

- `app/main/persistent-memory.js` — memory architecture untouched
- `app/main/session-memory.js` — per-session pillar files untouched
- All per-turn user-message builders (`session-brief.js`, `bar-close.js`, `session-wrap.js`, `shutdown-flush.js`, `ipc.js` chat handler) — they keep building the same `text` blocks
- Tool definitions in `sdk.js` (`memory`, `surface_*`, `tv_analyze_*`, alerts) — untouched
- `scheduled-turn.js` driver — untouched
- Model selection (Opus for brief/wrap, Sonnet for everything else) — untouched
- The 8 rules themselves — copied verbatim to kernel.md, no semantic change
- The `<recent_sessions>` block injection for brief turns — stays in `session-brief.js`
- The `<candidate_object>` detector injection for entry-hunt — stays in `bar-close.js`

## Verification

1. **Smoke fixtures pass** — `npm run smoke:fixtures` green. Catches schema/citation drift if the model behaves differently with the split prompts.

2. **Trigram-overlap script** (new, `scripts/diff-prompt-shape.js`, ~50 LOC) — captures the OLD composed prompt for each purpose to disk before the split (via `scripts/snapshot-prompts.js`), then diffs against the NEW live `loadSystemPrompt(purpose)` output. Reports per-purpose trigram overlap: for every 3-char window in the new prompt, was it present anywhere in the old prompt? Acceptance: **≥80% trigram overlap** per purpose. (Character-by-character byte-overlap is the wrong metric here — chat/review/wrap legitimately drop ~90% of content; what we want to verify is that every trigram in the new prompt came verbatim from the old one — i.e. no fabrication during the split.)

3. **1-day live shadow** — run with the new prompts on a normal trading day. Compare `state/metrics.jsonl` rows before/after on `total_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. Cache hit rate should rise (prefix becomes more stable across purposes); total tokens should drop in line with the savings table above.

4. **Manual smoke** — fire one of each purpose manually:
   - Send a chat message → verify response
   - REFRESH the brief → verify brief lands in PREP panel
   - Wait for / trigger a bar-close → verify setup or no-trade surfaces
   - Trigger session wrap → verify summary.md lands + review fires
   - Confirm no `[sdk]` errors in the Electron console

## Risks

| Risk | Mitigation |
|---|---|
| Content duplicated across phase files (e.g. bundle_fields in three files) drifts out of sync over time | Document at the top of each duplicated section: "this block is mirrored in phase-X.md and phase-Y.md — edit all three". Optional follow-up: `scripts/check-prompt-consistency.js` that diff-checks duplicated sections in CI. |
| The 8 rules subtly depend on context that lives in the same file today, so isolating them in kernel changes semantics | Byte-compare verification + 1-day live shadow catch this. If smoke fixtures drift, rollback is one revert. |
| catch-up's content budget (~5 KB) is tight given it includes anti_patterns + examples | Re-measure during implementation. If over, accept ~8 KB for catch-up — still a 8× reduction from today. Update savings table after implementation. |
| Hot-reload race: two files modified mid-edit cause torn read | The existing `PROMPT_MIN_LENGTH` (1000) safety bound + last-known-good cache handles this. Two-file read happens atomically per purpose (one is the kernel, one is the phase file — both must be valid). |
| Behavior drift on a purpose we don't smoke-test in step 4 | The 1-day live shadow covers anything the manual smoke misses. Roll forward fixes; don't revert unless the metric drift exceeds 10%. |

## Out of scope (deferred to PR 2 / PR 3)

- Extracting examples + ict_vocabulary to Claude Code Skills with `description` + `when_to_use` metadata (PR 2)
- Skill-based progressive disclosure for entry-model examples (PR 2)
- Fixing cache-breakpoint placement so per-purpose content sits after the breakpoint (PR 3)
- Adding `excludeDynamicSections: true` to the SDK call (PR 3)
- Touching the per-turn user-message builders (out of scope across all 3 PRs)
- Changing the memory architecture or memory tool (out of scope)

## References

- [Hermes Agent — Memory System Architecture](../../research/hermes-memory-architecture.md) — three-tier prompt structure, frozen-snapshot pattern, char-capped memory
- [AI Command-Following Consistency](../../research/ai-consistency.md) — Tool Use Examples lift (72→90%), schema discipline
- [LLM Strategy Fidelity](../../research/2026-05-26-llm-strategy-fidelity.md) — strategy detector context (PR #62 reduced entry-hunt prompt from "walk from scratch" to "package detector verdict")
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — context rot, "smallest possible set of high-signal tokens"
- [Anthropic: Modifying system prompts (Agent SDK)](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts) — `preset + append` pattern
- [Anthropic: Prompt caching](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching) — cache economics + 20-block lookback
- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — reference implementation of Hermes patterns

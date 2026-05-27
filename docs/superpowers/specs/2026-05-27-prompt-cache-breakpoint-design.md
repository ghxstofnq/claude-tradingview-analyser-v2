# Prompt Cache Breakpoint — Design

**Date:** 2026-05-27
**Branch:** `feat/prompt-cache-breakpoint`
**Status:** Approved (design); plan + implementation pending.
**Predecessors:**
- [2026-05-27-prompt-kernel-split-design.md](2026-05-27-prompt-kernel-split-design.md) (PR 1 — shipped)
- [2026-05-27-prompt-partials-extraction-design.md](2026-05-27-prompt-partials-extraction-design.md) (PR 2 — shipped)

PR 3 of 3 closes the prompt-engineering series.

---

## Goal

Place an explicit prompt-cache breakpoint between the cross-purpose shared prefix (`memBlock + kernel`) and the per-purpose suffix (`composedPhase`). Today, every purpose's system prompt is a single concatenated string, so the Anthropic prompt cache treats each purpose independently — a chat turn between two bar-close turns burns the bar-close cache.

After PR 3, kernel + memBlock are cacheable across purposes. Per-purpose phase content sits after the boundary and doesn't pollute the shared prefix.

**Constraint: loss-free.** The bytes the model receives must be the same content as today, in the same order. The boundary marker is removed by the SDK before sending — model behavior unchanged.

**Win:** Significant cache-read input tokens on mixed-purpose sequences (chat ↔ bar-close ↔ brief). Anthropic prices cached input tokens at ~10% of fresh input cost; the kernel + memBlock prefix is ~6 KB of tokens that today are billed full price on every purpose switch.

**Non-goals:**
- Reordering memBlock vs kernel (would change bytes — loss-free violation).
- Cache-rate tracking in the dashboard (could be a follow-up).
- Multiple cache breakpoints via direct API access (the SDK's array+boundary mechanism gives one breakpoint; bigger refactor needed for more).
- Behavioral changes of any kind.

---

## Background

The Anthropic prompt cache hits when the prefix of a request matches a cached version byte-for-byte, up to a cache breakpoint. Today the system prompt is composed in `app/main/sdk.js#loadSystemPrompt` as:

```js
return memPrefix + kernel + "\n\n" + composedPhase;
```

This is sent to `query()` as a `string`. The Anthropic API treats the entire system prompt as a single unit, keyed by purpose because `composedPhase` differs per purpose. Mixed-purpose sequences pay the full input cost on each purpose switch.

The Claude Agent SDK (v0.2.98+, our version `^0.3.150`) exports a literal sentinel `SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"`. When `systemPrompt` is passed as a `string[]` with this sentinel as a standalone element:

> Blocks before the marker are eligible for cross-session prompt caching; blocks after it are not.

The marker is removed before sending to the API; only the cache_control breakpoint metadata survives.

`excludeDynamicSections` does not apply — it only affects preset (`claude_code`) system prompts. Our project uses a custom prompt.

---

## Composition mechanism

`loadSystemPrompt(purpose)` returns `string[]` instead of `string`:

```js
[
  // optional memBlock (only included if non-empty)
  memBlock,
  kernel,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  composedPhase,
]
```

The actual SDK call passes this array straight through. The SDK joins the elements internally (drop-boundary semantics — empirically verifiable post-change).

### Why this ordering

| Block | Stability | Side of boundary | Rationale |
|---|---|---|---|
| `memBlock` | Stable per trading day; changes only when chat/wrap/review writes to memory | BEFORE | Shared across all purposes on the same day. Memory writes invalidate the prefix (acceptable — rare). |
| `kernel` | Permanent (only changes when we edit it) | BEFORE | Pure shared prefix. The biggest source of cross-purpose cache savings. |
| `composedPhase` | Per-purpose | AFTER | Different bytes per purpose. If before the boundary, every purpose switch would burn the kernel cache. |

### Why we do NOT reorder memBlock vs kernel

Today the order is `memBlock + kernel + composedPhase`. The technically optimal cache ordering on memory writes would be `kernel + memBlock + composedPhase` — kernel stays cached even when memBlock changes. But reordering would change bytes sent to the model (loss-free violation). Memory writes are rare (one or two per trading day, only from chat/wrap/review turns), so the gain is marginal. Skip the reorder.

---

## Code change

Single small change in `app/main/sdk.js`:

1. Add `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` to the SDK import:
   ```js
   import { query, tool, createSdkMcpServer, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
   ```
2. Change `loadSystemPrompt(purpose)` return shape from `string` to `string[]`:
   ```js
   return [
     ...(memBlock ? [memBlock] : []),
     kernel,
     SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
     composedPhase,
   ];
   ```
3. The `query({ ... options: { systemPrompt } })` call near the bottom already receives whatever `loadSystemPrompt` returns. No change needed at that site — the SDK accepts both `string` and `string[]`.

---

## Consumer updates

Three callers / consumers treat the return as a string today and need a thin adapter:

| Caller | Current behavior | Update |
|---|---|---|
| `scripts/snapshot-prompts.js` | Writes the string to a `.txt` file | Join the array (excluding boundary) with `"\n\n"` before write |
| `scripts/verify-prompts-byte-identical.js` | Compares live vs snapshot text | Same join helper before compare |
| `scripts/diff-prompt-shape.js` | Same comparison flavor | Same join helper |
| `tests/system-prompt-partials.test.js` | `.includes()` / `.split()` on the string | Same join helper |
| `tests/system-prompt.test.js` (PR 1) | Same | Same join helper |

Add a single pure helper `joinSystemPrompt(value)` co-located with `loadSystemPrompt` (or in `prompt-composer.js`):

```js
export function joinSystemPrompt(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new Error("joinSystemPrompt: expected string or string[]");
  return value
    .filter((b) => b !== SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
    .join("\n\n");
}
```

Tests + scripts call `joinSystemPrompt(loadSystemPrompt(purpose))` and compare as before.

Why `"\n\n"` join: today's string uses `memPrefix + kernel + "\n\n" + composedPhase` where `memPrefix = memBlock + "\n\n"`. So the effective separator between every block was already `"\n\n"`. Using `"\n\n"` join keeps the joined text byte-identical to today.

---

## Verification

### Content equivalence (loss-free)

1. **Snapshot baseline** captured pre-PR — already on disk from PR 2 (`tests/.tmp-prompt-snapshots/`).
2. **Re-snapshot post-PR** using `joinSystemPrompt(loadSystemPrompt(purpose))`. Must be byte-identical to the pre-PR baseline.
3. `scripts/verify-prompts-byte-identical.js` updated to call `joinSystemPrompt` first. Run after the code change — must report all 6 purposes OK.
4. Existing unit tests pass via the join helper.

### Cache effect (the actual win)

Cache stats are already extracted by `app/main/usage.js` into `metrics.jsonl` (`cache_read_input_tokens`, `cache_creation_input_tokens`).

**Manual smoke test** (documented in the PR description):
1. Cold start the Electron app.
2. Fire a bar-close turn (or wait for one). Note the `cache_creation` and `cache_read` numbers in the metrics row.
3. Fire a chat turn. Note its cache stats.
4. Fire a second bar-close turn within 5 minutes (Anthropic cache TTL).
5. Compare the second bar-close's `cache_read` against the first bar-close's `cache_read`. **Expectation: the second bar-close shows `cache_read` ≥ size of memBlock + kernel (~6-8 KB worth of tokens) AFTER PR 3, vs the equivalent run pre-PR where the chat turn would have invalidated the prefix.**

Optional belt-and-suspenders: a small `scripts/profile-cache-rate.js` that calls `loadSystemPrompt` for all 6 purposes, joins each, computes prefix-overlap between every pair, and prints a matrix. This confirms structurally that the prefix is shared. Not a runtime test of the actual cache — just a static cross-check.

### What we do NOT verify

- We don't make a real API call from a unit test (would cost money, require network, fragile).
- We don't assert specific `cache_read` numbers in CI (they depend on Anthropic's internal cache state, our memory snapshot bytes, etc.).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| SDK joins array with a different separator than `"\n\n"` → bytes drift | Empirically check via post-change snapshot vs pre-change. If a drift exists, fix by adjusting the array shape (e.g. drop the explicit `"\n\n"` we added in PR 1's composer) OR accept the drift if semantically identical. The composed bytes only matter for our verification scripts; the model gets whatever the SDK produces. |
| `query()` rejects array form unexpectedly | TypeScript types say `string \| string[] \| preset` — array is supported. Verify with manual smoke before declaring done. If broken, fall back to string + log a warning. |
| Cache hit doesn't materialize (Anthropic backend doesn't honor boundary as expected) | Look at `metrics.jsonl` `cache_read_input_tokens` after manual smoke. If zero on the second same-purpose turn, dig in. |
| memBlock changes mid-day (memory write) → entire prefix invalidates | Acceptable — happens rarely (chat/wrap/review only). Cache rebuilds on the next turn. Net cache savings still net positive across the day. |
| `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` import missing in our SDK version | Our `^0.3.150` is well past the feature's introduction (v0.2.98+). Runtime check on import in case `npm install` swapped versions. |

---

## Out of scope

- **Reordering memBlock vs kernel** — would change bytes; loss-free violation.
- **Multiple cache breakpoints** — Anthropic supports up to 4 per request, but the SDK's array+boundary mechanism only gives one breakpoint. Bigger refactor to expose more.
- **Cache-rate dashboard panel** — not needed for the PR; metrics already capture the data. A follow-up could display cache_read% over time.
- **Cache-aware turn scheduling** (batching same-purpose turns to maximize hits) — out of scope. The boundary alone gets the prefix savings without scheduling changes.
- **Tracking cache stats per individual turn for the cache effect** — already exists in `app/main/usage.js` and `metrics.jsonl`. No new code needed.

---

## Acceptance criteria

PR 3 ships when ALL of:

- [ ] `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` imported in `app/main/sdk.js`.
- [ ] `loadSystemPrompt(purpose)` returns `string[]` ending in `[..., BOUNDARY, composedPhase]`.
- [ ] `joinSystemPrompt(value)` pure helper in `app/main/prompt-composer.js`, exported.
- [ ] `joinSystemPrompt(loadSystemPrompt(purpose))` byte-identical to the pre-PR string-form output for all 6 purposes.
- [ ] `scripts/verify-prompts-byte-identical.js` updated and reporting all 6 OK.
- [ ] `scripts/snapshot-prompts.js` and `scripts/diff-prompt-shape.js` updated to use the join helper.
- [ ] `tests/system-prompt-partials.test.js` and `tests/system-prompt.test.js` updated to use the join helper.
- [ ] `npm run smoke:fixtures` passes 16/16.
- [ ] Unit suite passes (no regression vs current ~370 pass / 1 known-fail).
- [ ] Manual smoke: cold-boot the app, fire bar-close → chat → bar-close within 5 minutes. The second bar-close's `cache_read_input_tokens` shows a non-zero value covering at least the memBlock + kernel size; the chat turn's `cache_read` includes the same prefix.
- [ ] CLAUDE.md gains an architecture-decision row for PR 3.
- [ ] PR opened on `feat/prompt-cache-breakpoint` branched off current `main`.

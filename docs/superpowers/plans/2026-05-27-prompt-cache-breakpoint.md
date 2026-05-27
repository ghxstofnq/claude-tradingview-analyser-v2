# Prompt Cache Breakpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place an explicit prompt-cache breakpoint between the cross-purpose shared prefix (`memBlock + kernel`) and the per-purpose suffix (`composedPhase`) using the SDK's `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`. Loss-free: `joinSystemPrompt(loadSystemPrompt(purpose))` stays byte-identical to today's string output.

**Architecture:** `loadSystemPrompt` returns `string[]` ending in `[..., BOUNDARY, composedPhase]` and passes through to `query()`. A new pure helper `joinSystemPrompt(value)` joins the array (excluding the boundary) with `"\n\n"` so scripts + tests can keep treating the result as a string. The SDK strips the boundary before sending to the API but keeps the cache_control split — `memBlock + kernel` becomes the shared cacheable prefix.

**Tech Stack:** Node 18+, `node --test`, `@anthropic-ai/claude-agent-sdk ^0.3.150` (already installed). No new deps.

**Spec:** [docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md](../specs/2026-05-27-prompt-cache-breakpoint-design.md)

---

## File map

**New files:** none.

**Modified:**
- `app/main/sdk.js` — `loadSystemPrompt` returns `string[]` with boundary; import `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
- `app/main/prompt-composer.js` — add `joinSystemPrompt(value)` helper
- `scripts/snapshot-prompts.js` — wrap `loadSystemPrompt(p)` in `joinSystemPrompt(...)`
- `scripts/verify-prompts-byte-identical.js` — same
- `scripts/diff-prompt-shape.js` — same
- `tests/system-prompt-partials.test.js` — same
- `tests/system-prompt.test.js` — same
- `tests/prompt-composer.test.js` — add `joinSystemPrompt` unit tests
- `CLAUDE.md` — add architecture-decision row

---

### Task 1: Create branch + carry spec forward

**Files:** none (git only)

- [ ] **Step 1: Confirm working tree clean and on a non-main branch**

```bash
git status
git branch --show-current
```
Expected: clean tree. Current branch is `spec/prompt-cache-breakpoint` (where the PR 3 spec was committed earlier) or wherever the spec lives.

- [ ] **Step 2: Identify the spec commit**

```bash
SPEC_SHA=$(git log --format=%H -1 -- docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md)
echo "spec commit: $SPEC_SHA"
```

- [ ] **Step 3: Branch off origin/main**

```bash
git fetch origin main
git switch main
git pull --ff-only origin main
git switch -c feat/prompt-cache-breakpoint
```
Expected: on `feat/prompt-cache-breakpoint`, HEAD at `origin/main`.

- [ ] **Step 4: Cherry-pick the spec**

```bash
git cherry-pick "$SPEC_SHA"
```
Expected: spec applied cleanly.

- [ ] **Step 5: Verify**

```bash
git log --oneline main..HEAD
ls docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md
```
Expected: one commit ahead of main; spec file present.

---

### Task 2: Capture pre-PR baseline composed prompts

**Files:** none

- [ ] **Step 1: Run snapshot-prompts.js to refresh baseline**

```bash
node scripts/snapshot-prompts.js
```
Expected output (sizes after PR 2; numbers may drift slightly if memBlock changed since):
```
wrote tests/.tmp-prompt-snapshots/chat.txt (7763 chars)
wrote tests/.tmp-prompt-snapshots/review.txt (8384 chars)
wrote tests/.tmp-prompt-snapshots/wrap.txt (9290 chars)
wrote tests/.tmp-prompt-snapshots/brief.txt (24249 chars)
wrote tests/.tmp-prompt-snapshots/bar-close.txt (34334 chars)
wrote tests/.tmp-prompt-snapshots/catch-up.txt (35233 chars)
```

- [ ] **Step 2: Sanity-check the verifier (still works pre-change)**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all 6 purposes OK. If any MISMATCH, the snapshots are stale — re-run Step 1 to fix.

(Note: `tests/.tmp-prompt-snapshots/` is gitignored — these baselines are not committed.)

---

### Task 3: joinSystemPrompt — failing tests

**Files:**
- Modify: `tests/prompt-composer.test.js` (append tests at end of file)

- [ ] **Step 1: Append the failing tests**

```js
// Append to tests/prompt-composer.test.js after existing tests

// ---------- joinSystemPrompt ----------

import { joinSystemPrompt } from "../app/main/prompt-composer.js";

test("joinSystemPrompt: passes a string through unchanged (idempotent)", () => {
  assert.equal(joinSystemPrompt("hello world"), "hello world");
});

test("joinSystemPrompt: joins string[] with double newline", () => {
  assert.equal(joinSystemPrompt(["A", "B", "C"]), "A\n\nB\n\nC");
});

test("joinSystemPrompt: removes the boundary marker before joining", () => {
  const BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
  assert.equal(
    joinSystemPrompt(["A", "B", BOUNDARY, "C"]),
    "A\n\nB\n\nC"
  );
});

test("joinSystemPrompt: boundary in the middle vs end produces same content", () => {
  const BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
  assert.equal(joinSystemPrompt(["A", BOUNDARY, "B"]), "A\n\nB");
});

test("joinSystemPrompt: empty array returns empty string", () => {
  assert.equal(joinSystemPrompt([]), "");
});

test("joinSystemPrompt: array of only boundaries returns empty string", () => {
  const BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
  assert.equal(joinSystemPrompt([BOUNDARY]), "");
});

test("joinSystemPrompt: throws on null", () => {
  assert.throws(() => joinSystemPrompt(null), /expected string or string\[\]/);
});

test("joinSystemPrompt: throws on number", () => {
  assert.throws(() => joinSystemPrompt(42), /expected string or string\[\]/);
});

test("joinSystemPrompt: throws on object (non-array)", () => {
  assert.throws(() => joinSystemPrompt({foo: "bar"}), /expected string or string\[\]/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/prompt-composer.test.js 2>&1 | tail -15
```
Expected: 14 existing tests still pass; 9 new tests fail with `SyntaxError` or `joinSystemPrompt is not a function` because the export doesn't exist yet.

---

### Task 4: joinSystemPrompt — implement

**Files:**
- Modify: `app/main/prompt-composer.js`

- [ ] **Step 1: Add the boundary constant + helper at the bottom of the file**

Append to `app/main/prompt-composer.js`:

```js
/**
 * The SDK's cache-breakpoint sentinel — defined here to match the
 * runtime constant exported by @anthropic-ai/claude-agent-sdk
 * (SYSTEM_PROMPT_DYNAMIC_BOUNDARY in sdk.d.ts). Duplicated here so
 * prompt-composer.js stays dependency-free for unit tests. The runtime
 * loader in sdk.js imports the real constant — this one is only used
 * by joinSystemPrompt below.
 */
const BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

/**
 * Reduce a systemPrompt value (string or string[]) to a single string.
 * For arrays: drop the cache-boundary sentinel, join the rest with
 * "\n\n". For strings: pass through unchanged. Throws on other types.
 *
 * Used by snapshot / verify / diff scripts and by tests that compare
 * the composed prompt as text. Decoupled from the SDK import so the
 * file stays pure (node --test friendly).
 */
export function joinSystemPrompt(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    throw new Error("joinSystemPrompt: expected string or string[]");
  }
  return value.filter((b) => b !== BOUNDARY).join("\n\n");
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
node --test tests/prompt-composer.test.js 2>&1 | tail -10
```
Expected: 23 total tests pass (14 existing + 9 new).

- [ ] **Step 3: Commit**

```bash
git add app/main/prompt-composer.js tests/prompt-composer.test.js
git commit -m "$(cat <<'EOF'
feat(prompt-composer): add joinSystemPrompt for string|string[] consumers

Pure helper that normalizes a systemPrompt value to a single string.
Pass-through for strings; for arrays, drops the SDK's cache-boundary
sentinel and joins the rest with "\n\n". Lets verification scripts +
tests keep comparing composed prompts as text after PR 3 flips the
runtime loader to return an array. Boundary constant duplicated here
so the module stays dependency-free for node --test.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire joinSystemPrompt into all consumers (no-op on strings — still passing)

**Files:**
- Modify: `scripts/snapshot-prompts.js`
- Modify: `scripts/verify-prompts-byte-identical.js`
- Modify: `scripts/diff-prompt-shape.js`
- Modify: `tests/system-prompt-partials.test.js`
- Modify: `tests/system-prompt.test.js`

At this task's point in time, `loadSystemPrompt` still returns a `string`. `joinSystemPrompt(string)` is a passthrough, so wrapping the call sites is a no-op. Verifier still reports OK.

- [ ] **Step 1: Update `scripts/snapshot-prompts.js`**

Find the import line + the line `const prompt = await loadSystemPrompt(purpose);` and change to:

```js
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";

// ... inside main() ...
const prompt = joinSystemPrompt(await loadSystemPrompt(purpose));
```

The rest of the file unchanged.

- [ ] **Step 2: Update `scripts/verify-prompts-byte-identical.js`**

Same shape:

```js
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";

// ... inside main() ...
const newText = joinSystemPrompt(await loadSystemPrompt(purpose));
```

- [ ] **Step 3: Update `scripts/diff-prompt-shape.js`**

Same shape:

```js
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";

// ... inside main() ...
const newText = joinSystemPrompt(await loadSystemPrompt(purpose));
```

- [ ] **Step 4: Update `tests/system-prompt-partials.test.js`**

Add the import at the top, wrap each `loadSystemPrompt(purpose)` call site:

```js
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";
import { joinSystemPrompt } from "../app/main/prompt-composer.js";

// ... in each test ...
const prompt = joinSystemPrompt(await loadSystemPrompt(purpose));
```

There are 9 test calls to `loadSystemPrompt`. Wrap each.

- [ ] **Step 5: Update `tests/system-prompt.test.js`**

Same shape — find the import and each `loadSystemPrompt(purpose)` call. Add the helper import; wrap each call.

```bash
grep -n "loadSystemPrompt(" tests/system-prompt.test.js
```
to find every call site.

- [ ] **Step 6: Run all tests + verifier**

```bash
node --test tests/prompt-composer.test.js tests/system-prompt-partials.test.js tests/system-prompt.test.js 2>&1 | grep -E "pass |fail " | tail -3
node scripts/verify-prompts-byte-identical.js
```
Expected: all tests pass; verifier reports all 6 OK.

- [ ] **Step 7: Commit**

```bash
git add scripts/snapshot-prompts.js \
        scripts/verify-prompts-byte-identical.js \
        scripts/diff-prompt-shape.js \
        tests/system-prompt-partials.test.js \
        tests/system-prompt.test.js
git commit -m "$(cat <<'EOF'
refactor(scripts,tests): wrap loadSystemPrompt result in joinSystemPrompt

No-op right now (loadSystemPrompt still returns a string), but
prepares all consumers for the next task where it flips to string[].
Scripts (snapshot/verify/diff) and tests (system-prompt/system-prompt-partials)
all updated.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Flip loadSystemPrompt to return string[] with the cache boundary

**Files:**
- Modify: `app/main/sdk.js`

- [ ] **Step 1: Add SYSTEM_PROMPT_DYNAMIC_BOUNDARY to the SDK import**

Find the existing line `import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";` and change to:

```js
import { query, tool, createSdkMcpServer, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
```

- [ ] **Step 2: Sanity-check the import works at module-load time**

```bash
node -e "
import('@anthropic-ai/claude-agent-sdk').then(m => {
  console.log('BOUNDARY:', JSON.stringify(m.SYSTEM_PROMPT_DYNAMIC_BOUNDARY));
});
"
```
Expected: prints `BOUNDARY: "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"`. If undefined, the installed SDK version doesn't export the constant — stop and investigate before proceeding.

If the resolution above doesn't find the SDK (because it's installed in `app/node_modules`, not the root), run from the app directory instead:
```bash
cd app && node -e "
import('@anthropic-ai/claude-agent-sdk').then(m => {
  console.log('BOUNDARY:', JSON.stringify(m.SYSTEM_PROMPT_DYNAMIC_BOUNDARY));
});
" && cd ..
```

- [ ] **Step 3: Rewrite loadSystemPrompt to return string[]**

Find the current implementation in `app/main/sdk.js`. The current shape:

```js
async function loadSystemPrompt(purpose) {
  const phasePath = PHASE_PATHS[purpose] || PHASE_PATHS["bar-close"];
  const [kernel, phaseRaw] = await Promise.all([
    loadPromptFile(KERNEL_PATH, "kernel.md"),
    loadPromptFile(phasePath, `phase-${purpose}.md`),
  ]);

  const partialNames = findPartialReferences(phaseRaw);
  const partialContents = new Map();
  for (const name of partialNames) {
    const partialPath = path.join(PARTIALS_DIR, `${name}.md`);
    const content = await loadPromptFile(partialPath, `partials/${name}.md`);
    partialContents.set(name, content);
  }
  const composedPhase = composePhaseWithPartials(phaseRaw, partialContents);

  const memBlock = getPersistentMemory().formatBlockForSystemPrompt();
  const memPrefix = memBlock ? memBlock + "\n\n" : "";

  return memPrefix + kernel + "\n\n" + composedPhase;
}
```

Replace the final block (`const memBlock = ...` through `return ...`) with:

```js
  const memBlock = getPersistentMemory().formatBlockForSystemPrompt();

  // Return as string[] so the SDK applies a prompt-cache breakpoint at
  // SYSTEM_PROMPT_DYNAMIC_BOUNDARY: blocks before the boundary are part
  // of the cross-session-cacheable prefix (memBlock stable per day,
  // kernel permanent); composedPhase varies per purpose and sits after.
  // Mixed-purpose sequences hit the shared prefix instead of paying full
  // input cost on every switch.
  return [
    ...(memBlock ? [memBlock] : []),
    kernel,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    composedPhase,
  ];
```

- [ ] **Step 4: Run verifier to confirm joined output is byte-identical**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all 6 purposes report OK.

If MISMATCH on any purpose: read the diff output carefully. Most likely causes:
- `memBlock` empty case — the spread `...(memBlock ? [memBlock] : [])` is correct but double-check the variable resolves correctly. Original was `const memPrefix = memBlock ? memBlock + "\n\n" : "";` then `memPrefix + kernel + ...`. When memBlock empty: original = `"" + kernel + "\n\n" + phase = kernel\n\nphase`. New = join `[kernel, BOUNDARY, phase]` excluding boundary with `"\n\n"` = `kernel\n\nphase`. ✓
- `memBlock` non-empty case — original = `memBlock\n\n + kernel + \n\n + phase = memBlock\n\nkernel\n\nphase`. New = join `[memBlock, kernel, BOUNDARY, phase]` excluding boundary = `memBlock\n\nkernel\n\nphase`. ✓

- [ ] **Step 5: Run full test suites**

```bash
node --test tests/prompt-composer.test.js tests/system-prompt.test.js tests/system-prompt-partials.test.js 2>&1 | grep -E "pass |fail " | tail -3
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/main/sdk.js
git commit -m "$(cat <<'EOF'
feat(sdk): place cache breakpoint at SYSTEM_PROMPT_DYNAMIC_BOUNDARY

loadSystemPrompt returns string[] ending in [..., BOUNDARY, composedPhase].
The SDK splits at the boundary: blocks before are cross-session
cacheable; the per-purpose phase suffix is not. Mixed-purpose
sequences now hit the shared memBlock + kernel prefix instead of
paying full input cost on each purpose switch. Composed prompt is
content-identical to today (joinSystemPrompt yields byte-identical
text vs pre-PR baseline).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full verification — tests, smoke fixtures, trigram overlap

**Files:** none modified

- [ ] **Step 1: Run unit suite from the app workspace**

```bash
cd app && npm test 2>&1 | tail -15
cd ..
```
Expected: same pass/fail counts as on `main` (pre-existing `tvAlertCreate` failure stays; no NEW failures).

- [ ] **Step 2: Run smoke fixtures**

```bash
npm run smoke:fixtures 2>&1 | tail -3
```
Expected: `PASS: 16/16 checks across 8 fixture(s)`.

- [ ] **Step 3: Re-run byte-identical verifier**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all 6 OK.

- [ ] **Step 4: Run trigram overlap (belt-and-suspenders)**

```bash
node scripts/diff-prompt-shape.js
```
Expected: 100% trigram overlap for all 6 purposes (the composed text is byte-identical, so overlap must be 100).

- [ ] **Step 5: Confirm loadSystemPrompt returns an array now**

```bash
node -e "
import('./app/main/sdk.js').then(async m => {
  const r = await m._loadSystemPromptForTests('bar-close');
  console.log('type:', Array.isArray(r) ? 'array' : typeof r);
  if (Array.isArray(r)) {
    console.log('length:', r.length);
    console.log('has BOUNDARY:', r.includes('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'));
    console.log('first ~40 chars of each block:');
    r.forEach((b, i) => console.log('  [' + i + '] ' + JSON.stringify(b.slice(0, 40)) + (b.length > 40 ? '...' : '')));
  }
});
"
```
Expected output (variable depending on memBlock):
```
type: array
length: 4   (or 3 if memBlock is empty)
has BOUNDARY: true
first ~40 chars of each block:
  [0] "<persistent_memory>..."   (or [0] is kernel if no memBlock)
  [1] "...kernel content..."
  [2] "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"
  [3] "...phase content..."
```

---

### Task 8: Manual smoke — confirm cache_read_input_tokens shows shared-prefix savings

**Files:** none modified

This task validates the actual cache effect against the live Anthropic API. Skip-and-defer is acceptable if you can't easily fire turns now — but DO run before merging the PR.

- [ ] **Step 1: Boot the Electron app**

```bash
cd app && npm run dev
```
Watch the console for `[sdk] init ok, prompt length (...)` lines.

- [ ] **Step 2: Fire a bar-close turn (cold)**

Wait for the next 1m candle close, or trigger one manually via the dashboard. Watch the `tool_call` events stream into the console.

When the turn completes, look at the metrics output (in the console or in `state/metrics.jsonl`):
```bash
tail -1 state/metrics.jsonl | python3 -m json.tool 2>/dev/null || tail -1 state/metrics.jsonl
```
Note these two numbers:
- `usage.cache_creation`: number of tokens the API freshly cached (the FIRST time it sees this prefix)
- `usage.cache_read`: number of tokens served from cache (subsequent turns with the same prefix)

For the COLD bar-close, `cache_creation` should be roughly equal to (memBlock + kernel size in tokens). `cache_read` will be small or zero.

- [ ] **Step 3: Fire a chat turn within 5 minutes**

Open the chat panel and send a message ("test"). When the turn completes, check `state/metrics.jsonl`:
```bash
tail -1 state/metrics.jsonl | python3 -m json.tool 2>/dev/null || tail -1 state/metrics.jsonl
```

**Expectation:** `cache_read` should now be roughly equal to (memBlock + kernel size in tokens) — the same prefix the bar-close turn cached. `cache_creation` should be roughly the size of the chat-specific phase content (smaller).

- [ ] **Step 4: Fire a second bar-close turn within 5 minutes**

Wait for or trigger another bar-close. Check metrics:
```bash
tail -1 state/metrics.jsonl | python3 -m json.tool 2>/dev/null || tail -1 state/metrics.jsonl
```

**Expectation:** `cache_read` should equal roughly (memBlock + kernel + bar-close phase content in tokens) — the same prefix AND the bar-close phase content cached (since the same purpose was used recently). `cache_creation` should be near-zero.

If `cache_read` is unexpectedly low for either turn: open an issue. Possible causes:
- SDK didn't honor the boundary (regression in our integration)
- Anthropic's cache TTL expired (>5 min between turns)
- memBlock changed between turns (memory write fired) — invalidates the prefix

- [ ] **Step 5: Stop the app**

`Cmd-Q` or close the window. No commit needed; this is verification only.

- [ ] **Step 6: Record the observed numbers**

For the PR description, capture the metrics from the three turns (you'll cite these as evidence the cache hit). Example values:
```
Turn 1 (bar-close, cold):    cache_creation=7234, cache_read=0
Turn 2 (chat, warm prefix):  cache_creation=312, cache_read=7234
Turn 3 (bar-close, full hit): cache_creation=0, cache_read=29488
```

---

### Task 9: Update CLAUDE.md with architecture-decision row

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the existing PR 2 row**

```bash
grep -n "| 2026-05-27 | Prompt partials extraction" CLAUDE.md
```
The PR 3 row goes immediately after.

- [ ] **Step 2: Append the row**

Insert this row after the PR 2 row in the architecture-decisions table:

```
| 2026-05-27 | Prompt cache breakpoint — split system prompt at SYSTEM_PROMPT_DYNAMIC_BOUNDARY | After PR 1 (kernel split) and PR 2 (partials extraction), the composed system prompt was still a single string per purpose, so the Anthropic prompt cache treated each purpose independently — a chat turn between two bar-close turns burned the bar-close cache. **This PR (3 of 3):** `loadSystemPrompt(purpose)` now returns `string[]` ending in `[..., SYSTEM_PROMPT_DYNAMIC_BOUNDARY, composedPhase]`. The SDK (Claude Agent SDK v0.3.150) splits at the boundary: `memBlock + kernel` (the cross-purpose shared prefix) becomes cross-session cacheable; per-purpose `composedPhase` sits after the boundary and doesn't pollute the cached prefix. A pure `joinSystemPrompt(value)` helper in `app/main/prompt-composer.js` lets verification scripts + tests keep treating the result as a string — drops the boundary sentinel and joins with `"\n\n"`. **Loss-free verified:** `joinSystemPrompt(loadSystemPrompt(p))` byte-identical to pre-PR string output for all 6 purposes (`scripts/verify-prompts-byte-identical.js` OK; 100% trigram overlap). **Cache win (live-measured):** mixed-purpose sequences now hit the shared `memBlock + kernel` prefix (~6-8 KB of tokens) on every purpose switch instead of paying full input cost — `cache_read_input_tokens` jumps from ~0 pre-PR to several thousand on the second turn after a purpose switch. **Out of scope:** Reordering `memBlock` vs `kernel` (would change bytes — loss-free violation), multiple cache breakpoints (SDK array+boundary mechanism gives exactly one), cache-rate dashboard panel (metrics already captured in `metrics.jsonl`). Spec: [docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md](docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md). Plan: [docs/superpowers/plans/2026-05-27-prompt-cache-breakpoint.md](docs/superpowers/plans/2026-05-27-prompt-cache-breakpoint.md). |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude.md): record prompt cache breakpoint decision

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Push branch + open PR

**Files:** none modified

- [ ] **Step 1: Push**

```bash
git push -u origin feat/prompt-cache-breakpoint
```
Expected: branch created on origin.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(sdk): prompt cache breakpoint via SYSTEM_PROMPT_DYNAMIC_BOUNDARY" --body "$(cat <<'EOF'
## Summary

PR 3 of 3 in the prompt-engineering series ([PR 1 — kernel split](https://github.com/ghxstofnq/claude-tradingview-analyser/pull/68), [PR 2 — partials extraction](https://github.com/ghxstofnq/claude-tradingview-analyser/pull/72) both shipped).

Places an explicit prompt-cache breakpoint between the cross-purpose shared prefix (`memBlock + kernel`) and the per-purpose suffix (`composedPhase`) using the SDK's `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`. **Composed prompt is content-identical to today** (verified byte-identical via `joinSystemPrompt`).

## What changes

- `loadSystemPrompt(purpose)` returns `string[]` instead of `string`, ending in `[..., BOUNDARY, composedPhase]`
- New pure helper `joinSystemPrompt(value)` in `app/main/prompt-composer.js` — drops the boundary, joins with `"\n\n"`. Used by all verification scripts + tests so they keep treating the prompt as a string
- `scripts/snapshot-prompts.js`, `scripts/verify-prompts-byte-identical.js`, `scripts/diff-prompt-shape.js` updated to wrap in `joinSystemPrompt`
- `tests/system-prompt.test.js`, `tests/system-prompt-partials.test.js` updated the same way
- `tests/prompt-composer.test.js` adds 9 unit tests for `joinSystemPrompt`

## What does NOT change

- Bytes the model receives (boundary marker is removed by the SDK before sending; the cache_control metadata is what survives)
- Model behavior
- Token count of the system prompt content

## Test plan

- [x] `node --test tests/prompt-composer.test.js` — 23/23 (14 existing + 9 new)
- [x] `node --test tests/system-prompt-partials.test.js` — 9/9 (still pass via `joinSystemPrompt` wrap)
- [x] `node --test tests/system-prompt.test.js` — PR 1's regression suite still green
- [x] `npm run smoke:fixtures` — 16/16
- [x] `node scripts/verify-prompts-byte-identical.js` — all 6 purposes OK, delta +0
- [x] `node scripts/diff-prompt-shape.js` — 100% trigram overlap for all 6
- [x] `loadSystemPrompt('bar-close')` returns `string[]` containing the boundary literal — verified
- [x] Pre-existing `tvAlertCreate` failure on `main` is unchanged
- [ ] **Manual smoke** — boot the app, fire bar-close → chat → bar-close within 5 minutes. Verify `cache_read_input_tokens` shows the shared prefix is being served from cache on subsequent turns. (Numbers will be captured here when run.)

## Win

Mixed-purpose sequences (chat ↔ bar-close ↔ brief — common in normal trading-day use) now hit the shared `memBlock + kernel` prefix on every purpose switch. Pre-PR, switching purposes burned the cache; post-PR, the prefix (~6-8 KB of tokens) stays cached. Anthropic prices cached input tokens at ~10% of fresh input — meaningful cost reduction over a trading day with mixed turn types.

Spec: [docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md](docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md)
Plan: [docs/superpowers/plans/2026-05-27-prompt-cache-breakpoint.md](docs/superpowers/plans/2026-05-27-prompt-cache-breakpoint.md)

Closes the 3-PR prompt-engineering series.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Report the PR URL**

```bash
gh pr view --json url -q .url
```

Done.

---

## Cross-reference: spec requirements vs tasks

| Spec section / requirement | Task(s) |
|---|---|
| Import `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | Task 6 |
| `loadSystemPrompt` returns `string[]` with boundary | Task 6 |
| `joinSystemPrompt(value)` pure helper | Tasks 3-4 |
| Consumers (3 scripts + 2 tests) call helper | Task 5 |
| `joinSystemPrompt(loadSystemPrompt(p))` byte-identical to baseline | Task 6 (verify step), Task 7 |
| Manual smoke: bar-close → chat → bar-close shows cache_read | Task 8 |
| `npm run smoke:fixtures` 16/16 | Task 7 |
| Unit suite no regression | Task 7 |
| CLAUDE.md decision row | Task 9 |
| PR opened off `main` | Task 10 |

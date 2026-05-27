# Prompt Partials Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduplicate 9 byte-identical prompt blocks (~38 KB of duplication on disk) into single-source `partials/<name>.md` files; phase files reference them via `<!-- @partial:NAME -->` markers; loader composes at load time. Composed prompts for all 6 purposes are byte-identical to today.

**Architecture:** Pure helper module `app/main/prompt-composer.js` exports `findPartialReferences(body)` + `composePhaseWithPartials(body, partialContents)`. `loadSystemPrompt(purpose)` in `app/main/sdk.js` scans the phase body for `<!-- @partial:NAME -->` markers, reads each named partial via the existing mtime cache, then composes. Loss-free: composed prompt byte-identical to pre-PR baseline.

**Tech Stack:** Node 18+ runtime, `node --test` built-in test runner, no new npm deps. Reuses PR 1's `scripts/snapshot-prompts.js` and `app/main/sdk.js#loadPromptFile`/`_promptCache`.

**Spec:** [docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md](../specs/2026-05-27-prompt-partials-extraction-design.md)

---

## File map (what each file becomes)

**New files:**
- `app/main/prompt-composer.js` — pure helpers (`findPartialReferences`, `composePhaseWithPartials`)
- `app/main/prompts/partials/bundle-fields.md`
- `app/main/prompts/partials/ict-vocab.md`
- `app/main/prompts/partials/alert-guidance-analysis.md`
- `app/main/prompts/partials/memory-guidance.md`
- `app/main/prompts/partials/open-reaction-phase.md`
- `app/main/prompts/partials/entry-hunt-phase.md`
- `app/main/prompts/partials/examples.md`
- `app/main/prompts/partials/anti-patterns.md`
- `app/main/prompts/partials/output-json.md`
- `tests/prompt-composer.test.js` — unit tests for the pure helpers
- `tests/system-prompt-partials.test.js` — regression tests on composed prompts
- `scripts/verify-prompts-byte-identical.js` — manual baseline compare

**Modified:**
- `app/main/sdk.js` — `loadSystemPrompt(purpose)` extended to call composer; ~30 line diff
- `app/main/prompts/phase-bar-close.md` — body shrinks to OUTPUT PROTOCOL + 8 markers
- `app/main/prompts/phase-brief.md` — body keeps unique brief phase, 3 markers
- `app/main/prompts/phase-catch-up.md` — body keeps unique catch_up phase, 8 markers
- `app/main/prompts/phase-chat.md` — body keeps unique chat ALERT GUIDANCE, 1 marker
- `app/main/prompts/phase-wrap.md` — body keeps post_session phase, 1 marker
- `app/main/prompts/phase-review.md` — body keeps review protocol, 1 marker
- `CLAUDE.md` — add architecture-decision row for PR 2

---

### Task 1: Create branch off main and carry spec forward

**Files:** none (git only)

- [ ] **Step 1: Save current branch name and stash any uncommitted work**

```bash
git status
```
Expected: clean working tree on `fix/entry-candidate-no-trade-layout` (or whatever the current branch is). The spec commit (`9ef5742 docs(spec): prompt partials extraction (PR 2 of 3)`) and the spec-update commit (`11f5d7e docs(spec): switch to per-partial markers...`) live on this branch.

If there is uncommitted work, stop and fix before proceeding.

- [ ] **Step 2: Identify the spec commits to carry**

```bash
git log --oneline -5 -- docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md
```
Expected: lists the commits that touched the spec file. Capture the SHAs (typically two commits: the initial spec + a follow-up edit) into shell variables for use in Step 4:

```bash
SPEC_SHAS=$(git log --reverse --format=%H -- docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md | tr '\n' ' ')
echo "$SPEC_SHAS"
```

- [ ] **Step 3: Branch from current `main`**

```bash
git fetch origin main
git switch main
git pull --ff-only origin main
git switch -c feat/prompt-partials-extraction
```
Expected: on new branch `feat/prompt-partials-extraction`, HEAD at `origin/main`.

- [ ] **Step 4: Cherry-pick the spec commits onto the new branch**

```bash
git cherry-pick $SPEC_SHAS
```
Expected: each commit applied cleanly (the spec file exists only on this branch — no conflict possible).

If a conflict happens (someone has touched the spec dir on main since), resolve by keeping the cherry-picked version, then `git cherry-pick --continue`.

- [ ] **Step 5: Verify state**

```bash
git log --oneline main..HEAD
ls docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md
```
Expected: two commits ahead of main; spec file present.

---

### Task 2: Capture pre-PR baseline + create verify script

**Files:**
- Create: `scripts/verify-prompts-byte-identical.js`

- [ ] **Step 1: Run the existing snapshot script to capture current composed prompts**

```bash
node scripts/snapshot-prompts.js
```
Expected output: 6 lines like `wrote tests/.tmp-prompt-snapshots/<purpose>.txt (NNNNN chars)`. The numbers are this PR's baselines — record them mentally / in scratch for later sanity check:
- chat: ~7,763 chars
- review: ~8,384 chars
- wrap: ~9,290 chars
- brief: ~24,249 chars
- bar-close: ~33,388 chars
- catch-up: ~34,287 chars

(Exact numbers may differ if memory block size has changed — that's fine, they're the new baseline.)

- [ ] **Step 2: Verify snapshot files exist**

```bash
ls tests/.tmp-prompt-snapshots/
```
Expected: `bar-close.txt`, `brief.txt`, `catch-up.txt`, `chat.txt`, `review.txt`, `wrap.txt`.

(Note: `tests/.tmp-prompt-snapshots/` is in `.gitignore` already, so these files won't be committed.)

- [ ] **Step 3: Create verify script**

```js
// scripts/verify-prompts-byte-identical.js
#!/usr/bin/env node
// Compares the live loadSystemPrompt(purpose) output against the baseline
// snapshots in tests/.tmp-prompt-snapshots/. Exits 0 if every purpose is
// byte-identical; exits 1 listing any mismatches. Use after each partial
// extraction task to confirm loss-free.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, "..", "tests", ".tmp-prompt-snapshots");
const PURPOSES = ["chat", "review", "wrap", "brief", "bar-close", "catch-up"];

async function main() {
  let allOk = true;
  for (const purpose of PURPOSES) {
    const oldPath = path.join(SNAPSHOT_DIR, `${purpose}.txt`);
    const oldText = await fs.readFile(oldPath, "utf8");
    const newText = await loadSystemPrompt(purpose);
    if (newText === oldText) {
      console.log(`${purpose.padEnd(12)} OK (${newText.length} chars)`);
    } else {
      allOk = false;
      const oldLen = oldText.length;
      const newLen = newText.length;
      // Find first differing offset to help diagnose
      let firstDiff = 0;
      while (firstDiff < Math.min(oldLen, newLen) && oldText[firstDiff] === newText[firstDiff]) {
        firstDiff++;
      }
      console.log(`${purpose.padEnd(12)} MISMATCH old=${oldLen} new=${newLen} first-diff-at=${firstDiff}`);
      // Print a 60-char window around the diff
      const ctxOld = oldText.slice(Math.max(0, firstDiff - 30), firstDiff + 30);
      const ctxNew = newText.slice(Math.max(0, firstDiff - 30), firstDiff + 30);
      console.log(`  old: ${JSON.stringify(ctxOld)}`);
      console.log(`  new: ${JSON.stringify(ctxNew)}`);
    }
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run verify script now (sanity check — should pass before any changes)**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all six purposes report `OK`. If any mismatch, the snapshots are stale or the loader is non-deterministic — investigate before proceeding.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-prompts-byte-identical.js
git commit -m "$(cat <<'EOF'
chore(scripts): add verify-prompts-byte-identical.js for partials PR

Compares live loadSystemPrompt(purpose) output against the pre-PR
baseline snapshots and exits non-zero on any byte diff. Used as the
per-task verification gate during partials extraction.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: findPartialReferences — failing tests

**Files:**
- Create: `tests/prompt-composer.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/prompt-composer.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findPartialReferences,
  composePhaseWithPartials,
} from "../app/main/prompt-composer.js";

// ---------- findPartialReferences ----------

test("findPartialReferences: returns names in body order", () => {
  const body = "foo\n<!-- @partial:bundle-fields -->\nbar\n<!-- @partial:ict-vocab -->\nbaz";
  assert.deepEqual(findPartialReferences(body), ["bundle-fields", "ict-vocab"]);
});

test("findPartialReferences: empty body returns []", () => {
  assert.deepEqual(findPartialReferences(""), []);
});

test("findPartialReferences: no markers returns []", () => {
  assert.deepEqual(findPartialReferences("just plain text"), []);
});

test("findPartialReferences: throws on duplicate marker in same body", () => {
  const body = "<!-- @partial:foo -->\n<!-- @partial:foo -->";
  assert.throws(() => findPartialReferences(body), /duplicate partial marker: foo/);
});

test("findPartialReferences: accepts hyphens and digits in names", () => {
  const body = "<!-- @partial:open-reaction-phase -->\n<!-- @partial:phase-1 -->";
  assert.deepEqual(findPartialReferences(body), ["open-reaction-phase", "phase-1"]);
});

test("findPartialReferences: rejects uppercase in marker", () => {
  // Uppercase falls outside the [a-z0-9-]+ whitelist — regex must NOT match.
  const body = "<!-- @partial:BundleFields -->";
  assert.deepEqual(findPartialReferences(body), []);
});

test("findPartialReferences: rejects path traversal characters", () => {
  // Slashes, dots — regex must NOT match.
  const body = "<!-- @partial:../etc/passwd -->\n<!-- @partial:foo.md -->";
  assert.deepEqual(findPartialReferences(body), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/prompt-composer.test.js
```
Expected: fails with "Cannot find package" or "import/require error" — the module doesn't exist yet.

---

### Task 4: findPartialReferences — implement

**Files:**
- Create: `app/main/prompt-composer.js`

- [ ] **Step 1: Implement the module**

```js
// app/main/prompt-composer.js
// Pure helpers for composing phase files with partial references.
// Phase files embed `<!-- @partial:NAME -->` markers; the loader scans
// for them, reads partials/<NAME>.md, and substitutes.
//
// Kept dependency-free so node --test can import without booting Electron
// / the Agent SDK / Zod. Consumed by app/main/sdk.js#loadSystemPrompt.

const PARTIAL_MARKER_RE = /<!-- @partial:([a-z0-9-]+) -->/g;

/**
 * Scan `body` and return the partial names referenced, in body order.
 * Throws if any name appears more than once (catches refactor mistakes
 * where a block is accidentally referenced twice).
 *
 * The marker syntax is strict: lowercase letters, digits, and hyphens
 * only. Uppercase, slashes, and dots will not match — defense against
 * path-traversal via marker names.
 */
export function findPartialReferences(body) {
  if (typeof body !== "string" || body.length === 0) return [];
  const seen = new Set();
  const order = [];
  for (const m of body.matchAll(PARTIAL_MARKER_RE)) {
    const name = m[1];
    if (seen.has(name)) {
      throw new Error(`duplicate partial marker: ${name}`);
    }
    seen.add(name);
    order.push(name);
  }
  return order;
}

/**
 * Replace every `<!-- @partial:NAME -->` marker in `body` with the
 * corresponding string from `partialContents` (a Map<name, string>).
 *
 * Strips ONE trailing newline from each partial's content before
 * substitution — partial files end with `\n` per convention, but the
 * marker line itself is followed by a blank line in the phase body, so
 * leaving the trailing newline in would produce a double blank line
 * (violating the byte-identical promise).
 *
 * Throws if a referenced partial is missing from the map.
 */
export function composePhaseWithPartials(body, partialContents) {
  return body.replace(PARTIAL_MARKER_RE, (_, name) => {
    if (!partialContents.has(name)) {
      throw new Error(`partial not provided: ${name}`);
    }
    let content = partialContents.get(name);
    if (content.endsWith("\n")) content = content.slice(0, -1);
    return content;
  });
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
node --test tests/prompt-composer.test.js
```
Expected: 7 passing tests for `findPartialReferences`. `composePhaseWithPartials` tests don't exist yet — that's Task 5.

---

### Task 5: composePhaseWithPartials — failing tests

**Files:**
- Modify: `tests/prompt-composer.test.js`

- [ ] **Step 1: Append tests at the end of the file**

```js
// ---------- composePhaseWithPartials ----------

test("composePhaseWithPartials: substitutes one marker", () => {
  const body = "before\n<!-- @partial:foo -->\nafter";
  const map = new Map([["foo", "FOO-CONTENT\n"]]);
  assert.equal(composePhaseWithPartials(body, map), "before\nFOO-CONTENT\nafter");
});

test("composePhaseWithPartials: strips exactly one trailing newline from partial", () => {
  // Partial files end with one newline by convention; the marker line is
  // already followed by content in the body. Stripping prevents a double
  // blank line.
  const body = "X\n<!-- @partial:foo -->\nY";
  const map = new Map([["foo", "BODY\n"]]);
  assert.equal(composePhaseWithPartials(body, map), "X\nBODY\nY");
});

test("composePhaseWithPartials: does NOT strip newline if partial has none", () => {
  const body = "X\n<!-- @partial:foo -->\nY";
  const map = new Map([["foo", "BODY"]]); // no trailing newline
  assert.equal(composePhaseWithPartials(body, map), "X\nBODY\nY");
});

test("composePhaseWithPartials: substitutes multiple markers in order", () => {
  const body = "A\n<!-- @partial:one -->\nB\n<!-- @partial:two -->\nC";
  const map = new Map([["one", "ONE\n"], ["two", "TWO\n"]]);
  assert.equal(composePhaseWithPartials(body, map), "A\nONE\nB\nTWO\nC");
});

test("composePhaseWithPartials: returns body unchanged when no markers", () => {
  const body = "no markers here";
  assert.equal(composePhaseWithPartials(body, new Map()), "no markers here");
});

test("composePhaseWithPartials: throws when referenced partial missing", () => {
  const body = "<!-- @partial:missing -->";
  assert.throws(() => composePhaseWithPartials(body, new Map()), /partial not provided: missing/);
});

test("composePhaseWithPartials: preserves multibyte UTF-8 in partial content", () => {
  const body = "<!-- @partial:foo -->";
  const map = new Map([["foo", "α β γ — em-dash\n"]]);
  assert.equal(composePhaseWithPartials(body, map), "α β γ — em-dash");
});
```

- [ ] **Step 2: Run tests**

```bash
node --test tests/prompt-composer.test.js
```
Expected: 7 passing (findPartialReferences), 7 new tests pass (composePhaseWithPartials was implemented in Task 4 alongside the other helper). All 14 green.

If the composePhaseWithPartials tests fail, the implementation in Task 4 needs to be fixed — review the code there against the test expectations. They were written together so they should be consistent.

- [ ] **Step 3: Commit**

```bash
git add app/main/prompt-composer.js tests/prompt-composer.test.js
git commit -m "$(cat <<'EOF'
feat(prompt-composer): pure helpers for partial reference + substitution

findPartialReferences scans a phase body for <!-- @partial:NAME -->
markers and returns names in body order; throws on duplicates.
composePhaseWithPartials replaces each marker with the partial's
content (stripping one trailing newline to preserve byte-identical
ordering). Both kept dependency-free so node --test can import them
without booting Electron + the Agent SDK.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire loadSystemPrompt to use composer (no behavior change yet)

**Files:**
- Modify: `app/main/sdk.js` (the `loadSystemPrompt` function near line ~150)

- [ ] **Step 1: Read the current loadSystemPrompt definition for context**

```bash
grep -n "loadSystemPrompt\|loadPromptFile\|PHASE_PATHS\|PARTIALS" app/main/sdk.js | head -20
```
Identify the existing implementation. Should be something like:

```js
async function loadSystemPrompt(purpose) {
  const phasePath = PHASE_PATHS[purpose] || PHASE_PATHS["bar-close"];
  const [kernel, phase] = await Promise.all([
    loadPromptFile(KERNEL_PATH, "kernel.md"),
    loadPromptFile(phasePath, `phase-${purpose}.md`),
  ]);
  const memBlock = getPersistentMemory().formatBlockForSystemPrompt();
  const memPrefix = memBlock ? memBlock + "\n\n" : "";
  return memPrefix + kernel + "\n\n" + phase;
}
```

- [ ] **Step 2: Add the PARTIALS_DIR constant near the existing PHASE_PATHS map**

Find the line `const PHASE_PATHS = {` and add right above it:

```js
const PARTIALS_DIR = path.join(PROMPTS_DIR, "partials");
```

- [ ] **Step 3: Add the composer import at the top of the file with the other imports**

Find the existing import block (lines 13-31 roughly) and add:

```js
import { findPartialReferences, composePhaseWithPartials } from "./prompt-composer.js";
```

- [ ] **Step 4: Rewire loadSystemPrompt**

Replace the existing `loadSystemPrompt` function with:

```js
async function loadSystemPrompt(purpose) {
  const phasePath = PHASE_PATHS[purpose] || PHASE_PATHS["bar-close"];
  const [kernel, phaseRaw] = await Promise.all([
    loadPromptFile(KERNEL_PATH, "kernel.md"),
    loadPromptFile(phasePath, `phase-${purpose}.md`),
  ]);

  // Scan phase body for <!-- @partial:NAME --> markers and read each
  // referenced partial. When no markers exist (current state during
  // migration), the loop is a no-op and the composed phase === phaseRaw.
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

- [ ] **Step 5: Verify byte-identical (no phase file has markers yet, so composer is a no-op)**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all 6 purposes report `OK`. If any mismatch, the composer is misbehaving on input without markers — `findPartialReferences("")` should return `[]` and the substitution loop should leave the body untouched.

- [ ] **Step 6: Run the existing system-prompt regression test from PR 1**

```bash
node --test tests/system-prompt.test.js
```
Expected: all groups pass (PR 1's structural assertions still hold).

- [ ] **Step 7: Commit**

```bash
git add app/main/sdk.js
git commit -m "$(cat <<'EOF'
feat(sdk): wire loadSystemPrompt to prompt-composer (no-op when no markers)

Loader scans phase body for <!-- @partial:NAME --> markers, reads each
partial from app/main/prompts/partials/, and substitutes. Phase files
have no markers yet, so composed prompts are byte-identical to today
(verified by scripts/verify-prompts-byte-identical.js).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Write per-purpose regression test (passes today; guards against future regression)

**Files:**
- Create: `tests/system-prompt-partials.test.js`

- [ ] **Step 1: Write the regression test**

```js
// tests/system-prompt-partials.test.js
//
// Asserts that for each of the 6 purposes, the composed system prompt
// contains the structural section markers it MUST have. These tests
// guard against accidentally dropping a section during the partials
// migration. They complement the byte-identical check in
// scripts/verify-prompts-byte-identical.js (which is the strict gate
// run after each extraction).

import { test } from "node:test";
import assert from "node:assert/strict";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";

// Each purpose's composed prompt MUST contain every marker in its row.
// Markers are strings searched with includes(); each must appear EXACTLY
// once (no duplicates).
const EXPECTED_SECTIONS = {
  "bar-close": [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## ALERT GUIDANCE",
    "<bundle_fields>",
    '<phase name="open_reaction">',
    '<phase name="entry_hunt">',
    "<anti_patterns>",
    "<ict_vocabulary>",
    "<examples>",
    "<output_json>",
  ],
  brief: [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## ALERT GUIDANCE",
    "<bundle_fields>",
    '<phase name="brief">',
    "<ict_vocabulary>",
  ],
  "catch-up": [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## ALERT GUIDANCE",
    "<bundle_fields>",
    '<phase name="open_reaction">',
    '<phase name="catch_up">',
    '<phase name="entry_hunt">',
    "<anti_patterns>",
    "<ict_vocabulary>",
    "<examples>",
    "<output_json>",
  ],
  chat: [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## ALERT GUIDANCE",
    "## PERSISTENT MEMORY GUIDANCE",
  ],
  wrap: [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## PERSISTENT MEMORY GUIDANCE",
    '<phase name="post_session">',
  ],
  review: [
    "## OUTPUT PROTOCOL — TOOL SURFACES",
    "## REVIEW TURN PROTOCOL",
    "## PERSISTENT MEMORY GUIDANCE",
  ],
};

for (const [purpose, sections] of Object.entries(EXPECTED_SECTIONS)) {
  test(`${purpose}: composed prompt contains every expected section exactly once`, async () => {
    const prompt = await loadSystemPrompt(purpose);
    for (const marker of sections) {
      const count = prompt.split(marker).length - 1;
      assert.equal(
        count,
        1,
        `${purpose} expected exactly 1 occurrence of "${marker}", found ${count}`
      );
    }
  });
}

test("composed prompt for chat does NOT contain analysis-only sections", async () => {
  const prompt = await loadSystemPrompt("chat");
  assert.ok(!prompt.includes("<bundle_fields>"), "chat must not carry bundle_fields");
  assert.ok(!prompt.includes("<examples>"), "chat must not carry examples");
  assert.ok(!prompt.includes("<anti_patterns>"), "chat must not carry anti_patterns");
});

test("composed prompt for review does NOT contain analysis-only sections", async () => {
  const prompt = await loadSystemPrompt("review");
  assert.ok(!prompt.includes("<bundle_fields>"), "review must not carry bundle_fields");
  assert.ok(!prompt.includes("<examples>"), "review must not carry examples");
});

test("composed prompt for wrap does NOT contain analysis-only sections", async () => {
  const prompt = await loadSystemPrompt("wrap");
  assert.ok(!prompt.includes("<bundle_fields>"), "wrap must not carry bundle_fields");
  assert.ok(!prompt.includes("<examples>"), "wrap must not carry examples");
});
```

- [ ] **Step 2: Run the regression test**

```bash
node --test tests/system-prompt-partials.test.js
```
Expected: all tests pass (no partials extracted yet, but the phase files already contain every required section inline — the tests assert sections are present, which they are).

- [ ] **Step 3: Commit**

```bash
git add tests/system-prompt-partials.test.js
git commit -m "$(cat <<'EOF'
test: per-purpose composed-prompt regression for partials extraction

Asserts every required section marker appears exactly once in each
purpose's composed prompt, and that chat/wrap/review don't accidentally
absorb analysis-only sections. Guards against drops during the partials
migration that follows.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Extract `bundle-fields` partial

**Files:**
- Create: `app/main/prompts/partials/bundle-fields.md`
- Modify: `app/main/prompts/phase-bar-close.md`, `app/main/prompts/phase-brief.md`, `app/main/prompts/phase-catch-up.md`

- [ ] **Step 1: Create the partials directory**

```bash
mkdir -p app/main/prompts/partials
```

- [ ] **Step 2: Extract the bundle_fields block from phase-bar-close.md to the new partial**

Run this to copy the block exactly:

```bash
awk '/^<bundle_fields>/,/^<\/bundle_fields>/' app/main/prompts/phase-bar-close.md > app/main/prompts/partials/bundle-fields.md
```

Verify:
```bash
wc -c app/main/prompts/partials/bundle-fields.md
head -3 app/main/prompts/partials/bundle-fields.md
tail -3 app/main/prompts/partials/bundle-fields.md
```
Expected: ~5,650 chars. Starts with `<bundle_fields>`. Ends with `</bundle_fields>`.

- [ ] **Step 3: Verify byte-identity against brief + catch-up versions**

```bash
diff <(awk '/^<bundle_fields>/,/^<\/bundle_fields>/' app/main/prompts/phase-bar-close.md) <(awk '/^<bundle_fields>/,/^<\/bundle_fields>/' app/main/prompts/phase-brief.md)
diff <(awk '/^<bundle_fields>/,/^<\/bundle_fields>/' app/main/prompts/phase-bar-close.md) <(awk '/^<bundle_fields>/,/^<\/bundle_fields>/' app/main/prompts/phase-catch-up.md)
```
Expected: no output (no differences). If output appears, the three copies have drifted — STOP and investigate; PR 1 should have left them byte-identical.

- [ ] **Step 4: Replace the block in `phase-bar-close.md` with a marker**

Use a Node one-liner that does a literal block replacement:

```bash
node -e '
import("node:fs/promises").then(async fs => {
  const path = "app/main/prompts/phase-bar-close.md";
  const text = await fs.readFile(path, "utf8");
  const start = "<bundle_fields>";
  const end = "</bundle_fields>";
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1 || j <= i) throw new Error("block not found");
  const blockEnd = j + end.length;
  const replaced = text.slice(0, i) + "<!-- @partial:bundle-fields -->" + text.slice(blockEnd);
  await fs.writeFile(path, replaced);
  console.log("ok: " + path);
});
'
```

Expected: prints `ok: app/main/prompts/phase-bar-close.md`. The block has been replaced with `<!-- @partial:bundle-fields -->`.

- [ ] **Step 5: Repeat for phase-brief.md**

```bash
node -e '
import("node:fs/promises").then(async fs => {
  const path = "app/main/prompts/phase-brief.md";
  const text = await fs.readFile(path, "utf8");
  const start = "<bundle_fields>";
  const end = "</bundle_fields>";
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1 || j <= i) throw new Error("block not found");
  const blockEnd = j + end.length;
  const replaced = text.slice(0, i) + "<!-- @partial:bundle-fields -->" + text.slice(blockEnd);
  await fs.writeFile(path, replaced);
  console.log("ok: " + path);
});
'
```

- [ ] **Step 6: Repeat for phase-catch-up.md**

```bash
node -e '
import("node:fs/promises").then(async fs => {
  const path = "app/main/prompts/phase-catch-up.md";
  const text = await fs.readFile(path, "utf8");
  const start = "<bundle_fields>";
  const end = "</bundle_fields>";
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1 || j <= i) throw new Error("block not found");
  const blockEnd = j + end.length;
  const replaced = text.slice(0, i) + "<!-- @partial:bundle-fields -->" + text.slice(blockEnd);
  await fs.writeFile(path, replaced);
  console.log("ok: " + path);
});
'
```

- [ ] **Step 7: Verify byte-identical composed prompts**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all 6 purposes report `OK`. The composed phase output should equal the pre-PR baseline byte-for-byte.

If MISMATCH on bar-close, brief, or catch-up: read the diff output. Most likely cause is a stray newline from the substitution. Check that the partial file ends with `\n` and the substitution didn't leave doubled blank lines.

- [ ] **Step 8: Run the regression test suite**

```bash
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add app/main/prompts/partials/bundle-fields.md \
        app/main/prompts/phase-bar-close.md \
        app/main/prompts/phase-brief.md \
        app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract bundle_fields to partials/bundle-fields.md

Used by bar-close, brief, catch-up. Composed prompts byte-identical
to pre-PR baseline (scripts/verify-prompts-byte-identical.js OK).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Extract `ict-vocab` partial

**Files:**
- Create: `app/main/prompts/partials/ict-vocab.md`
- Modify: `app/main/prompts/phase-bar-close.md`, `app/main/prompts/phase-brief.md`, `app/main/prompts/phase-catch-up.md`

- [ ] **Step 1: Verify the block is byte-identical across the three files**

```bash
diff <(awk '/^<ict_vocabulary>/,/^<\/ict_vocabulary>/' app/main/prompts/phase-bar-close.md) <(awk '/^<ict_vocabulary>/,/^<\/ict_vocabulary>/' app/main/prompts/phase-brief.md)
diff <(awk '/^<ict_vocabulary>/,/^<\/ict_vocabulary>/' app/main/prompts/phase-bar-close.md) <(awk '/^<ict_vocabulary>/,/^<\/ict_vocabulary>/' app/main/prompts/phase-catch-up.md)
```
Expected: no output.

- [ ] **Step 2: Extract**

```bash
awk '/^<ict_vocabulary>/,/^<\/ict_vocabulary>/' app/main/prompts/phase-bar-close.md > app/main/prompts/partials/ict-vocab.md
wc -c app/main/prompts/partials/ict-vocab.md
```
Expected: ~2,220 chars.

- [ ] **Step 3: Replace the block in each phase file**

```bash
for f in app/main/prompts/phase-bar-close.md app/main/prompts/phase-brief.md app/main/prompts/phase-catch-up.md; do
  node -e "
  import('node:fs/promises').then(async fs => {
    const text = await fs.readFile('$f', 'utf8');
    const start = '<ict_vocabulary>';
    const end = '</ict_vocabulary>';
    const i = text.indexOf(start);
    const j = text.indexOf(end);
    if (i === -1 || j === -1 || j <= i) throw new Error('block not found in $f');
    const blockEnd = j + end.length;
    const replaced = text.slice(0, i) + '<!-- @partial:ict-vocab -->' + text.slice(blockEnd);
    await fs.writeFile('$f', replaced);
    console.log('ok: $f');
  });
  "
done
```

- [ ] **Step 4: Verify byte-identical**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all OK.

- [ ] **Step 5: Run tests**

```bash
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/main/prompts/partials/ict-vocab.md \
        app/main/prompts/phase-bar-close.md \
        app/main/prompts/phase-brief.md \
        app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract ict_vocabulary to partials/ict-vocab.md

Used by bar-close, brief, catch-up. Composed prompts byte-identical
to pre-PR baseline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Extract `alert-guidance-analysis` partial

**Files:**
- Create: `app/main/prompts/partials/alert-guidance-analysis.md`
- Modify: `app/main/prompts/phase-bar-close.md`, `app/main/prompts/phase-brief.md`, `app/main/prompts/phase-catch-up.md`

ALERT GUIDANCE is a header-style section (not a wrapped block). The extraction must capture from `## ALERT GUIDANCE` up to (but not including) the next `---` separator line.

- [ ] **Step 1: Inspect the ALERT GUIDANCE section in phase-bar-close.md**

```bash
awk '/^## ALERT GUIDANCE/{flag=1} flag{print} /^---$/ && flag && NR > 1 {if (++count == 1) exit}' app/main/prompts/phase-bar-close.md | head -20
```

Locate the exact boundary. The section runs from `## ALERT GUIDANCE — managing TradingView price alerts on the trader's behalf` to the first `---` line that follows.

- [ ] **Step 2: Verify it's byte-identical across the three files**

```bash
node -e "
import('node:fs/promises').then(async fs => {
  const extract = async (path) => {
    const text = await fs.readFile(path, 'utf8');
    const i = text.indexOf('## ALERT GUIDANCE');
    const j = text.indexOf('\n---\n', i);
    return text.slice(i, j);
  };
  const a = await extract('app/main/prompts/phase-bar-close.md');
  const b = await extract('app/main/prompts/phase-brief.md');
  const c = await extract('app/main/prompts/phase-catch-up.md');
  console.log('bar-close==brief:', a === b);
  console.log('bar-close==catch-up:', a === c);
  console.log('length:', a.length);
});
"
```
Expected: both equality checks true. Length ~1,400 chars.

If false: STOP. PR 1 left them identical; investigate any drift before continuing.

- [ ] **Step 3: Write the partial file**

```bash
node -e "
import('node:fs/promises').then(async fs => {
  const text = await fs.readFile('app/main/prompts/phase-bar-close.md', 'utf8');
  const i = text.indexOf('## ALERT GUIDANCE');
  const j = text.indexOf('\n---\n', i);
  const section = text.slice(i, j) + '\n';  // partial ends with one newline per convention
  await fs.writeFile('app/main/prompts/partials/alert-guidance-analysis.md', section);
  console.log('wrote', section.length, 'chars');
});
"
```

- [ ] **Step 4: Replace the section in each phase file**

```bash
for f in app/main/prompts/phase-bar-close.md app/main/prompts/phase-brief.md app/main/prompts/phase-catch-up.md; do
  node -e "
  import('node:fs/promises').then(async fs => {
    const text = await fs.readFile('$f', 'utf8');
    const i = text.indexOf('## ALERT GUIDANCE');
    const j = text.indexOf('\n---\n', i);
    if (i === -1 || j === -1) throw new Error('section not found in $f');
    const replaced = text.slice(0, i) + '<!-- @partial:alert-guidance-analysis -->' + text.slice(j);
    await fs.writeFile('$f', replaced);
    console.log('ok: $f');
  });
  "
done
```

- [ ] **Step 5: Verify byte-identical**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all OK.

- [ ] **Step 6: Run tests**

```bash
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/main/prompts/partials/alert-guidance-analysis.md \
        app/main/prompts/phase-bar-close.md \
        app/main/prompts/phase-brief.md \
        app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract analysis-time ALERT GUIDANCE to partial

Used by bar-close, brief, catch-up. The chat file has a different
ALERT GUIDANCE variant (alert-management focus) and stays inline.
Composed prompts byte-identical to pre-PR baseline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Extract `memory-guidance` partial

**Files:**
- Create: `app/main/prompts/partials/memory-guidance.md`
- Modify: `app/main/prompts/phase-chat.md`, `app/main/prompts/phase-wrap.md`, `app/main/prompts/phase-review.md`

The PERSISTENT MEMORY GUIDANCE section runs from `## PERSISTENT MEMORY GUIDANCE` to either end-of-file (in chat) or the next `---`/section boundary (in wrap, review).

- [ ] **Step 1: Inspect the memory section in chat (it runs to EOF)**

```bash
awk '/^## PERSISTENT MEMORY GUIDANCE/,EOF' app/main/prompts/phase-chat.md | wc -c
```
Expected: ~1,000 chars.

- [ ] **Step 2: Verify byte-identical across chat/wrap/review**

```bash
node -e "
import('node:fs/promises').then(async fs => {
  // chat: from header to EOF
  // wrap: from header to next blank-line-then-<phase
  // review: from header to next blank-line-then-<phase  OR EOF
  const extract = async (path) => {
    const text = await fs.readFile(path, 'utf8');
    const i = text.indexOf('## PERSISTENT MEMORY GUIDANCE');
    if (i === -1) throw new Error('not found in ' + path);
    // Search for next markdown section break (line starting with '<' or '## ')
    const remainder = text.slice(i + '## PERSISTENT MEMORY GUIDANCE'.length);
    const nextBreak = remainder.search(/\n(<phase|## |---\n)/);
    return text.slice(i, i + '## PERSISTENT MEMORY GUIDANCE'.length + (nextBreak === -1 ? remainder.length : nextBreak));
  };
  const a = (await extract('app/main/prompts/phase-chat.md')).trimEnd();
  const b = (await extract('app/main/prompts/phase-wrap.md')).trimEnd();
  const c = (await extract('app/main/prompts/phase-review.md')).trimEnd();
  console.log('chat==wrap:', a === b);
  console.log('chat==review:', a === c);
  console.log('length:', a.length);
});
"
```
Expected: both equality checks true. Length ~1,000 chars.

- [ ] **Step 3: Write the partial file**

```bash
node -e "
import('node:fs/promises').then(async fs => {
  const text = await fs.readFile('app/main/prompts/phase-chat.md', 'utf8');
  const i = text.indexOf('## PERSISTENT MEMORY GUIDANCE');
  const section = text.slice(i).trimEnd() + '\n';
  await fs.writeFile('app/main/prompts/partials/memory-guidance.md', section);
  console.log('wrote', section.length, 'chars');
});
"
```

- [ ] **Step 4: Replace the section in chat (runs to EOF)**

```bash
node -e "
import('node:fs/promises').then(async fs => {
  const path = 'app/main/prompts/phase-chat.md';
  const text = await fs.readFile(path, 'utf8');
  const i = text.indexOf('## PERSISTENT MEMORY GUIDANCE');
  if (i === -1) throw new Error('not found');
  const replaced = text.slice(0, i) + '<!-- @partial:memory-guidance -->\n';
  await fs.writeFile(path, replaced);
  console.log('ok:', path);
});
"
```

- [ ] **Step 5: Replace the section in wrap (followed by `<phase name=\"post_session\">`)**

```bash
node -e "
import('node:fs/promises').then(async fs => {
  const path = 'app/main/prompts/phase-wrap.md';
  const text = await fs.readFile(path, 'utf8');
  const i = text.indexOf('## PERSISTENT MEMORY GUIDANCE');
  const j = text.indexOf('<phase name=\"post_session\"', i);
  if (i === -1 || j === -1) throw new Error('not found in ' + path);
  const replaced = text.slice(0, i) + '<!-- @partial:memory-guidance -->\n\n' + text.slice(j);
  await fs.writeFile(path, replaced);
  console.log('ok:', path);
});
"
```

- [ ] **Step 6: Replace the section in review (runs to EOF, similar to chat)**

```bash
node -e "
import('node:fs/promises').then(async fs => {
  const path = 'app/main/prompts/phase-review.md';
  const text = await fs.readFile(path, 'utf8');
  const i = text.indexOf('## PERSISTENT MEMORY GUIDANCE');
  if (i === -1) throw new Error('not found');
  const replaced = text.slice(0, i) + '<!-- @partial:memory-guidance -->\n';
  await fs.writeFile(path, replaced);
  console.log('ok:', path);
});
"
```

- [ ] **Step 7: Verify byte-identical**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all OK.

If `chat` or `review` mismatches: check the trailing newline handling — the file should still end with a single `\n` (matches the convention; matches what was there before).

- [ ] **Step 8: Run tests**

```bash
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add app/main/prompts/partials/memory-guidance.md \
        app/main/prompts/phase-chat.md \
        app/main/prompts/phase-wrap.md \
        app/main/prompts/phase-review.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract PERSISTENT MEMORY GUIDANCE to partial

Used by chat, wrap, review. Composed prompts byte-identical to
pre-PR baseline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Extract `open-reaction-phase` partial

**Files:**
- Create: `app/main/prompts/partials/open-reaction-phase.md`
- Modify: `app/main/prompts/phase-bar-close.md`, `app/main/prompts/phase-catch-up.md`

- [ ] **Step 1: Verify byte-identical**

```bash
diff <(awk '/^<phase name="open_reaction">/,/^<\/phase>/' app/main/prompts/phase-bar-close.md) <(awk '/^<phase name="open_reaction">/,/^<\/phase>/' app/main/prompts/phase-catch-up.md)
```
Expected: no output.

- [ ] **Step 2: Extract**

There are multiple `<phase>` opens and closes in catch-up. The `awk` range pattern needs to capture from `<phase name="open_reaction">` to its matching `</phase>`. Since `awk` ranges are first-match-to-first-end, this works for bar-close (which has the open_reaction phase first) and for catch-up (where open_reaction is the FIRST phase block).

```bash
awk '/^<phase name="open_reaction">/{f=1} f{print} /^<\/phase>$/{if(f){f=0; exit}}' app/main/prompts/phase-bar-close.md > app/main/prompts/partials/open-reaction-phase.md
wc -c app/main/prompts/partials/open-reaction-phase.md
```
Expected: ~6,138 chars.

- [ ] **Step 3: Replace the block in bar-close + catch-up**

```bash
for f in app/main/prompts/phase-bar-close.md app/main/prompts/phase-catch-up.md; do
  node -e "
  import('node:fs/promises').then(async fs => {
    const text = await fs.readFile('$f', 'utf8');
    const start = '<phase name=\"open_reaction\">';
    const i = text.indexOf(start);
    if (i === -1) throw new Error('open_reaction not found in $f');
    // Find the matching </phase> — first one after `i`
    const endTag = '</phase>';
    const j = text.indexOf(endTag, i);
    if (j === -1) throw new Error('closing </phase> not found in $f');
    const blockEnd = j + endTag.length;
    const replaced = text.slice(0, i) + '<!-- @partial:open-reaction-phase -->' + text.slice(blockEnd);
    await fs.writeFile('$f', replaced);
    console.log('ok: $f');
  });
  "
done
```

- [ ] **Step 4: Verify byte-identical**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all OK.

- [ ] **Step 5: Run tests**

```bash
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/main/prompts/partials/open-reaction-phase.md \
        app/main/prompts/phase-bar-close.md \
        app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract <phase open_reaction> to partial

Used by bar-close, catch-up. Composed prompts byte-identical to
pre-PR baseline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Extract `entry-hunt-phase` partial

**Files:**
- Create: `app/main/prompts/partials/entry-hunt-phase.md`
- Modify: `app/main/prompts/phase-bar-close.md`, `app/main/prompts/phase-catch-up.md`

- [ ] **Step 1: Verify byte-identical**

```bash
diff <(awk '/^<phase name="entry_hunt">/{f=1} f{print} /^<\/phase>$/{if(f){f=0; exit}}' app/main/prompts/phase-bar-close.md) <(awk '/^<phase name="entry_hunt">/{f=1} f{print} /^<\/phase>$/{if(f){f=0; exit}}' app/main/prompts/phase-catch-up.md)
```
Expected: no output.

- [ ] **Step 2: Extract from bar-close**

```bash
awk '/^<phase name="entry_hunt">/{f=1} f{print} /^<\/phase>$/{if(f){f=0; exit}}' app/main/prompts/phase-bar-close.md > app/main/prompts/partials/entry-hunt-phase.md
wc -c app/main/prompts/partials/entry-hunt-phase.md
```
Expected: ~2,701 chars.

- [ ] **Step 3: Replace the block in bar-close + catch-up**

```bash
for f in app/main/prompts/phase-bar-close.md app/main/prompts/phase-catch-up.md; do
  node -e "
  import('node:fs/promises').then(async fs => {
    const text = await fs.readFile('$f', 'utf8');
    const start = '<phase name=\"entry_hunt\">';
    const i = text.indexOf(start);
    if (i === -1) throw new Error('entry_hunt not found in $f');
    const endTag = '</phase>';
    const j = text.indexOf(endTag, i);
    if (j === -1) throw new Error('closing </phase> not found in $f');
    const blockEnd = j + endTag.length;
    const replaced = text.slice(0, i) + '<!-- @partial:entry-hunt-phase -->' + text.slice(blockEnd);
    await fs.writeFile('$f', replaced);
    console.log('ok: $f');
  });
  "
done
```

- [ ] **Step 4: Verify + test + commit**

```bash
node scripts/verify-prompts-byte-identical.js
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
git add app/main/prompts/partials/entry-hunt-phase.md \
        app/main/prompts/phase-bar-close.md \
        app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract <phase entry_hunt> to partial

Used by bar-close, catch-up. Composed prompts byte-identical to
pre-PR baseline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Extract `anti-patterns` partial

**Files:**
- Create: `app/main/prompts/partials/anti-patterns.md`
- Modify: `app/main/prompts/phase-bar-close.md`, `app/main/prompts/phase-catch-up.md`

- [ ] **Step 1: Verify byte-identical**

```bash
diff <(awk '/^<anti_patterns>/,/^<\/anti_patterns>/' app/main/prompts/phase-bar-close.md) <(awk '/^<anti_patterns>/,/^<\/anti_patterns>/' app/main/prompts/phase-catch-up.md)
```
Expected: no output.

- [ ] **Step 2: Extract**

```bash
awk '/^<anti_patterns>/,/^<\/anti_patterns>/' app/main/prompts/phase-bar-close.md > app/main/prompts/partials/anti-patterns.md
wc -c app/main/prompts/partials/anti-patterns.md
```
Expected: ~2,280 chars.

- [ ] **Step 3: Replace**

```bash
for f in app/main/prompts/phase-bar-close.md app/main/prompts/phase-catch-up.md; do
  node -e "
  import('node:fs/promises').then(async fs => {
    const text = await fs.readFile('$f', 'utf8');
    const start = '<anti_patterns>';
    const end = '</anti_patterns>';
    const i = text.indexOf(start);
    const j = text.indexOf(end);
    if (i === -1 || j === -1) throw new Error('block not found in $f');
    const replaced = text.slice(0, i) + '<!-- @partial:anti-patterns -->' + text.slice(j + end.length);
    await fs.writeFile('$f', replaced);
    console.log('ok: $f');
  });
  "
done
```

- [ ] **Step 4: Verify + test + commit**

```bash
node scripts/verify-prompts-byte-identical.js
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
git add app/main/prompts/partials/anti-patterns.md \
        app/main/prompts/phase-bar-close.md \
        app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract <anti_patterns> to partial

Used by bar-close, catch-up. Composed prompts byte-identical to
pre-PR baseline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Extract `examples` partial

**Files:**
- Create: `app/main/prompts/partials/examples.md`
- Modify: `app/main/prompts/phase-bar-close.md`, `app/main/prompts/phase-catch-up.md`

- [ ] **Step 1: Verify byte-identical**

```bash
diff <(awk '/^<examples>/,/^<\/examples>/' app/main/prompts/phase-bar-close.md) <(awk '/^<examples>/,/^<\/examples>/' app/main/prompts/phase-catch-up.md)
```
Expected: no output.

- [ ] **Step 2: Extract**

```bash
awk '/^<examples>/,/^<\/examples>/' app/main/prompts/phase-bar-close.md > app/main/prompts/partials/examples.md
wc -c app/main/prompts/partials/examples.md
```
Expected: ~6,508 chars.

- [ ] **Step 3: Replace**

```bash
for f in app/main/prompts/phase-bar-close.md app/main/prompts/phase-catch-up.md; do
  node -e "
  import('node:fs/promises').then(async fs => {
    const text = await fs.readFile('$f', 'utf8');
    const start = '<examples>';
    const end = '</examples>';
    const i = text.indexOf(start);
    const j = text.indexOf(end);
    if (i === -1 || j === -1) throw new Error('block not found in $f');
    const replaced = text.slice(0, i) + '<!-- @partial:examples -->' + text.slice(j + end.length);
    await fs.writeFile('$f', replaced);
    console.log('ok: $f');
  });
  "
done
```

- [ ] **Step 4: Verify + test + commit**

```bash
node scripts/verify-prompts-byte-identical.js
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
git add app/main/prompts/partials/examples.md \
        app/main/prompts/phase-bar-close.md \
        app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract <examples> block to partial

Five A+/B/no-trade worked examples used by bar-close, catch-up.
Composed prompts byte-identical to pre-PR baseline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Extract `output-json` partial

**Files:**
- Create: `app/main/prompts/partials/output-json.md`
- Modify: `app/main/prompts/phase-bar-close.md`, `app/main/prompts/phase-catch-up.md`

- [ ] **Step 1: Verify byte-identical**

```bash
diff <(awk '/^<output_json>/,/^<\/output_json>/' app/main/prompts/phase-bar-close.md) <(awk '/^<output_json>/,/^<\/output_json>/' app/main/prompts/phase-catch-up.md)
```
Expected: no output.

- [ ] **Step 2: Extract**

```bash
awk '/^<output_json>/,/^<\/output_json>/' app/main/prompts/phase-bar-close.md > app/main/prompts/partials/output-json.md
wc -c app/main/prompts/partials/output-json.md
```
Expected: ~629 chars.

- [ ] **Step 3: Replace**

```bash
for f in app/main/prompts/phase-bar-close.md app/main/prompts/phase-catch-up.md; do
  node -e "
  import('node:fs/promises').then(async fs => {
    const text = await fs.readFile('$f', 'utf8');
    const start = '<output_json>';
    const end = '</output_json>';
    const i = text.indexOf(start);
    const j = text.indexOf(end);
    if (i === -1 || j === -1) throw new Error('block not found in $f');
    const replaced = text.slice(0, i) + '<!-- @partial:output-json -->' + text.slice(j + end.length);
    await fs.writeFile('$f', replaced);
    console.log('ok: $f');
  });
  "
done
```

- [ ] **Step 4: Verify + test + commit**

```bash
node scripts/verify-prompts-byte-identical.js
node --test tests/system-prompt-partials.test.js tests/system-prompt.test.js tests/prompt-composer.test.js
git add app/main/prompts/partials/output-json.md \
        app/main/prompts/phase-bar-close.md \
        app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
refactor(prompts): extract <output_json> to partial

Used by bar-close, catch-up. Composed prompts byte-identical to
pre-PR baseline. All 9 dedupable blocks now extracted.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Full verification — tests, smoke fixtures, snapshot comparison

**Files:** none modified

- [ ] **Step 1: Run the full unit test suite**

```bash
cd app && npm run test
```
Expected: all green. If a pre-existing failure exists (PR 1 left one known-fail), confirm it's unchanged — no new failures introduced.

- [ ] **Step 2: Run smoke fixtures**

```bash
cd .. && npm run smoke:fixtures
```
Expected: 16/16 fixtures pass.

- [ ] **Step 3: Run byte-identical verifier one more time**

```bash
node scripts/verify-prompts-byte-identical.js
```
Expected: all 6 purposes OK.

- [ ] **Step 4: Run trigram-overlap diff script as belt-and-suspenders**

```bash
node scripts/diff-prompt-shape.js
```
Expected: all purposes show ~100% trigram overlap. Since byte-identical, overlap must be 100.0%.

- [ ] **Step 5: Confirm composed prompt sizes match pre-PR baseline**

```bash
node -e "
import('./app/main/sdk.js').then(async m => {
  for (const p of ['chat','review','wrap','brief','bar-close','catch-up']) {
    const s = await m._loadSystemPromptForTests(p);
    console.log(p.padEnd(12), s.length, 'chars');
  }
});
"
```
Expected:
- chat: ~7,763 chars
- review: ~8,384 chars
- wrap: ~9,290 chars
- brief: ~24,249 chars
- bar-close: ~33,388 chars
- catch-up: ~34,287 chars

Within ±50 bytes of pre-PR baseline. If significantly off, something has drifted — investigate.

---

### Task 18: Manual smoke (Electron boot + brief turn + bar-close turn)

**Files:** none modified

- [ ] **Step 1: Start the Electron app**

```bash
cd app && npm run dev
```

Wait for `[sdk] init ok` lines in console.

- [ ] **Step 2: Observe prompt-length log lines**

In the console, look for lines like:
```
[sdk] init ok, prompt length (bar-close) 33388
[sdk] init ok, prompt length (brief) 24249
...
```

Each should match the pre-PR baseline within ±50 bytes (per Task 17 Step 5 expected values).

- [ ] **Step 3: Fire one brief turn (via UI REFRESH or trigger)**

Trigger a session brief through the workstation UI. Watch the console for:
- `tool_call` events
- A `surface_session_brief` call (proves the brief turn ran and emitted)
- No `[sdk] error` / `[sdk] retry` lines that aren't pre-existing

If the brief renders successfully in the PREP panel, the brief turn worked.

- [ ] **Step 4: Fire one bar-close turn**

Wait for the next bar close (1 minute boundary). Watch the console for:
- A bar-close turn entry log
- `tool_call` events (`tv_analyze_fast` + either `surface_setup` or `surface_no_trade`)
- The LIVE panel updating

If the LIVE panel updates without an error toast, the bar-close turn worked.

- [ ] **Step 5: Stop the app**

`Cmd-Q` or close the window.

- [ ] **Step 6: No commit (manual smoke only)**

Manual smoke passes → proceed to Task 19. If anything failed, debug and fix before continuing.

---

### Task 19: Update CLAUDE.md with architecture-decision row

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Open CLAUDE.md and find the decision table**

```bash
grep -n "| 2026-05-27 | Prompt kernel split" CLAUDE.md
```
Locate the row for PR 1 — the new row goes immediately after it.

- [ ] **Step 2: Append the PR 2 row**

Insert this row in the architecture-decisions table, after the PR 1 (Prompt kernel split) row:

```
| 2026-05-27 | Prompt partials extraction — dedup byte-identical blocks into `partials/<name>.md` | PR 1 left 9 byte-identical blocks duplicated across 2-3 phase files each (~38 KB of disk duplication). bar-close and catch-up were 92% identical; brief shared `<bundle_fields>` + `<ict_vocabulary>` + `## ALERT GUIDANCE`; chat/wrap/review shared `## PERSISTENT MEMORY GUIDANCE`. Drift risk: editing any block required matching edits across all consumers. **This PR (2 of 3):** `app/main/prompts/partials/` with 9 single-source files (bundle-fields, ict-vocab, alert-guidance-analysis, memory-guidance, open-reaction-phase, entry-hunt-phase, examples, anti-patterns, output-json). Each phase file embeds `<!-- @partial:NAME -->` markers in place of the extracted blocks. `loadSystemPrompt(purpose)` scans the phase body, reads each referenced partial via the existing mtime cache, and substitutes. Pure helpers in `app/main/prompt-composer.js` (`findPartialReferences` + `composePhaseWithPartials`) so unit tests don't boot Electron. Composed prompts byte-identical to pre-PR baseline for all 6 purposes (verified by `scripts/verify-prompts-byte-identical.js` — exits 0). **Verification:** new `tests/prompt-composer.test.js` (14 unit tests) + new `tests/system-prompt-partials.test.js` (per-purpose section-marker + no-duplicate + no-cross-contamination) + smoke fixtures 16/16 + manual smoke (Electron boot + brief turn + bar-close turn). **Token cost unchanged** — same bytes ship to the model per turn. Win is single-source-of-truth + drift elimination + cheaper future edits. **Out of scope:** Token reduction (would require per-purpose dropping of partials; deferred), Skill-tool wiring (risky for load-bearing examples), cache-breakpoint fix (PR 3). Spec: [docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md](docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md). Plan: [docs/superpowers/plans/2026-05-27-prompt-partials-extraction.md](docs/superpowers/plans/2026-05-27-prompt-partials-extraction.md). |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude.md): record prompt partials extraction decision

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Push branch + open PR

**Files:** none modified

- [ ] **Step 1: Push branch to origin**

```bash
git push -u origin feat/prompt-partials-extraction
```
Expected: branch created on origin.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(prompts): extract 9 duplicated blocks to single-source partials" --body "$(cat <<'EOF'
## Summary

PR 2 of 3 in the prompt-engineering series ([PR 1](https://github.com/ghxstofnq/claude-tradingview-analyser/pull/68) shipped the kernel split).

Deduplicates 9 byte-identical prompt blocks into single-source `partials/<name>.md` files. Phase files embed `<!-- @partial:NAME -->` markers; `loadSystemPrompt(purpose)` substitutes at load time. **Composed prompts byte-identical to pre-PR baseline** (verified by `scripts/verify-prompts-byte-identical.js`).

## What changes on disk

- 9 new partials in `app/main/prompts/partials/` (bundle-fields, ict-vocab, alert-guidance-analysis, memory-guidance, open-reaction-phase, entry-hunt-phase, examples, anti-patterns, output-json) — ~25 KB total
- 6 phase files shrink — bar-close 29 KB → ~3 KB, catch-up 30 KB → ~5 KB, brief 19 KB → ~7 KB, chat/wrap/review lose ~1 KB each
- 1 new pure helper module `app/main/prompt-composer.js`
- `app/main/sdk.js#loadSystemPrompt` extended (~30 line diff)
- ~38 KB of duplicated bytes on disk → ~25 KB single-source

## What does NOT change

- Composed system prompt the model sees on every turn (byte-identical)
- Per-turn token cost
- Model behavior

## Test plan

- [x] `node --test tests/prompt-composer.test.js` — 14 unit tests pass
- [x] `node --test tests/system-prompt-partials.test.js` — per-purpose section-marker + no-duplicate + no-cross-contamination pass
- [x] `node --test tests/system-prompt.test.js` — PR 1's regression tests still pass
- [x] `npm run smoke:fixtures` — 16/16
- [x] `node scripts/verify-prompts-byte-identical.js` — all 6 purposes OK
- [x] `node scripts/diff-prompt-shape.js` — ~100% trigram overlap for all purposes
- [x] Manual smoke: Electron boot + brief turn + bar-close turn — green

Spec: [docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md](docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md)
Plan: [docs/superpowers/plans/2026-05-27-prompt-partials-extraction.md](docs/superpowers/plans/2026-05-27-prompt-partials-extraction.md)

Out of scope: token reduction (separate PR), cache-breakpoint placement fix (PR 3).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Capture PR URL**

```bash
gh pr view --web
```

Done. Report the PR URL back to the user.

---

## Cross-reference: where each spec requirement is covered

| Spec section | Task(s) |
|---|---|
| Composition mechanism (`findPartialReferences` + `composePhaseWithPartials`) | Tasks 3-5 |
| Loader changes in `app/main/sdk.js` | Task 6 |
| Per-phase markers in body order (per-partial) | Tasks 8-16 |
| Nine partial files under `partials/` | Tasks 8-16 |
| Per-purpose section-marker tests | Task 7 |
| No-duplicate tests | Task 7 (`assert.equal(count, 1, ...)`) and `findPartialReferences` throws on dup |
| Trigram overlap ≥ 99.5% | Task 17 (run `diff-prompt-shape.js`); strict byte-identical via Task 17 (`verify-prompts-byte-identical.js`) — supersedes trigram threshold |
| Smoke fixtures 16/16 | Task 17 |
| Unit suite no regression | Task 17 |
| Manual smoke ±50 bytes | Task 18 |
| CLAUDE.md decision row | Task 19 |
| PR opened off `main` | Task 20 |

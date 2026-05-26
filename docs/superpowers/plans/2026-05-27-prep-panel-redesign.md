# PREP Panel Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `app/renderer/src/Prep.jsx` to mirror the strategy doc's 7-step checklist; promote SCENARIOS from a buried subsection to a first-class panel with grade pills; collapse stale-banner + diff + chain-chip + refresh into one STATUS STRIP; group untaken levels above/below current price; extend the brief scenarios Zod additively (id + grade + target).

**Architecture:** All data wiring stays — `useSessionBrief`, `useSessionRecap`, alert prop drilling, refresh + progress IPC. Two pure helpers (level grouping, pillar selection) extracted to `Prep.helpers.js` so they can be unit-tested with `node --test` (the project's only test runner — no Vitest). JSX panels are tested visually via Electron + the existing fixture corpus. Schema change is additive: old briefs on disk stay readable (renderer falls back to "—"), new briefs require the new fields via Zod parse.

**Tech Stack:** React 18 (Vite + Babel via `@vitejs/plugin-react`), Zod (via Claude Agent SDK), `node --test` runner, existing IPC plumbing through `app/main/preload.cjs`.

**Spec:** [docs/superpowers/specs/2026-05-26-prep-panel-redesign.md](../specs/2026-05-26-prep-panel-redesign.md)

**Branch:** `feat/prep-panel-redesign` — cut from `main` after the model-sonnet and alerts-timeout PRs land. If those PRs aren't merged yet, cut from `main` anyway — there's no file overlap.

---

## File Inventory

**Created:**
- `app/renderer/src/Prep.helpers.js` — pure helpers (`groupLevelsByPrice`, `selectPillar`, `pillar2ToRows`, `formatChainChip`).
- `tests/prep-helpers.test.js` — node test for the four helpers above.

**Modified:**
- `app/main/sdk.js` — extend `surface_session_brief` tool Zod for scenarios.
- `app/main/prompts/analyze.md` — `Step 6 — Scenarios` block rewrite.
- `.claude/commands/analyze.md` — mirror of the above.
- `app/renderer/src/Shared.jsx` — add `ScenarioCard` export.
- `app/renderer/src/Prep.jsx` — full restructure (new panel components, new layout).
- `app/renderer/src/App.jsx` — drill `currentPrice` prop into `<PrepWorkstation>` from `useSymbolCache`.
- `app/renderer/src/app.css` — additive only (`.status-strip`, `.untaken-block`, `.scn-card-full`, `.pillar-headline`, `.step-meta`).
- `tests/brief-flow.test.js` — extend `VALID_PRIMARY_BRIEF` with the new scenario fields + 3 new test cases for the Zod schema.
- `CLAUDE.md` — append a decisions-table row for the PREP redesign.

**Untouched (explicit non-scope):**
- `app/renderer/src/Live.jsx`, `app/renderer/src/Review.jsx`, `app/renderer/src/TvChart.jsx`
- `app/renderer/src/hooks/*` — no hook changes
- `app/main/session-brief.js`, `app/main/tools/surface.js` — schema enforcement stays where it is

---

## Task Dependency Graph

```
Task 1 (branch)
  └─ Task 2 (Zod delta) ─────────┐
       └─ Task 3 (Zod tests) ────┤
            └─ Task 4 (prompts) ─┤
                                 │
Task 5 (CSS additions) ──────────┤
                                 │
Task 6 (helpers) ──────────────┐ │
  └─ Task 7 (helper tests) ────┤ │
                               │ │
Task 8 (ScenarioCard) ─────────┼─┼─┐
                               │ │ │
Task 9 (StatusStrip)    ───────┼─┤ │
Task 10 (Step1Panel)    ───────┼─┤ │
Task 11 (Step2Panel)    ───────┤ │ │
Task 12 (Step3Panel)    ───────┤ │ │
Task 13 (GradeHeadline) ───────┘ │ │
                                 ↓ ↓
Task 14 (Prep.jsx integration) ─┐
  └─ Task 15 (App.jsx wiring) ──┤
       └─ Task 16 (full run) ───┤
            └─ Task 17 (CLAUDE.md row) ──┐
                                          ↓
                            Task 18 (final commit + PR)
```

Tasks 6, 8-13, and the CSS task can be parallelised; everything else is sequential. The recommended subagent execution order is 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18.

---

### Task 1: Cut branch + sanity baseline

**Files:**
- No files yet — verify a clean working state.

- [ ] **Step 1: Check current branch state**

Run: `git status`
Expected: clean tree on `main` (or current working branch). If dirty, stash before proceeding.

- [ ] **Step 2: Pull latest main**

Run:
```bash
git checkout main
git pull
```
Expected: fast-forward to latest origin/main.

- [ ] **Step 3: Cut feature branch**

Run: `git checkout -b feat/prep-panel-redesign`
Expected: switched to new branch.

- [ ] **Step 4: Run baseline tests**

Run: `npm run test:unit`
Expected: all existing tests pass. Note the count for comparison after this work.

- [ ] **Step 5: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: 8/8 fixtures pass (or whatever current count). Note for comparison.

- [ ] **Step 6: Commit empty branch start marker (optional)**

Skip — first real commit comes from Task 2.

---

### Task 2: Extend the scenarios Zod schema (additive)

**Files:**
- Modify: `app/main/sdk.js:608-611`

- [ ] **Step 1: Read the current scenarios block**

Open `app/main/sdk.js` and find the existing scenarios definition around line 608:

```js
scenarios: z.array(z.object({
  condition: z.string().describe("Trigger condition — 'NY opens above 21487.25 (PDH)', 'sweep of Asia low without close back'"),
  action: z.string().describe("Reaction / bias — 'long continuation toward 21528', 'short reversal targeting AS_L'"),
})).min(1).max(4).describe("Structured IF/THEN scenarios for the open. Min 1, max 4 — keep it tight, the trader reads these live."),
```

- [ ] **Step 2: Replace with the extended schema**

Replace the block above with:

```js
scenarios: z.array(z.object({
  // Stable id for React keys + cross-references. e.g. "scn-1", "scn-2".
  id: z.string().describe("Stable id — 'scn-1', 'scn-2'. Used as a React key and as an anchor for future cross-references."),
  // Per-scenario grade (NOT the overall pre-session grade — that's
  // pillar_grade above). Tells the trader at a glance whether this
  // scenario is the prime candidate or a fallback.
  grade: z.enum(["A+", "B", "no-trade"]).describe("Grade for THIS scenario if it fires — independent of pillar_grade. A+ when all six elements would align if the trigger fires; B if one weaker; no-trade if a defensive scenario."),
  // condition stays — UI labels this row "TRIGGER" but the field name
  // is preserved for backward compatibility with briefs already on disk.
  condition: z.string().describe("Trigger condition — 'NY opens above 21487.25 (PDH)', 'sweep of Asia low without close back'. UI labels this row 'TRIGGER'."),
  action: z.string().describe("Reaction / bias — 'long continuation toward 21528.50 (PWH); stop below 21450.50 (AS_L)'"),
  // Anchored target with a citation. Must contain a digit so the
  // verifier and humans both know there's a real number behind it.
  target: z.string().refine((s) => /\d/.test(s), {
    message: "target must contain a cited price (a digit) — e.g. '21 528.50 (PWH)' or '21420 (engine.levels.PWH)'",
  }).describe("Anchored target with citation — e.g. '21 528.50 (PWH)' or '21 420 (engine_by_tf.h4.fvgs[0].top)'"),
})).min(1).max(4).describe("Structured scenarios for the open. Min 1, max 4 — keep it tight, the trader reads these live. Each scenario carries its own grade so the trader sees the prime candidate at a glance."),
```

- [ ] **Step 3: Verify the file still parses**

Run: `node -e "import('./app/main/sdk.js').then(() => console.log('ok')).catch((e) => { console.error(e.message); process.exit(1); })"`
Expected: prints `ok` (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add app/main/sdk.js
git commit -m "feat(brief): extend scenarios schema with id + grade + target

Additive change. Old field 'condition' kept (UI labels it 'TRIGGER').
Three new required fields:
- id: stable React key + future cross-reference anchor
- grade: per-scenario A+/B/no-trade
- target: cited price with digit-presence refine

Breaks no existing briefs on disk — they're rendered, not re-validated.
New briefs must include the fields or surface_session_brief throws.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Test the extended schema

**Files:**
- Modify: `tests/brief-flow.test.js:31-51` (extend `VALID_PRIMARY_BRIEF`), and append three new test cases at the end of the file.

- [ ] **Step 1: Update VALID_PRIMARY_BRIEF**

Find the existing `VALID_PRIMARY_BRIEF` (around line 31) and replace its scenarios-less shape with one that includes the new fields. The brief currently doesn't carry a `scenarios` field in the test fixture — add it:

In `tests/brief-flow.test.js`, find the `VALID_PRIMARY_BRIEF` const (line 31) and ADD these fields above the closing `}`:

```js
  scenarios: [
    {
      id: "scn-1",
      grade: "A+",
      condition: "sweep of AS.L at 21290 (engine.levels.AS_L) + 5m MSS up",
      action: "MSS long on the 5m FVG retest, stop below the sweep wick",
      target: "21 420 (engine.levels.PWH)",
    },
  ],
  plan: "look for MSS at PDH",
```

(The `plan` field probably exists already — keep one copy of it.)

- [ ] **Step 2: Write failing test — schema accepts new shape**

Add this `describe` block at the END of `tests/brief-flow.test.js`:

```js
// Scenarios schema extension (PREP redesign, 2026-05-27).
describe("brief flow — scenarios schema (PREP redesign)", () => {
  it("accepts the new scenarios shape (id + grade + condition + action + target)", async () => {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    const dir = path.join(SANDBOX, "schema-new-shape");
    process.env.GOFNQ_BRIEF_DIR_OVERRIDE = dir;
    await fs.mkdir(dir, { recursive: true });
    const payload = {
      ...VALID_PRIMARY_BRIEF,
      scenarios: [
        {
          id: "scn-1",
          grade: "A+",
          condition: "sweep of AS.L (engine.levels.AS_L)",
          action: "MSS long, stop below sweep wick",
          target: "21 420 (engine.levels.PWH)",
        },
      ],
    };
    // Should not throw.
    const result = await surfaceSessionBrief(payload);
    assert.equal(result.ok, true);
    delete process.env.GOFNQ_BRIEF_DIR_OVERRIDE;
  });
});
```

- [ ] **Step 3: Run the test — see if it passes the surface layer**

Run: `node --test tests/brief-flow.test.js`
Expected: this case passes (the surface layer doesn't enforce the Zod — Zod runs at the SDK tool boundary). If it passes immediately, the new schema isn't enforced at the surface layer (which is correct — Zod is at the tool call). Either result is fine; the test serves as documentation.

- [ ] **Step 4: Add a Zod-direct test**

Append below the previous test (still inside the same `describe`):

```js
  it("Zod tool schema rejects scenarios missing the new fields", async () => {
    // Import Zod to construct an equivalent schema for direct validation.
    const { z } = await import("zod");
    // Mirror the production schema for scenarios (sdk.js).
    const scenarioSchema = z.object({
      id: z.string(),
      grade: z.enum(["A+", "B", "no-trade"]),
      condition: z.string(),
      action: z.string(),
      target: z.string().refine((s) => /\d/.test(s)),
    });
    // Missing id, grade, target → should reject.
    const result = scenarioSchema.safeParse({
      condition: "x",
      action: "y",
    });
    assert.equal(result.success, false);
  });

  it("Zod tool schema rejects target without a digit", async () => {
    const { z } = await import("zod");
    const scenarioSchema = z.object({
      id: z.string(),
      grade: z.enum(["A+", "B", "no-trade"]),
      condition: z.string(),
      action: z.string(),
      target: z.string().refine((s) => /\d/.test(s)),
    });
    // target without a digit — refine should fail.
    const result = scenarioSchema.safeParse({
      id: "scn-1",
      grade: "A+",
      condition: "x",
      action: "y",
      target: "PWH",
    });
    assert.equal(result.success, false);
  });
```

- [ ] **Step 5: Run the new tests**

Run: `node --test tests/brief-flow.test.js`
Expected: all 3 new cases pass. Note: the existing test suite should still pass — if `VALID_PRIMARY_BRIEF` is used elsewhere and breaks, fix those call sites by adding the new fields.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:unit`
Expected: all tests pass. The new tests are the only delta in pass count.

- [ ] **Step 7: Commit**

```bash
git add tests/brief-flow.test.js
git commit -m "test(brief): cover scenarios schema extension

- VALID_PRIMARY_BRIEF gains the new scenarios fields
- 3 new cases: accepts new shape, rejects missing fields, rejects digit-less target

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Update the analyze.md prompt for Step 6

**Files:**
- Modify: `app/main/prompts/analyze.md:336-344` (Step 6 — Scenarios block)
- Modify: `.claude/commands/analyze.md` (mirror — search for the same block)

- [ ] **Step 1: Open the prompt and find Step 6**

Open `app/main/prompts/analyze.md`, navigate to line 336 (the `### Step 6 — Scenarios` heading).

- [ ] **Step 2: Replace the Step 6 block**

Replace lines 336-344 (the `### Step 6 — Scenarios` heading and its body) with:

```markdown
### Step 6 — Scenarios

Build 2 to 4 scenarios. Each is the if/then plan for a specific entry trigger. Five required fields per scenario:

- `id`: stable short id — `"scn-1"`, `"scn-2"`.
- `grade`: per-scenario grade (`"A+"`, `"B"`, or `"no-trade"`). A+ when all six elements would align if the trigger fires; B if exactly one is weaker; no-trade for defensive scenarios where you'd stand aside. **This is independent of `pillar_grade`** — the overall pre-session grade above. A `pillar_grade=B` brief can still carry an A+ scenario (the A+ requires the trigger to fire AND Pillar 3 to confirm).
- `condition`: trigger condition with cited prices — `"NY opens above 21487.25 (PDH) and holds for 1 closed bar"`. UI labels this row "TRIGGER".
- `action`: reaction / bias — `"long continuation toward 21528.50 (PWH); stop below 21450.50 (AS_L)"`.
- `target`: anchored target with citation — `"21 528.50 (PWH)"` or `"21 420 (engine_by_tf.h4.fvgs[0].top)"`. Must contain a digit; Zod refines on this.

Cite from `brief_digest.symbols.<sym>.ltf_context.*` or `pillar1.session_levels.*`. Never invent a level not in the bundle.

**A+ example:**
```json
{
  "id": "scn-1",
  "grade": "A+",
  "condition": "sweep of AS.L at 21 290 (pillar1.session_levels.AS_L) + 5m MSS up + tap of 4H FVG 21 300-21 320 (engine_by_tf.h4.fvgs[0])",
  "action": "MSS long on the 5m FVG retest, stop below the sweep wick",
  "target": "21 420 (pillar1.session_levels.PWH)"
}
```
```

- [ ] **Step 3: Mirror to .claude/commands/analyze.md**

Open `.claude/commands/analyze.md` and find the equivalent Step 6 block (same content as the main prompt — the mirror is verbatim). Replace it with the same text from Step 2.

If the file diverges from `app/main/prompts/analyze.md` in other ways, only update the Step 6 section. Leave everything else alone.

- [ ] **Step 4: Verify both files still parse as Markdown**

Run:
```bash
grep -n "^### Step 6" app/main/prompts/analyze.md .claude/commands/analyze.md
```
Expected: both files print one match each. Both should be at roughly the same line number (within a few lines of each other).

- [ ] **Step 5: Commit**

```bash
git add app/main/prompts/analyze.md .claude/commands/analyze.md
git commit -m "docs(prompts): update Step 6 scenarios for new schema

5 required fields per scenario: id, grade, condition, action, target.
A+ example added. Mirrored to .claude/commands/analyze.md.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: CSS additions for new panels

**Files:**
- Modify: `app/renderer/src/app.css` (append a new section at the end; do NOT modify existing classes).

- [ ] **Step 1: Confirm the existing class style**

Read `app/renderer/src/app.css` lines 359-405 to confirm the existing `.panel`, `.panel-head`, `.row` class pattern. The new classes must use the same CSS variables (`--surface-0`, `--surface-1`, `--border`, `--amber`, `--green`, `--red`, `--label`, `--label-dim`, `--value`, `--prose`) and `[data-theme="light"]` overrides for light mode.

- [ ] **Step 2: Append new classes at the bottom of app.css**

Add this block at the very end of `app/renderer/src/app.css`:

```css
/* ─────────── PREP redesign (2026-05-27) ─────────── */

/* Status strip — merges the old stale-banner, ChangedPanel, chain chip,
   and refresh button into one thin row above the SESSION BRIEF panel. */
.status-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: var(--surface-1);
  font-size: 10.5px;
  color: var(--label);
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}
.status-strip.stale {
  border-left: 3px solid var(--amber);
}
.status-strip .age {
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}
.status-strip .et {
  color: var(--label-dim);
}
.status-strip .chip {
  color: var(--amber);
  border: 1px solid var(--amber);
  padding: 1px 7px;
  font-size: 9.5px;
  letter-spacing: 0.14em;
}
.status-strip .chip.stale {
  color: var(--red);
  border-color: var(--red);
}
.status-strip .diff-link {
  color: var(--blue, #4f7eb3);
  cursor: pointer;
  letter-spacing: 0.1em;
}
.status-strip .diff-link:hover {
  color: var(--amber);
}
[data-theme="light"] .status-strip .et { color: #6b7178; }
[data-theme="light"] .status-strip .diff-link { color: #2563a0; }

/* Untaken-block sub-sections inside STEP 2. Each block has a small
   header ("UNTAKEN ABOVE" / "UNTAKEN BELOW") followed by .level-row
   instances (re-using existing styles). */
.untaken-block {
  margin-top: 8px;
}
.untaken-block > .head {
  color: var(--label);
  font-size: 9px;
  letter-spacing: 0.18em;
  padding: 6px 0 4px;
  border-bottom: 1px dotted var(--border);
  margin-bottom: 4px;
}

/* Step panel meta — small subtitle pinned to the right of step titles,
   e.g. "D / 4H / 1H + primary draw" next to "STEP 1 · HTF BIAS". */
.step-meta {
  color: var(--label-dim);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

/* One-line PRE-SESSION GRADE headline — replaces the full pillar
   drilldown. Pill on the left, "why" on the right. */
.pillar-headline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  gap: 12px;
}
.pillar-headline .why {
  color: var(--label);
  font-size: 11px;
  text-align: right;
}
.pillar-headline .why .pass { color: var(--green); }
.pillar-headline .why .weak { color: var(--amber); }
.pillar-headline .why .fail { color: var(--red); }

/* Full-shape scenario card — used by the SCENARIOS panel. Has a header
   row with id + grade pill, then TRIGGER / ACTION / TARGET rows. */
.scn-card-full {
  border: 1px solid var(--border);
  background: var(--surface-1);
  padding: 8px 12px;
  margin: 6px 0;
}
.scn-card-full:first-child { margin-top: 0; }
.scn-card-full .h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 5px;
  border-bottom: 1px dotted var(--border);
  margin-bottom: 6px;
  color: var(--label);
  font-size: 9.5px;
  letter-spacing: 0.15em;
}
.scn-card-full .h .id {
  color: var(--value);
}
.scn-card-full .pill {
  padding: 1px 7px;
  font-size: 9px;
  letter-spacing: 0.12em;
  border: 1px solid var(--border);
}
.scn-card-full .pill.aplus {
  background: rgba(111, 156, 91, 0.12);
  color: var(--green);
  border-color: var(--green);
}
.scn-card-full .pill.b {
  background: rgba(212, 166, 87, 0.12);
  color: var(--amber);
  border-color: var(--amber);
}
.scn-card-full .pill.no-trade {
  background: rgba(192, 71, 62, 0.12);
  color: var(--red);
  border-color: var(--red);
}
.scn-card-full .r {
  display: flex;
  gap: 10px;
  padding: 3px 0;
  font-size: 11px;
  line-height: 1.45;
}
.scn-card-full .r .k {
  color: var(--label);
  min-width: 64px;
  flex-shrink: 0;
  letter-spacing: 0.08em;
  font-size: 10px;
}
.scn-card-full .r .v {
  color: var(--value);
  flex: 1;
}
```

- [ ] **Step 3: Smoke the CSS — boot the renderer**

Run: `cd app && npm run dev`
Expected: Vite starts on http://localhost:5173, Electron boots. No CSS errors in the console. Quit (`Cmd-Q` or `Ctrl-Q`).

If you can't run the app interactively, at minimum confirm the file is syntactically valid:

```bash
node -e "const fs = require('fs'); const css = fs.readFileSync('app/renderer/src/app.css', 'utf8'); const open = (css.match(/{/g) || []).length; const close = (css.match(/}/g) || []).length; if (open !== close) { console.error('CSS brace mismatch:', open, 'vs', close); process.exit(1); } else { console.log('css braces ok:', open); }"
```

Expected: `css braces ok: <some-number>`.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "feat(css): add classes for PREP redesign

Additive only. New classes: .status-strip, .untaken-block,
.step-meta, .pillar-headline, .scn-card-full. Includes
[data-theme=light] overrides where needed. Existing classes
(.panel, .row, .level-row, .alert-entry, .pillars) untouched
so LIVE/REVIEW visuals don't drift.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Extract pure helpers to Prep.helpers.js

**Files:**
- Create: `app/renderer/src/Prep.helpers.js`

- [ ] **Step 1: Create the helpers file**

Create `app/renderer/src/Prep.helpers.js` with this content:

```js
// Pure helpers for Prep.jsx — extracted so they can be unit-tested with
// `node --test` (the project's only test runner; the renderer doesn't
// have Vitest). Importing this file has no side effects.

// Partition key_levels[] into { above, below } relative to currentPrice.
// Each partition is sorted by absolute distance to currentPrice (closest
// first), so the closest opposing levels lead in each direction.
//
// When currentPrice is null/undefined/NaN, returns { above: null, below: null,
// all: <sorted-high-to-low> } — the renderer falls back to a single block.
//
// `levels` must be an array of { name, price, state, ... } objects. Any
// item missing a numeric price is filtered out.
export function groupLevelsByPrice(levels, currentPrice) {
  const valid = (levels || []).filter((l) => typeof l.price === "number" && Number.isFinite(l.price));
  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice)) {
    const all = [...valid].sort((a, b) => b.price - a.price);
    return { above: null, below: null, all };
  }
  const above = valid
    .filter((l) => l.price > currentPrice)
    .sort((a, b) => (a.price - currentPrice) - (b.price - currentPrice));
  const below = valid
    .filter((l) => l.price <= currentPrice)
    .sort((a, b) => (currentPrice - a.price) - (currentPrice - b.price));
  return { above, below, all: null };
}

// Find a specific pillar in brief.pillars[] by name substring (case-insensitive).
// Robust to ordering changes in the prompt — index-based access is fragile.
// Returns the pillar object or null if not found.
//
// Substring patterns used elsewhere:
//   - Pillar 1: "Draw & Bias"  → /draw.*bias/i
//   - Pillar 2: "Price-Action Quality" → /price.*action|quality/i
//   - Pillar 3: "Entry Model + Confirmation" → /entry|confirmation/i
export function selectPillar(pillars, pattern) {
  if (!Array.isArray(pillars)) return null;
  return pillars.find((p) => p && typeof p.name === "string" && pattern.test(p.name)) || null;
}

// Map a Pillar 2 (Price-Action Quality) object to the three rows displayed
// in STEP 3 · PRICE QUALITY. Pillar 2 elements are matched by substring:
//   - "range" → 3h range
//   - "displacement" → 4H/1H displacement
//   - "candle" → 15m/5m candles
//
// Returns [{ k, v, tone }] — one entry per matched element, in the order
// above. Missing elements render as { k, v: "—", tone: "dim" }.
export function pillar2ToRows(pillar2) {
  const elements = pillar2?.elements || [];
  const find = (rx) => elements.find((e) => e && typeof e.name === "string" && rx.test(e.name));
  const statusTone = (s) => ({ pass: "green", weak: "amber", fail: "red", pending: "dim" }[s] || "dim");
  const rowFor = (label, rx, fallback) => {
    const el = find(rx);
    if (!el) return { k: label, v: fallback, tone: "dim" };
    const detail = el.detail || el.note || "";
    return {
      k: label,
      v: detail ? `${(el.status || "").toUpperCase()} · ${detail}` : (el.status || "").toUpperCase(),
      tone: statusTone(el.status),
    };
  };
  return [
    rowFor("3h range", /range/i, "—"),
    rowFor("4H/1H displacement", /displacement/i, "—"),
    rowFor("15m/5m candles", /candle/i, "—"),
  ];
}

// Decide whether the chain_status chip should render and what tone to use.
// Returns { visible, label, tone } — visible=false when status is null,
// undefined, or exactly "clean".
//
// Tones:
//   - "stale:N" → red ("STALE")
//   - everything else non-clean → amber
export function formatChainChip(status) {
  if (!status || status === "clean") return { visible: false, label: null, tone: null };
  const tone = status.startsWith("stale:") ? "stale" : "warn";
  return { visible: true, label: status, tone };
}
```

- [ ] **Step 2: Confirm file syntax**

Run: `node -e "import('./app/renderer/src/Prep.helpers.js').then((m) => console.log('exports:', Object.keys(m).join(','))).catch((e) => { console.error(e.message); process.exit(1); })"`
Expected: prints `exports: groupLevelsByPrice,selectPillar,pillar2ToRows,formatChainChip`.

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/Prep.helpers.js
git commit -m "feat(prep): extract pure helpers for PREP redesign

Four exports:
- groupLevelsByPrice — partition key_levels into above/below currentPrice
- selectPillar — name-substring lookup (robust to ordering changes)
- pillar2ToRows — map Pillar 2 elements to STEP 3 rows
- formatChainChip — chain_status → render decision + tone

Pure JS. No side effects. Importing has zero runtime cost.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Unit tests for Prep.helpers

**Files:**
- Create: `tests/prep-helpers.test.js`

- [ ] **Step 1: Write failing test file**

Create `tests/prep-helpers.test.js`:

```js
// Unit tests for app/renderer/src/Prep.helpers.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
} from "../app/renderer/src/Prep.helpers.js";

describe("groupLevelsByPrice", () => {
  const levels = [
    { name: "PWH", price: 21420, state: "untaken" },
    { name: "PDH", price: 21385, state: "untaken" },
    { name: "AS.H", price: 21380, state: "taken" },
    { name: "AS.L", price: 21290, state: "untaken" },
    { name: "PDL", price: 21230, state: "taken" },
  ];

  it("partitions levels into above and below currentPrice", () => {
    const { above, below } = groupLevelsByPrice(levels, 21350);
    assert.deepEqual(above.map((l) => l.name), ["PDH", "AS.H", "PWH"]); // closest first
    assert.deepEqual(below.map((l) => l.name), ["AS.L", "PDL"]);
  });

  it("places level exactly at currentPrice into 'below'", () => {
    const { below } = groupLevelsByPrice([{ name: "X", price: 100 }], 100);
    assert.equal(below[0].name, "X");
  });

  it("returns { above: null, below: null, all: sorted-high-to-low } when currentPrice is missing", () => {
    const { above, below, all } = groupLevelsByPrice(levels, null);
    assert.equal(above, null);
    assert.equal(below, null);
    assert.deepEqual(all.map((l) => l.name), ["PWH", "PDH", "AS.H", "AS.L", "PDL"]);
  });

  it("filters out items with non-numeric price", () => {
    const { above } = groupLevelsByPrice(
      [{ name: "X", price: "PDH" }, { name: "Y", price: 100 }],
      50,
    );
    assert.equal(above.length, 1);
    assert.equal(above[0].name, "Y");
  });

  it("returns empty arrays when no valid levels exist", () => {
    const { above, below } = groupLevelsByPrice([], 100);
    assert.deepEqual(above, []);
    assert.deepEqual(below, []);
  });
});

describe("selectPillar", () => {
  const pillars = [
    { name: "Draw & Bias", status: "pass", elements: [] },
    { name: "Price-Action Quality", status: "weak", elements: [] },
    { name: "Entry Model + Confirmation", status: "pending", elements: [] },
  ];

  it("finds Pillar 1 by name substring", () => {
    const p = selectPillar(pillars, /draw.*bias/i);
    assert.equal(p.status, "pass");
  });

  it("finds Pillar 2 by name substring", () => {
    const p = selectPillar(pillars, /price.*action|quality/i);
    assert.equal(p.status, "weak");
  });

  it("returns null when no pillar matches", () => {
    assert.equal(selectPillar(pillars, /nope/i), null);
  });

  it("returns null when pillars is not an array", () => {
    assert.equal(selectPillar(undefined, /.*/), null);
    assert.equal(selectPillar(null, /.*/), null);
  });
});

describe("pillar2ToRows", () => {
  it("maps three rows in fixed order, matched by name substring", () => {
    const pillar2 = {
      elements: [
        { name: "15m/5m candle quality", status: "weak", detail: "avg body 0.42" },
        { name: "3h range size", status: "pass", detail: "132pt" },
        { name: "4H displacement", status: "weak", detail: "disp_score 4" },
      ],
    };
    const rows = pillar2ToRows(pillar2);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].k, "3h range");
    assert.match(rows[0].v, /PASS/);
    assert.equal(rows[0].tone, "green");
    assert.equal(rows[1].k, "4H/1H displacement");
    assert.equal(rows[1].tone, "amber");
    assert.equal(rows[2].k, "15m/5m candles");
    assert.equal(rows[2].tone, "amber");
  });

  it("renders missing elements as '—' with dim tone", () => {
    const rows = pillar2ToRows({ elements: [] });
    assert.equal(rows.every((r) => r.v === "—"), true);
    assert.equal(rows.every((r) => r.tone === "dim"), true);
  });

  it("tolerates null pillar2 input", () => {
    const rows = pillar2ToRows(null);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].v, "—");
  });
});

describe("formatChainChip", () => {
  it("hides for null / undefined", () => {
    assert.equal(formatChainChip(null).visible, false);
    assert.equal(formatChainChip(undefined).visible, false);
  });

  it("hides for 'clean'", () => {
    assert.equal(formatChainChip("clean").visible, false);
  });

  it("shows amber for non-clean non-stale states", () => {
    const r = formatChainChip("degraded:pillar2_poor");
    assert.equal(r.visible, true);
    assert.equal(r.tone, "warn");
    assert.equal(r.label, "degraded:pillar2_poor");
  });

  it("shows red for stale:N", () => {
    const r = formatChainChip("stale:18");
    assert.equal(r.visible, true);
    assert.equal(r.tone, "stale");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test tests/prep-helpers.test.js`
Expected: all tests pass (the helpers were written from the same spec, so this is verifying not driving them).

If any test fails, the helper has a bug. Read the assertion message and fix the helper (NOT the test). Then re-run.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:unit`
Expected: all tests pass — base count + 3 new from Task 3 + ~17 new from this task.

- [ ] **Step 4: Commit**

```bash
git add tests/prep-helpers.test.js
git commit -m "test(prep): unit tests for Prep.helpers

Covers all four exports — groupLevelsByPrice (5 cases),
selectPillar (4), pillar2ToRows (3), formatChainChip (4).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: ScenarioCard component in Shared.jsx

**Files:**
- Modify: `app/renderer/src/Shared.jsx` (append a new export before the final `export { ... }` line).

- [ ] **Step 1: Find the existing export block**

Open `app/renderer/src/Shared.jsx` and find the final `export { ... }` block (around line 639):

```js
export {
  Panel, SectionHead, Row, Grade, PillarsPanel,
  SetupCard, TradeCard, ClaudeFeed, Btn, StatusLine, Snapshot,
};
```

- [ ] **Step 2: Add the ScenarioCard component above the export block**

Insert this component immediately above the `export { ... }` block:

```jsx
// ---------- Scenario card (PREP redesign, 2026-05-27) ----------
// Renders one row from brief.scenarios[]. The brief schema now has the
// full shape — id, grade, condition, action, target — but old briefs on
// disk may be missing some fields. Render "—" gracefully when absent.
function ScenarioCard({ scenario }) {
  if (!scenario) return null;
  const grade = scenario.grade || "—";
  const gradeClass = grade === "A+" ? "aplus" : grade === "B" ? "b" : grade === "no-trade" ? "no-trade" : "";
  return (
    <div className="scn-card-full">
      <div className="h">
        <span className="id">{scenario.id ? scenario.id.toUpperCase() : "SCENARIO"}</span>
        <span className={"pill " + gradeClass}>{grade}</span>
      </div>
      <div className="r"><span className="k">TRIGGER</span><span className="v">{scenario.condition || "—"}</span></div>
      <div className="r"><span className="k">ACTION</span><span className="v">{scenario.action || "—"}</span></div>
      <div className="r"><span className="k">TARGET</span><span className="v">{scenario.target || "—"}</span></div>
    </div>
  );
}
```

- [ ] **Step 3: Add ScenarioCard to the export list**

Update the `export { ... }` block:

```js
export {
  Panel, SectionHead, Row, Grade, PillarsPanel,
  SetupCard, TradeCard, ClaudeFeed, Btn, StatusLine, Snapshot,
  ScenarioCard,
};
```

- [ ] **Step 4: Verify the module loads**

Run: `node -e "import('./app/renderer/src/Shared.jsx').then(() => console.log('ok')).catch((e) => { console.error(e.message); process.exit(1); })"`

NOTE: this WILL fail because `Shared.jsx` uses JSX which `node` can't parse without Babel. The check is moot — Vite handles JSX transformation. Skip the node check; instead, verify the file's brace balance:

```bash
node -e "const fs = require('fs'); const src = fs.readFileSync('app/renderer/src/Shared.jsx', 'utf8'); const open = (src.match(/{/g) || []).length; const close = (src.match(/}/g) || []).length; if (Math.abs(open - close) > 5) { console.error('brace mismatch:', open, close); process.exit(1); } else { console.log('braces close enough:', open, close); }"
```

(Brace counting in JSX is noisy because of `{expression}` so we tolerate small differences.)

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/Shared.jsx
git commit -m "feat(renderer): add ScenarioCard for PREP scenarios panel

Renders one full-shape scenario — id, grade pill, TRIGGER/ACTION/TARGET
rows. Falls back to '—' for missing fields so old briefs on disk render
gracefully.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: StatusStrip component (inline in Prep.jsx)

**Files:**
- Will be added in Task 14's restructure. This task PRE-WRITES the component as a sketch in a scratchpad comment so Task 14 has it ready.

Skip this task — it's folded into Task 14. (Marking it here for plan traceability.)

---

### Task 10: Step1Panel (inline in Prep.jsx)

**Files:**
- Will be added in Task 14's restructure.

Skip — folded into Task 14.

---

### Task 11: Step2Panel (inline in Prep.jsx)

**Files:**
- Will be added in Task 14's restructure.

Skip — folded into Task 14.

---

### Task 12: Step3Panel (inline in Prep.jsx)

**Files:**
- Will be added in Task 14's restructure.

Skip — folded into Task 14.

---

### Task 13: PillarHeadline (inline in Prep.jsx)

**Files:**
- Will be added in Task 14's restructure.

Skip — folded into Task 14.

---

### Task 14: Prep.jsx full restructure

**Files:**
- Modify: `app/renderer/src/Prep.jsx` (entire file — restructure)

This is the biggest task. Each sub-component lives inside Prep.jsx (matches the existing file's style — single-file component plus inline helpers).

- [ ] **Step 1: Update the imports at the top**

Open `app/renderer/src/Prep.jsx`. Replace lines 1-7 (the imports + `SESSION_LABEL` const) with:

```jsx
// PREP mode workstation — Session Brief.
// Layout mirrors the strategy doc's 7-step checklist.

import React, { useEffect, useState } from "react";
import { Panel, Row, Grade, ScenarioCard } from "./Shared.jsx";
import { useSessionBrief, formatAge } from "./hooks/useSessionBrief.js";
import { useSessionRecap } from "./hooks/useSessionRecap.js";
import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
} from "./Prep.helpers.js";

const SESSION_LABEL = {
  "london": "LONDON",
  "ny-am":  "NY AM",
  "ny-pm":  "NY PM",
};
```

(Note: PillarsPanel is no longer imported. If anything else in Prep.jsx used it, that usage is being replaced below.)

- [ ] **Step 2: Keep normalizeLevelName, diffBriefs, formatPx, formatEtTime as-is**

Lines 17-77 (the `normalizeLevelName`, `diffBriefs`, `formatPx`, `formatEtTime` helpers) are unchanged. Leave them.

- [ ] **Step 3: Remove the old ChainStatusChip and StaleBriefBanner functions**

Delete the existing `ChainStatusChip` (lines ~27-46) and `StaleBriefBanner` (lines ~83-119) functions. They're absorbed into the new `StatusStrip` below.

- [ ] **Step 4: Add the new StatusStrip component**

Add this component after the `diffBriefs` helper:

```jsx
// STATUS STRIP — replaces the old StaleBriefBanner + ChangedPanel +
// inline ChainStatusChip + RefreshButton. One thin row at the top of
// PREP that consolidates all four signals.
const STALE_BRIEF_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function StatusStrip({ ageMs, briefTs, chainStatus, refreshStatus, onRefresh, onToggleDiff, diffOpen }) {
  const stale = ageMs != null && ageMs >= STALE_BRIEF_THRESHOLD_MS;
  const ageLabel = ageMs != null ? formatAge(ageMs) : null;
  const etTime = briefTs ? formatEtTime(briefTs) : "";
  const chip = formatChainChip(chainStatus);
  const running = refreshStatus === "running";
  return (
    <div className={"status-strip" + (stale ? " stale" : "")}>
      <span>
        {ageLabel && <span className="age">claude · {ageLabel}</span>}
        {etTime && <span className="et"> @ {etTime} ET</span>}
        {!ageLabel && !etTime && <span className="et">no brief yet</span>}
      </span>
      <span>
        {chip.visible && (
          <span className={"chip " + (chip.tone === "stale" ? "stale" : "")}>
            {chip.label}
          </span>
        )}
      </span>
      <span className="diff-link" onClick={onToggleDiff}>
        CHANGED SINCE LAST {diffOpen ? "▾" : "▸"}
      </span>
      <button
        onClick={onRefresh}
        disabled={running}
        style={{
          color: running ? "var(--label)" : "var(--amber)",
          background: "transparent",
          border: "1px solid var(--border)",
          padding: "2px 9px",
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 9.5,
          letterSpacing: ".16em",
          cursor: running ? "default" : "pointer",
        }}>
        {running ? "[ ··· ]" : "[ REFRESH ]"}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Replace ChangedPanel with InlineChanges**

Find the existing `ChangedPanel` (around lines 121-157). Replace it with:

```jsx
// Inline expansion of the day-over-day diff, opened by clicking
// "CHANGED SINCE LAST ▸" in the StatusStrip. Renders nothing when
// closed or when no prior brief exists.
function InlineChanges({ open, session, brief }) {
  const [prior, setPrior] = useState(null);
  const [priorDate, setPriorDate] = useState(null);
  useEffect(() => {
    if (!open || !session || !brief) return;
    const today = (brief.ts || "").slice(0, 10);
    window.api?.prep?.priorBrief?.(session, today).then((res) => {
      if (res?.ok && res.prior) {
        setPrior(res.prior.brief);
        setPriorDate(res.prior.date);
      } else {
        setPrior(null);
        setPriorDate(null);
      }
    }).catch(() => {});
  }, [open, session, brief?.ts]);

  if (!open) return null;
  if (!prior) {
    return (
      <Panel title={`CHANGED SINCE LAST ${SESSION_LABEL[session] || ""} BRIEF`}>
        <Row k="—" v="no prior brief on file" tone="dim" />
      </Panel>
    );
  }
  const changes = diffBriefs(brief, prior);
  if (!changes.length) {
    return (
      <Panel title={`CHANGED SINCE LAST ${SESSION_LABEL[session] || ""} BRIEF`}
             right={<span style={{ color: "var(--label)", fontSize: 10 }}>vs {priorDate}</span>}>
        <Row k="—" v="no changes since prior brief" tone="dim" />
      </Panel>
    );
  }
  return (
    <Panel title={`CHANGED SINCE LAST ${SESSION_LABEL[session] || ""} BRIEF`}
           right={<span style={{ color: "var(--label)", fontSize: 10 }}>vs {priorDate}</span>}>
      {changes.map((c, i) => (
        <div key={i} className="row" style={{ alignItems: "flex-start" }}>
          <span className="k">{c.k}</span>
          <span className="v" style={{ color: "var(--prose)" }}>
            {c.from ? <><span style={{ color: "var(--label)" }}>{c.from}</span>{" → "}<span style={{ color: "var(--amber)" }}>{c.to}</span></> : c.v}
          </span>
        </div>
      ))}
    </Panel>
  );
}
```

- [ ] **Step 6: Keep RecapPanel as-is**

The existing `RecapPanel` (around lines 159-191) is unchanged. Leave it.

- [ ] **Step 7: Remove the old RefreshButton + EmptyBrief**

The old `RefreshButton` (around lines 211-243) is no longer needed — its functionality lives in `StatusStrip`. Delete it.

`EmptyBrief` (around lines 245-277) stays but needs minor rework — the embedded RefreshButton is gone. Replace `EmptyBrief` with:

```jsx
function EmptyBrief({ status, statusReason, progress, session, onRefresh, ageMs, briefTs }) {
  const running = status === "running";
  let message;
  if (running) {
    const progressNote = progress > 0 ? ` (${progress} tool ${progress === 1 ? "call" : "calls"} so far)` : "";
    message = `Claude is preparing the session brief${progressNote} — HTF context, overnight ranges, key levels, and Pillar 1+2 grade. This takes 2-5 minutes.`;
  } else if (status === "error") {
    message = `The session brief failed${statusReason ? `: ${statusReason}` : ""}. Hit refresh to try again.`;
  } else if (status === "skipped") {
    message = `Brief skipped${statusReason ? `: ${statusReason}` : ""}.`;
  } else if (session) {
    message = "No brief yet for this session. Hit refresh to run one now — or wait for the next scheduled trigger (02:00 / 09:00 / 13:00 ET).";
  } else {
    message = "Outside trading windows — next session opens Monday 02:00 ET (London).";
  }
  return (
    <Panel title={`SESSION BRIEF · ${SESSION_LABEL[session] || "—"}`}>
      <div style={{ color: "var(--label)", fontSize: 11.5, lineHeight: 1.6 }}>
        {message}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 8: Add the new step panels**

Add these four components after `EmptyBrief`:

```jsx
// STEP 1 · HTF BIAS — D/4H/1H rows + primary draw sub-section.
function Step1Panel({ htfBias = [], primaryDraw, htfDestination }) {
  return (
    <Panel title="STEP 1 · HTF BIAS"
           right={<span className="step-meta">D / 4H / 1H + primary draw</span>}>
      {htfBias.map((r) => (
        <div className="row" key={r.tf} style={{ alignItems: "flex-start" }}>
          <span className="k" style={{ minWidth: 50 }}>{r.tf}</span>
          <span className="v" style={{ flex: 1, textAlign: "left", paddingLeft: 14 }}>
            <span className={"v " + (r.bias === "BEARISH" ? "red" : r.bias === "MIXED" || r.bias === "NEUTRAL" ? "amber" : "green")}
                  style={{ letterSpacing: ".1em", marginRight: 10 }}>
              {r.bias}
            </span>
            <span style={{ color: "var(--label)", fontSize: 11 }}>{r.note}</span>
          </span>
        </div>
      ))}
      {primaryDraw && (
        <>
          <div style={{
            color: "var(--label)", fontSize: 9, letterSpacing: ".18em",
            padding: "8px 0 4px", borderTop: "1px dotted var(--border)",
            marginTop: 6,
          }}>
            PRIMARY HTF DRAW
          </div>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span className="k" style={{ minWidth: 50 }}>
              {(primaryDraw.tf || "").toUpperCase()} {primaryDraw.kind} {primaryDraw.dir}
            </span>
            <span className="v" style={{ flex: 1, textAlign: "left", paddingLeft: 14 }}>
              <span title={primaryDraw.cite || undefined}
                    style={{ color: "var(--prose)", borderBottom: primaryDraw.cite ? "1px dotted var(--label)" : undefined, cursor: primaryDraw.cite ? "help" : undefined }}>
                {formatPx(primaryDraw.bottom)} – {formatPx(primaryDraw.top)}
              </span>
              <span style={{ marginLeft: 8, color: "var(--label)", fontSize: 11 }}>
                disp_score {primaryDraw.disp_score} · {primaryDraw.state}
              </span>
            </span>
          </div>
          {htfDestination && (
            <div className="row" style={{ alignItems: "flex-start" }}>
              <span className="k" style={{ minWidth: 50 }}>DEST</span>
              <span className="v" style={{ flex: 1, textAlign: "left", paddingLeft: 14, color: "var(--prose)" }}>
                {htfDestination}
              </span>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// STEP 2 · OVERNIGHT + LEVELS — Asia/London rows + untaken above/below
// sub-sections (alert bells preserved).
function Step2Panel({ overnight = [], levels = [], currentPrice, armed, fired, onToggleArm }) {
  const grouped = groupLevelsByPrice(levels, currentPrice);
  const renderLevel = (lv) => {
    const px = formatPx(lv.price);
    const isArmed = !!armed[lv.name];
    const isFired = fired.some((f) => f.name === lv.name);
    return (
      <div className="level-row" key={lv.name}>
        <span className="marker">{lv.state === "untaken" ? "─" : "·"}</span>
        <span className="name" title={lv.cite || undefined}
              style={lv.cite ? { borderBottom: "1px dotted var(--label)", cursor: "help" } : undefined}>
          {lv.name}
        </span>
        <span className="price" title={lv.cite || undefined}>{px}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={"state " + (lv.state || "untaken")}>
            {(lv.state || "untaken").toUpperCase()}
          </span>
          <span className={"bell" + (isFired ? " fired" : isArmed ? " armed" : "")}
                title={isFired ? "alert fired" : isArmed ? "alert armed — click to disarm" : "set alert"}
                onClick={() => onToggleArm && onToggleArm(lv.name, px)}>
            {isFired ? "◉" : isArmed ? "●" : "○"}
          </span>
        </span>
      </div>
    );
  };
  return (
    <Panel title="STEP 2 · OVERNIGHT + LEVELS"
           right={<span className="step-meta">Asia + London + untaken liquidity</span>}
           flush={false}>
      {overnight.map((r, i) => <Row key={i} k={r.k} v={r.v} tone={r.tone} />)}

      {grouped.above && grouped.above.length > 0 && (
        <div className="untaken-block">
          <div className="head">UNTAKEN ABOVE</div>
          {grouped.above.map(renderLevel)}
        </div>
      )}
      {grouped.below && grouped.below.length > 0 && (
        <div className="untaken-block">
          <div className="head">UNTAKEN BELOW</div>
          {grouped.below.map(renderLevel)}
        </div>
      )}
      {/* Fallback when currentPrice is missing — single block, high-to-low */}
      {grouped.all && grouped.all.length > 0 && (
        <div className="untaken-block">
          <div className="head">LEVELS</div>
          {grouped.all.map(renderLevel)}
        </div>
      )}
    </Panel>
  );
}

// STEP 3 · PRICE QUALITY — Pillar 2 broken out into 3 rows.
function Step3Panel({ pillars }) {
  const pillar2 = selectPillar(pillars, /price.*action|quality/i);
  const rows = pillar2ToRows(pillar2);
  return (
    <Panel title="STEP 3 · PRICE QUALITY"
           right={<span className="step-meta">Pillar 2 · the "tradeable today?" filter</span>}>
      {rows.map((r) => <Row key={r.k} k={r.k} v={r.v} tone={r.tone} />)}
    </Panel>
  );
}

// One-line PRE-SESSION GRADE headline — replaces the full pillar drilldown.
function GradeHeadline({ pillarGrade, pillars }) {
  const p1 = selectPillar(pillars, /draw.*bias/i);
  const p2 = selectPillar(pillars, /price.*action|quality/i);
  const why = (() => {
    if (!p1 && !p2) return "—";
    const parts = [];
    if (p1) parts.push(<span key="p1">Pillar 1 <span className={p1.status}>{(p1.status || "").toUpperCase()}</span></span>);
    if (p2) parts.push(<span key="p2"> · Pillar 2 <span className={p2.status}>{(p2.status || "").toUpperCase()}</span></span>);
    return parts;
  })();
  return (
    <Panel title="PRE-SESSION GRADE" right={<span className="step-meta">aggregate of pillars 1 + 2</span>}>
      <div className="pillar-headline">
        <Grade value={pillarGrade || "no-trade"} />
        <span className="why">{why}</span>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 9: Rewrite PrepWorkstation body**

Replace the existing `PrepWorkstation` function (around lines 279-543) with:

```jsx
function PrepWorkstation({ alerts, onToggleArm, currentPrice }) {
  const armed = alerts?.armed || {};
  const fired = alerts?.fired || [];

  const {
    brief,
    availableSymbols,
    selectedSymbol,
    setSelectedSymbol,
    session,
    status,
    statusReason,
    progress,
    refresh,
    ageMs,
  } = useSessionBrief();
  const { session: recapSession, recap } = useSessionRecap();

  const [diffOpen, setDiffOpen] = useState(false);

  // Empty state: recap + status strip + empty brief.
  if (!brief) {
    return (
      <div className="work-scroll">
        {recap && <RecapPanel session={recapSession} recap={recap} />}
        <StatusStrip
          ageMs={ageMs}
          briefTs={null}
          chainStatus={null}
          refreshStatus={status}
          onRefresh={refresh}
          onToggleDiff={() => setDiffOpen((o) => !o)}
          diffOpen={diffOpen}
        />
        <InlineChanges open={diffOpen} session={session} brief={null} />
        <EmptyBrief
          status={status}
          statusReason={statusReason}
          progress={progress}
          session={session}
          onRefresh={refresh}
          ageMs={ageMs}
        />
      </div>
    );
  }

  // Levels — defensive sort by price, then handed to groupLevelsByPrice.
  const levels = (brief.key_levels || [])
    .slice()
    .sort((a, b) => {
      const an = typeof a.price === "number" ? a.price : -Infinity;
      const bn = typeof b.price === "number" ? b.price : -Infinity;
      return bn - an;
    })
    .map((lv) => ({
      name: lv.name,
      price: lv.price,
      state: lv.state || "untaken",
      cite: typeof lv.cite === "string" ? lv.cite : null,
    }));

  return (
    <div className="work-scroll">
      {recap && recapSession !== brief.session && (
        <RecapPanel session={recapSession} recap={recap} />
      )}

      <StatusStrip
        ageMs={ageMs}
        briefTs={brief.ts}
        chainStatus={brief.chain_status}
        refreshStatus={status}
        onRefresh={refresh}
        onToggleDiff={() => setDiffOpen((o) => !o)}
        diffOpen={diffOpen}
      />
      <InlineChanges open={diffOpen} session={brief.session} brief={brief} />

      <Panel title={`SESSION BRIEF · ${SESSION_LABEL[brief.session] || ""}${selectedSymbol ? ` · ${selectedSymbol}` : ""}`}>
        {availableSymbols.length > 1 && (
          <div style={{ display: "flex", gap: 6, padding: "0 0 8px" }}>
            {availableSymbols.map((sym) => {
              const active = sym === selectedSymbol;
              return (
                <button key={sym}
                        onClick={() => setSelectedSymbol(sym)}
                        style={{
                          background: active ? "var(--surface-1)" : "transparent",
                          border: "1px solid " + (active ? "var(--amber)" : "var(--border)"),
                          color: active ? "var(--amber)" : "var(--value)",
                          padding: "3px 10px", fontFamily: "ui-monospace, Menlo, monospace",
                          fontSize: 10, letterSpacing: ".06em", cursor: "pointer",
                        }}>
                  {sym}
                </button>
              );
            })}
          </div>
        )}
        <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {brief.brief}
        </div>
      </Panel>

      <Step1Panel
        htfBias={brief.htf_bias || []}
        primaryDraw={brief.primary_draw}
        htfDestination={brief.htf_destination}
      />

      <Step2Panel
        overnight={brief.overnight || []}
        levels={levels}
        currentPrice={currentPrice}
        armed={armed}
        fired={fired}
        onToggleArm={onToggleArm}
      />

      <Step3Panel pillars={brief.pillars || []} />

      <GradeHeadline pillarGrade={brief.pillar_grade} pillars={brief.pillars || []} />

      {Array.isArray(brief.scenarios) && brief.scenarios.length > 0 && (
        <Panel title="SCENARIOS · IF / THEN" right={<span className="step-meta">claude proposed</span>}>
          {brief.scenarios.map((s, i) => (
            <ScenarioCard key={s.id || i} scenario={s} />
          ))}
        </Panel>
      )}

      <Panel title="CLAUDE · PLAN FOR THE OPEN">
        <div style={{ color: "var(--value)", fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {brief.plan}
        </div>
        <div className="hr" />
        <Row k="Anchored target" v={brief.anchored_target} tone="num green" />
        <Row k="Anchored stop"   v={brief.anchored_stop}   tone="num red" />
        <Row k="Sizing if A+ today" v={brief.sizing_note} />
      </Panel>

      <section className="panel">
        <header className="panel-head">
          <span className="title">PRICE ALERTS</span>
          <span className="meta">
            <span style={{ color: "var(--green)" }}>{fired.length} fired</span>
            {" · "}
            <span style={{ color: "var(--amber)" }}>{Object.keys(armed).length} armed</span>
          </span>
        </header>
        <div className="panel-body flush">
          {fired.length === 0 && Object.keys(armed).length === 0 && (
            <div className="empty-state" style={{ padding: "14px" }}>
              <div style={{ color: "var(--label)", fontSize: 11 }}>no alerts armed</div>
              <div className="sub">click the ○ on any untaken level above to arm one</div>
            </div>
          )}
          {fired.length > 0 && (
            <div className="alerts-feed">
              {fired.map((a, i) => (
                <div className="alert-entry" key={i}>
                  <span className="when">{a.t}</span>
                  <span className="what">
                    <b>{a.name}</b> @ <span className="px">{a.px}</span> — {a.note || "price level reached"}
                  </span>
                  <span style={{ color: "var(--green)", fontSize: 9, letterSpacing: ".1em" }}>FIRED</span>
                </div>
              ))}
            </div>
          )}
          {Object.keys(armed).length > 0 && (
            <>
              <div style={{
                padding: "4px 14px",
                fontSize: 9.5, letterSpacing: ".18em",
                color: "var(--label)",
                borderTop: fired.length ? "1px solid var(--border-dim)" : "",
                background: "var(--surface-1)",
              }}>
                ARMED · WATCHING
              </div>
              {Object.entries(armed).map(([name, px]) => (
                <div className="alert-entry" key={name}>
                  <span className="when">—</span>
                  <span className="what">
                    <b>{name}</b> @ <span className="px">{px}</span>
                  </span>
                  <span style={{ color: "var(--amber)", fontSize: 9, letterSpacing: ".1em" }}>ARMED</span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export { PrepWorkstation };
```

- [ ] **Step 10: Smoke-check the file**

Run:
```bash
node -e "const fs = require('fs'); const src = fs.readFileSync('app/renderer/src/Prep.jsx', 'utf8'); console.log('lines:', src.split('\\n').length);"
```
Expected: line count around 350-450 (down from ~545). Significant shrink because StaleBriefBanner, ChainStatusChip, ChangedPanel, RefreshButton were folded into StatusStrip + InlineChanges.

- [ ] **Step 11: Commit**

```bash
git add app/renderer/src/Prep.jsx
git commit -m "feat(prep): restructure layout to mirror strategy checklist

- StatusStrip merges stale banner + diff link + chain chip + refresh
- InlineChanges replaces standalone ChangedPanel (opens on chip click)
- Step1Panel absorbs HTF bias + primary draw
- Step2Panel absorbs overnight + key levels grouped above/below currentPrice
- Step3Panel pulls Pillar 2 out as its own panel
- GradeHeadline replaces the full pillar drilldown with one-line pill+why
- SCENARIOS gets its own first-class panel with ScenarioCard
- PLAN keeps prose + anchored target/stop + sizing (scenarios moved out)
- PRICE ALERTS panel unchanged

Same data hooks. No IPC changes. New currentPrice prop drilled from
App.jsx (next commit).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 15: Drill currentPrice from App.jsx

**Files:**
- Modify: `app/renderer/src/App.jsx` (around lines 559-589 — the `Workstation` wrapper, and the call site at lines 870-874).

- [ ] **Step 1: Add a useSymbolCache hook subscription in App**

In `app/renderer/src/App.jsx`, find the existing top-of-`App()` hooks section. Around line 614-617 (after `const [t, setT]` and `const [symbol, setSymbol]`), add:

```jsx
  // Live price cache for STEP 2 level grouping (above/below currentPrice).
  // The PREP panel needs this — Live/Review don't. Subscribe always; the
  // cost is one IPC tick.
  const symbolCache = useSymbolCache(true);
  const currentPrice = symbolCache?.[symbol]?.px ?? null;
```

Make sure `useSymbolCache` is already imported (it is — line 12).

- [ ] **Step 2: Pass currentPrice into the Workstation wrapper**

Find the `Workstation` function (around line 559) and update its signature + the PREP branch:

```jsx
function Workstation({ mode, tweaks, alerts, onToggleArm, onArmPrice, currentPrice }) {
  if (mode === "prep") {
    return (
      <ErrorBoundary label="PREP">
        <PrepWorkstation alerts={alerts} onToggleArm={onToggleArm} currentPrice={currentPrice} />
      </ErrorBoundary>
    );
  }
  // ... rest unchanged
}
```

- [ ] **Step 3: Pass currentPrice through at the call site**

Find the call to `<Workstation ... />` in `App()` (around line 870):

```jsx
<Workstation mode={mode} tweaks={t}
             alerts={alerts}
             onToggleArm={toggleArm}
             onArmPrice={armFromPrice} />
```

Add the prop:

```jsx
<Workstation mode={mode} tweaks={t}
             alerts={alerts}
             onToggleArm={toggleArm}
             onArmPrice={armFromPrice}
             currentPrice={currentPrice} />
```

- [ ] **Step 4: Sanity check the file**

```bash
node -e "const fs = require('fs'); const src = fs.readFileSync('app/renderer/src/App.jsx', 'utf8'); const occurrences = (src.match(/currentPrice/g) || []).length; if (occurrences < 4) { console.error('expected at least 4 currentPrice references, found', occurrences); process.exit(1); } else { console.log('currentPrice refs:', occurrences); }"
```

Expected: at least 4 references (declaration, Workstation signature, Workstation→PrepWorkstation pass, App→Workstation pass).

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/App.jsx
git commit -m "feat(app): drill currentPrice into PrepWorkstation

Sourced from useSymbolCache; used by Step2Panel to partition
key_levels into above/below current price. Live (refreshes as
the cache ticks) but the brief data itself stays snapshot-stable.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 16: Full test + lint + boot

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:unit`
Expected: all tests pass (baseline + ~3 new schema tests + ~17 new helper tests = roughly +20 cases vs Task 1's baseline).

- [ ] **Step 2: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: same count as Task 1 baseline. The schema delta is at the brief level (downstream of analyze bundle), so fixtures should be unaffected. If any fixture fails, read the error — it's either a real regression or a fixture that needs updating.

- [ ] **Step 3: Boot the renderer**

Run: `cd app && npm run dev`
Expected: Vite + Electron boot. Navigate to PREP. Verify:
- Status strip renders at the top (age + chain chip if non-clean + REFRESH).
- Session brief panel renders the prose.
- STEP 1 panel renders HTF bias rows + primary draw nested.
- STEP 2 panel renders overnight rows + UNTAKEN ABOVE/BELOW sub-sections with bells.
- STEP 3 panel renders 3 quality rows.
- PRE-SESSION GRADE shows one-line pill + why.
- SCENARIOS panel renders scenario cards with full shape (id + grade + 3 rows).
- PLAN panel renders prose + anchored target/stop + sizing.
- PRICE ALERTS panel unchanged.

Quit Electron when done.

- [ ] **Step 4: Visual sanity — light theme**

Boot again, toggle the theme to light via the topbar toggle. Verify all new panels have readable colors. Specifically:
- `.status-strip .et` should be dark gray, not invisible.
- `.scn-card-full .pill` colors should still pop against the lighter background.

If any light-theme issue surfaces, add a `[data-theme="light"]` override to `app/renderer/src/app.css` for that selector. Commit fix.

- [ ] **Step 5: Boot test — empty brief state**

Delete `state/session/<today>/<session>/brief-MNQ1!.json` (if it exists) to simulate no-brief-yet. Reboot. Verify the StatusStrip renders without crashing and the EmptyBrief panel shows the right message.

(If the renderer crashes, the most likely cause is `ageMs` being null and the StatusStrip not handling it. Inspect; fix if needed.)

- [ ] **Step 6: Commit any fix-up**

If you made small fixes in step 4 or 5, commit them:

```bash
git add app/renderer/src/app.css app/renderer/src/Prep.jsx
git commit -m "fix(prep): light-theme + empty-state polish

Co-Authored-By: Claude <noreply@anthropic.com>"
```

(Skip if no changes needed.)

---

### Task 17: CLAUDE.md decisions row

**Files:**
- Modify: `CLAUDE.md` (append a row to the "Architecture decisions" table).

- [ ] **Step 1: Add the row**

Open `CLAUDE.md` and find the "Architecture decisions" table (search for `| Date | Decision | Rationale |`). At the END of that table (just before the next `##` heading), add this row:

```
| 2026-05-27 | PREP panel redesign — checklist-mirror layout | Restructure PREP to mirror the strategy doc's 7-step checklist: STEP 1 HTF Bias (+ primary draw nested), STEP 2 Overnight + Levels (grouped above/below currentPrice with alert bells preserved), STEP 3 Price Quality (Pillar 2 broken out). One-line PRE-SESSION GRADE headline replaces the full pillar drilldown. SCENARIOS promoted from a buried subsection of PLAN to a first-class panel with grade pills (additive Zod extension: id + grade + target). Stale banner + day-over-day diff + chain chip + refresh collapse into one STATUS STRIP. Same data hooks, same IPC. Spec: [docs/superpowers/specs/2026-05-26-prep-panel-redesign.md](docs/superpowers/specs/2026-05-26-prep-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-prep-panel-redesign.md](docs/superpowers/plans/2026-05-27-prep-panel-redesign.md). |
```

- [ ] **Step 2: Verify**

Run: `grep -n "PREP panel redesign" CLAUDE.md`
Expected: one match, in the architecture decisions table.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): log PREP redesign in decisions table

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 18: Final integration + push + PR

**Files:** none

- [ ] **Step 1: Verify git log**

Run: `git log --oneline main..HEAD`
Expected: 7-9 commits, all on `feat/prep-panel-redesign`, each scoped to one task.

- [ ] **Step 2: Run all tests one more time**

Run: `npm run test:unit && npm run smoke:fixtures`
Expected: all green.

- [ ] **Step 3: Push the branch**

Run: `git push -u origin feat/prep-panel-redesign`
Expected: branch pushed; remote tracking set up.

- [ ] **Step 4: Open a PR**

Run:
```bash
gh pr create --title "feat(prep): redesign PREP to mirror strategy checklist" --body "$(cat <<'EOF'
## Summary

- Restructure PREP panel layout to mirror the strategy doc's 7-step checklist
- Promote SCENARIOS from a buried subsection to a first-class panel with grade pills
- Collapse stale banner + day-over-day diff + chain chip + refresh into one STATUS STRIP
- Group untaken levels above/below current price (alert bells preserved)
- Pillar 2 broken out as STEP 3 · PRICE QUALITY; PRE-SESSION GRADE becomes a one-line headline
- Additive Zod extension for scenarios — adds id, grade, target (keeps existing `condition` name)

Same data hooks. Same IPC. No changes to LIVE or REVIEW panels.

Spec: [docs/superpowers/specs/2026-05-26-prep-panel-redesign.md](docs/superpowers/specs/2026-05-26-prep-panel-redesign.md)
Plan: [docs/superpowers/plans/2026-05-27-prep-panel-redesign.md](docs/superpowers/plans/2026-05-27-prep-panel-redesign.md)

## Test plan

- [x] `npm run test:unit` — all green (~20 new cases: 3 schema + ~17 helper)
- [x] `npm run smoke:fixtures` — same count as baseline
- [ ] Boot Electron, navigate PREP — verify all panels render, theme toggle works, alert bells still work
- [ ] Empty-brief state — StatusStrip renders without crashing
- [ ] First real session post-merge — verify a fresh brief emits the new scenario shape correctly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Note it.

- [ ] **Step 5: Report back**

Print the PR URL and the final test counts to the user. Done.

---

## Self-Review (run after writing the full plan)

### Spec coverage

- §2 layout: Tasks 5, 14 cover all 9 panels.
- §3 schema delta: Tasks 2, 3 (Zod + tests), Task 4 (prompt mirror).
- §4 file-level inventory: every file in the spec's inventory appears in this plan's task list.
- §5 data wiring: explicit non-change. Verified in Task 14's PrepWorkstation rewrite (same hooks).
- §6 grouping logic: Task 6 (groupLevelsByPrice helper) + Task 7 (tests) + Task 15 (currentPrice plumbing).
- §7 test plan: Tasks 3, 7 cover unit tests. Manual sanity in Task 16. Fixture additions NOT in this plan — they require capturing real chart state, which is opportunistic. Noted in spec §7.
- §8 risks: addressed in code (R1 via substring matching in `selectPillar`, R3 via fallback in `groupLevelsByPrice`). R2 (React key stability) is a tolerated mild churn — index fallback works for 1-4 length lists.

### Placeholder scan

- Tasks 9-13 are explicitly "skip — folded into Task 14". This is NOT a placeholder — it's a routing note. The actual code lives in Task 14 step 8.
- All steps have concrete code or exact commands.
- No TBDs.

### Type consistency

- `groupLevelsByPrice(levels, currentPrice)` — same signature in helper, test, and Prep.jsx usage.
- `selectPillar(pillars, pattern)` — pattern is a RegExp; used the same way in Prep.helpers.js and Prep.jsx.
- `pillar2ToRows(pillar2)` — returns `[{ k, v, tone }]`; Step3Panel renders via `<Row k={r.k} v={r.v} tone={r.tone} />`. ✅
- `formatChainChip(status)` — returns `{ visible, label, tone }`; StatusStrip destructures into `chip.visible / chip.label / chip.tone`. ✅
- `ScenarioCard({ scenario })` — same prop name in Shared.jsx and Prep.jsx. ✅

All clear.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-prep-panel-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

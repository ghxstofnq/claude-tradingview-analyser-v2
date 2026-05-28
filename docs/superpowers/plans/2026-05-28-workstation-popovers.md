# Workstation Popovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert PREP / LIVE / REVIEW from full-pane mode-switching panels into topbar-anchored popovers matching the BACKTEST/CLAUDE/ALERTS recipe. Chart fills the entire main area; state at-a-glance via per-cell badges.

**Architecture:** Each panel's existing JSX (`Prep.jsx`, `Live.jsx`, `Review.jsx`) is restructured: the outer `*Workstation` wrapper is removed, body content is wrapped in a new `<*Popover>` component, and a thin `<*Cell>` component owns the open/close state and mounts the popover. Pure helpers (`*Helpers.js`) are unchanged. Two schema additions: `prose_summary` field on `surface_session_brief` + `surface_session_summary` so Claude can write a free-form prose block in BRIEF/WRAP sections. Mode tabs are deleted; `.main.split-50/70` CSS is deleted; `mode` React state goes away.

**Tech Stack:** React 18, Electron 30, Node 18+, `node --test`, Zod, `@anthropic-ai/claude-agent-sdk ^0.3.150`. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-28-workstation-popovers-design.md](../specs/2026-05-28-workstation-popovers-design.md)

**Branch:** `feat/workstation-popovers` (already created off `feat/backtest-popover`; spec committed)

**Caution:** a backtest is running in the background on `feat/backtest-popover`. This branch shares the same working tree. Avoid restarting Electron or running `npm test` in a way that disturbs the engine. Bash `git status` and per-test runs are safe; full `npm test` is safe too (read-only against `state/`).

---

## File map

**New (renderer):**
- `app/renderer/src/PrepPopover.jsx` — renamed from `Prep.jsx`; exports `<PrepCell />`
- `app/renderer/src/LivePopover.jsx` — renamed from `Live.jsx`; exports `<LiveCell />`
- `app/renderer/src/ReviewPopover.jsx` — renamed from `Review.jsx`; exports `<ReviewCell />`
- `app/renderer/src/hooks/usePrep.js` — state reducer + IPC bridge
- `app/renderer/src/hooks/useLive.js` — state reducer + `subState` derivation
- `app/renderer/src/hooks/useReview.js` — state reducer + library load

**New (tests):**
- `tests/use-prep.test.js`
- `tests/use-live.test.js`
- `tests/use-review.test.js`

**Modified (renderer):**
- `app/renderer/src/App.jsx` — remove mode tabs, remove `mode` state, add `<PrepCell />` `<LiveCell />` `<ReviewCell />` alongside `<BacktestCell />`
- `app/renderer/src/app.css` — add `.popover` content blocks (PREP/LIVE/REVIEW specific), delete `.main.split-50` `.main.split-70` `.work-pane` `.chart-host.split-50` `.chart-host.split-70`

**Modified (main process):**
- `app/main/tools/surface.js` — add `prose_summary: z.string().min(50).max(1000)` to `SurfaceSessionBriefSchema` + `SurfaceSessionSummarySchema`
- `app/main/prompts/phase-brief.md` — instruct Claude to write a 2-4-sentence prose summary in the trader's voice as `prose_summary`
- `app/main/prompts/phase-wrap.md` — same for the wrap turn (post-session prose)
- `app/main/ipc.js` — remove `mode:switch` handler (if it exists) since no consumers remain
- `app/preload.cjs` — remove `mode.switch / mode.onCurrent` exposure (if removed handler)

**Unchanged (reused):**
- `app/renderer/src/Prep.helpers.js`, `Live.helpers.js`, `Review.helpers.js` — pure helpers consumed by the new popover bodies
- `app/renderer/src/Shared.jsx` — `<TradeCard>`, `<ClaudeFeed>`, etc.
- `app/renderer/src/BacktestPopover.jsx` + `useBacktest.js` — unaffected

---

### Task 1: Confirm branch + clean baseline

**Files:** none (git only)

- [ ] **Step 1: Verify branch + status**

```bash
git status
git branch --show-current
git log --oneline main..HEAD | head -5
```
Expected: working tree clean (apart from `tests/.tmp-brief-flow/` which is gitignored). On `feat/workstation-popovers`. Spec commit `aae79b8` present.

- [ ] **Step 2: Run the existing test suite to establish a baseline**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ" | tail -8
```
Expected: same pass/fail counts as the backtest branch baseline (something like 483 pass / 1 known-fail `rotateMetricsFile`).

---

### Task 2: Add `prose_summary` to the brief + wrap Zod schemas

**Files:**
- Modify: `app/main/tools/surface.js`
- Modify: `tests/brief-flow.test.js`

The schemas live in `surface.js` (search for `SurfaceSessionBriefSchema`). Both gain one new required field.

- [ ] **Step 1: Locate the two schemas**

```bash
grep -n "SurfaceSessionBriefSchema\|SurfaceSessionSummarySchema" app/main/tools/surface.js
```
Note the line numbers.

- [ ] **Step 2: Write a failing test asserting the new field is required**

Append to `tests/brief-flow.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SurfaceSessionBriefSchema, SurfaceSessionSummarySchema } from "../app/main/tools/surface.js";

test("brief schema — prose_summary is required (min 50 chars)", () => {
  const baseValid = {
    /* ... copy a known-valid brief payload from existing tests ... */
  };
  // Without prose_summary → should fail
  assert.throws(() => SurfaceSessionBriefSchema.parse(baseValid));
  // With short prose_summary → should fail (under 50 chars)
  assert.throws(() => SurfaceSessionBriefSchema.parse({ ...baseValid, prose_summary: "too short" }));
  // With valid prose_summary → should pass
  const longProse = "HTF stacks bearish D to 1H. Daily took PDH 29105 and is set up for a PDL 29050 visit; overnight held the FVG untaken.";
  assert.doesNotThrow(() => SurfaceSessionBriefSchema.parse({ ...baseValid, prose_summary: longProse }));
});

test("summary schema — prose_summary is required (min 50 chars)", () => {
  const baseValid = {
    /* ... copy a known-valid summary payload from existing tests ... */
  };
  assert.throws(() => SurfaceSessionSummarySchema.parse(baseValid));
  const longProse = "Two A+ shorts in line with the bearish HTF. First MSS hit TP1 in 9 bars. Second stopped — entered late.";
  assert.doesNotThrow(() => SurfaceSessionSummarySchema.parse({ ...baseValid, prose_summary: longProse }));
});
```

(Replace `baseValid` placeholders with actual valid payloads — grep the existing test file for examples of `SurfaceSessionBriefSchema.parse(...)` calls and copy.)

- [ ] **Step 3: Run test to verify it fails**

```bash
node --test tests/brief-flow.test.js 2>&1 | tail -10
```
Expected: new tests fail with "missing prose_summary" or "not in schema."

- [ ] **Step 4: Add the field to both schemas**

In `app/main/tools/surface.js`, find each schema and append the field:

```js
// SurfaceSessionBriefSchema:
const SurfaceSessionBriefSchema = z.object({
  // ...existing fields...
  prose_summary: z.string().min(50).max(1000).describe(
    "2-4 sentences in the trader's voice synthesizing the brief. Read aloud, " +
    "this should sound like the trader explaining the day's setup to a colleague."
  ),
});

// SurfaceSessionSummarySchema:
const SurfaceSessionSummarySchema = z.object({
  // ...existing fields...
  prose_summary: z.string().min(50).max(1000).describe(
    "2-4 sentences in the trader's voice summarizing what happened this session " +
    "and calling out lessons for next time."
  ),
});
```

- [ ] **Step 5: Run tests to verify pass**

```bash
node --test tests/brief-flow.test.js 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: all pass.

- [ ] **Step 6: Confirm no regression elsewhere**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: same pass count as Task 1 baseline + 2 new passes (the two new schema tests).

If existing brief/wrap tests fail because they now lack `prose_summary` in their fixture payloads, fix the fixtures (add a stub `prose_summary` long enough to satisfy `min(50)`).

- [ ] **Step 7: Commit**

```bash
git add app/main/tools/surface.js tests/brief-flow.test.js
git commit -m "feat(workstations): prose_summary field on brief + summary schemas"
```

---

### Task 3: Update the brief + wrap prompts to instruct Claude to fill `prose_summary`

**Files:**
- Modify: `app/main/prompts/phase-brief.md`
- Modify: `app/main/prompts/phase-wrap.md`

Both prompts emit `surface_session_brief` / `surface_session_summary` tool calls. Both need a one-paragraph instruction about the new field.

- [ ] **Step 1: Read each prompt to find the surface_* tool-call template / instructions**

```bash
grep -n "surface_session_brief\|prose_summary" app/main/prompts/phase-brief.md | head
grep -n "surface_session_summary\|prose_summary" app/main/prompts/phase-wrap.md | head
```

- [ ] **Step 2: In `phase-brief.md`, add to the surface_session_brief instructions**

Find the section that documents `surface_session_brief` and add a new bullet/paragraph:

```markdown
**prose_summary** (required) — 2-4 sentences in your own words synthesizing the
brief. Write it as if reading aloud to a colleague: HTF context, the room price
has, primary draw, and what you're watching for. Color/emphasis in the prose
will be rendered by the UI — just write natural sentences. Min 50 chars,
max 1000.

Example:
> HTF stacks **bearish** D → 1H. Daily took PDH **29105** and is set up for a
> **PDL 29050** visit; overnight held the 4H FVG **29070–29105** untaken.
> Pillar 2 is **clean** (78pt range, 0.72 body). Watching two shorts: an A+ MSS
> on a sweep of 29105 and a B-grade iFVG flip at 29080. Skipping longs at PDL.
```

- [ ] **Step 3: In `phase-wrap.md`, add to the surface_session_summary instructions**

Find the section that documents `surface_session_summary` and add:

```markdown
**prose_summary** (required) — 2-4 sentences in your own words on what happened
this session. Call out which setups paid, which didn't, and one lesson worth
remembering for next session. Min 50 chars, max 1000.

Example:
> Two A+ shorts in line with the bearish HTF. **First MSS** at 29105 sweep hit
> TP1 in 9 bars — textbook. **Second** (Trend continuation at 10:18) stopped —
> entered late, RR was already 1:0.7. Day +1.7R. Memory note: late-entry
> continuations are still hitting stops more than 50% — flag for next session.
```

- [ ] **Step 4: Run smoke fixtures to confirm prompt files load OK**

```bash
npm run smoke:fixtures 2>&1 | tail -8
```
Expected: same pass count (16/16 or whatever baseline is).

- [ ] **Step 5: Commit**

```bash
git add app/main/prompts/phase-brief.md app/main/prompts/phase-wrap.md
git commit -m "feat(workstations): instruct LLM to fill prose_summary in brief + wrap"
```

---

### Task 4: `usePrep` hook + tests

**Files:**
- Create: `app/renderer/src/hooks/usePrep.js`
- Create: `tests/use-prep.test.js`

Reducer + IPC bridge for the PREP popover. Reads `useSessionBrief()` underneath (which already wraps the brief IPC).

- [ ] **Step 1: Write the failing tests**

```js
// tests/use-prep.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { reducer, INITIAL, deriveState } from "../app/renderer/src/hooks/usePrep.js";

test("INITIAL state — empty brief, not loading", () => {
  assert.equal(INITIAL.brief, null);
  assert.equal(INITIAL.isLoading, false);
  assert.equal(INITIAL.error, null);
});

test("reducer — BRIEF_LOADED stores brief + clears loading", () => {
  const brief = { date: "2026-05-28", pillar_grade: "A+", prose_summary: "..." };
  const s = reducer({ ...INITIAL, isLoading: true }, { type: "BRIEF_LOADED", brief });
  assert.equal(s.brief, brief);
  assert.equal(s.isLoading, false);
});

test("reducer — RUN_BRIEF sets loading", () => {
  const s = reducer(INITIAL, { type: "RUN_BRIEF" });
  assert.equal(s.isLoading, true);
});

test("reducer — RUN_BRIEF_ERROR captures error message", () => {
  const s = reducer({ ...INITIAL, isLoading: true }, { type: "RUN_BRIEF_ERROR", message: "rate_limit" });
  assert.equal(s.isLoading, false);
  assert.equal(s.error, "rate_limit");
});

test("deriveState — no brief → returns { hasBrief: false }", () => {
  const derived = deriveState({ brief: null });
  assert.equal(derived.hasBrief, false);
});

test("deriveState — brief present → exposes grade + prose + has all sections", () => {
  const brief = {
    date: "2026-05-28", session: "ny-am",
    pillar_grade: "A+",
    prose_summary: "Long bearish narrative here that's at least 50 characters long for sure.",
    htf_bias: [{ tf: "D", bias: "bear" }],
    key_levels: [{ name: "PDH", price: 29105 }],
    scenarios: [{ id: "s1", grade: "A+" }],
  };
  const d = deriveState({ brief });
  assert.equal(d.hasBrief, true);
  assert.equal(d.grade, "A+");
  assert.equal(d.proseSummary, brief.prose_summary);
  assert.equal(d.htfBias.length, 1);
  assert.equal(d.scenarios.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/use-prep.test.js 2>&1 | tail -5
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// app/renderer/src/hooks/usePrep.js
// Reducer + IPC bridge for the PREP popover.
// Underlying data comes from useSessionBrief() which already wraps the
// existing prep:get / prep:refresh IPC. This hook adds:
//   - explicit RUN_BRIEF action that calls prep:refresh
//   - derived state (hasBrief, grade, proseSummary, etc.)
//   - error handling

import { useEffect, useReducer, useCallback } from "react";

export const INITIAL = {
  brief: null,        // the full brief payload (from prep:get) or null
  isLoading: false,   // true while RUN_BRIEF is in flight
  error: null,        // string error message if last RUN_BRIEF failed
};

export function reducer(s, action) {
  switch (action.type) {
    case "BRIEF_LOADED":   return { ...s, brief: action.brief, isLoading: false, error: null };
    case "RUN_BRIEF":      return { ...s, isLoading: true, error: null };
    case "RUN_BRIEF_DONE": return { ...s, isLoading: false };
    case "RUN_BRIEF_ERROR": return { ...s, isLoading: false, error: action.message };
    default: return s;
  }
}

// Pure deriver — keeps render simple by precomputing everything the body needs.
export function deriveState({ brief }) {
  if (!brief) return { hasBrief: false };
  return {
    hasBrief: true,
    grade: brief.pillar_grade ?? null,
    proseSummary: brief.prose_summary ?? null,
    htfBias: brief.htf_bias ?? [],
    primaryDraw: brief.primary_draw ?? null,
    keyLevels: brief.key_levels ?? [],
    pillar2: brief.pillar2_verdict ?? null,
    scenarios: brief.scenarios ?? [],
    chainStatus: brief.chain_status ?? "clean",
    date: brief.date,
    session: brief.session,
  };
}

export function usePrep() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  useEffect(() => {
    let alive = true;
    window.api?.prep?.get?.().then((brief) => { if (alive) dispatch({ type: "BRIEF_LOADED", brief }); });
    const off = window.api?.prep?.onUpdated?.(() => {
      window.api?.prep?.get?.().then((brief) => { if (alive) dispatch({ type: "BRIEF_LOADED", brief }); });
    });
    return () => { alive = false; off?.(); };
  }, []);

  const runBrief = useCallback(async () => {
    dispatch({ type: "RUN_BRIEF" });
    try {
      await window.api?.prep?.refresh?.();
      dispatch({ type: "RUN_BRIEF_DONE" });
    } catch (e) {
      dispatch({ type: "RUN_BRIEF_ERROR", message: e?.message ?? String(e) });
    }
  }, []);

  const armLevel = useCallback((price, label) => window.api?.alert?.arm?.(price, label), []);
  const disarmLevel = useCallback((id) => window.api?.alert?.disarm?.(id), []);

  return {
    state,
    derived: deriveState(state),
    actions: { runBrief, armLevel, disarmLevel },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/use-prep.test.js 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/hooks/usePrep.js tests/use-prep.test.js
git commit -m "feat(workstations): usePrep hook (reducer + deriver + IPC bridge)"
```

---

### Task 5: `useLive` hook + tests

**Files:**
- Create: `app/renderer/src/hooks/useLive.js`
- Create: `tests/use-live.test.js`

Most important piece: `subState` derivation. Five states (idle / open-reaction / entry-hunt / in-trade / done) derived from the existing data hooks (`useSetups`, `useTrades`, session phase).

- [ ] **Step 1: Write failing tests focused on subState derivation**

```js
// tests/use-live.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSubState, reducer, INITIAL } from "../app/renderer/src/hooks/useLive.js";

test("deriveSubState — no session active → 'idle'", () => {
  const s = deriveSubState({ phase: "idle", activeTrade: null, surfacedSetup: null, ltfBias: null });
  assert.equal(s, "idle");
});

test("deriveSubState — phase=open_reaction → 'open-reaction'", () => {
  const s = deriveSubState({ phase: "open_reaction", activeTrade: null, surfacedSetup: null, ltfBias: { value: "neutral" } });
  assert.equal(s, "open-reaction");
});

test("deriveSubState — surfacedSetup + no trade → 'entry-hunt'", () => {
  const s = deriveSubState({ phase: "entry_hunt", activeTrade: null, surfacedSetup: { id: "s1" }, ltfBias: null });
  assert.equal(s, "entry-hunt");
});

test("deriveSubState — activeTrade overrides everything → 'in-trade'", () => {
  const s = deriveSubState({ phase: "entry_hunt", activeTrade: { id: "t1" }, surfacedSetup: { id: "s1" }, ltfBias: null });
  assert.equal(s, "in-trade");
});

test("deriveSubState — phase=wrap → 'done'", () => {
  const s = deriveSubState({ phase: "wrap", activeTrade: null, surfacedSetup: null, ltfBias: null });
  assert.equal(s, "done");
});

test("reducer — ACTIVE_TRADE_SET stores trade", () => {
  const trade = { id: "t1", side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const s = reducer(INITIAL, { type: "ACTIVE_TRADE_SET", trade });
  assert.deepEqual(s.activeTrade, trade);
});

test("reducer — SURFACED_SETUP stores setup", () => {
  const setup = { id: "s1", side: "short" };
  const s = reducer(INITIAL, { type: "SURFACED_SETUP", setup });
  assert.deepEqual(s.surfacedSetup, setup);
});

test("reducer — ACCEPT_SETUP clears surfacedSetup", () => {
  const setup = { id: "s1" };
  const s1 = reducer(INITIAL, { type: "SURFACED_SETUP", setup });
  const s2 = reducer(s1, { type: "ACCEPT_SETUP" });
  assert.equal(s2.surfacedSetup, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/use-live.test.js 2>&1 | tail -5
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// app/renderer/src/hooks/useLive.js
// State for the LIVE popover. The big derivation is subState — which of the
// five UI bodies to render (idle / open-reaction / entry-hunt / in-trade / done).
// Underlying data comes from useSetups, useTrades, useSessionBrief, useChat —
// all existing hooks. This one composes them into one reducer + a single
// subState selector.

import { useEffect, useReducer, useCallback } from "react";

export const INITIAL = {
  phase: "idle",           // 'idle' | 'open_reaction' | 'entry_hunt' | 'in_trade' | 'wrap'
  activeTrade: null,       // current open trade, if any
  surfacedSetup: null,     // setup awaiting accept/reject (entry_hunt only)
  ltfBias: null,           // current open-reaction LTF bias
  setupHistory: [],        // today's confirmed setups (read-only display)
  lastBarReadMessage: null,
};

export function reducer(s, action) {
  switch (action.type) {
    case "PHASE_SET":        return { ...s, phase: action.phase };
    case "ACTIVE_TRADE_SET": return { ...s, activeTrade: action.trade };
    case "ACTIVE_TRADE_CLEAR": return { ...s, activeTrade: null };
    case "SURFACED_SETUP":   return { ...s, surfacedSetup: action.setup };
    case "ACCEPT_SETUP":     return { ...s, surfacedSetup: null };
    case "REJECT_SETUP":     return { ...s, surfacedSetup: null };
    case "LTF_BIAS_SET":     return { ...s, ltfBias: action.bias };
    case "SETUP_HISTORY_SET": return { ...s, setupHistory: action.setups };
    case "BAR_READ_MESSAGE": return { ...s, lastBarReadMessage: action.message };
    default: return s;
  }
}

export function deriveSubState({ phase, activeTrade, surfacedSetup }) {
  if (activeTrade) return "in-trade";            // always wins
  if (phase === "wrap")           return "done";
  if (surfacedSetup)              return "entry-hunt";
  if (phase === "open_reaction")  return "open-reaction";
  if (phase === "entry_hunt")     return "entry-hunt";
  return "idle";
}

export function useLive() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Subscribe to setup surface events
  useEffect(() => {
    const offSetup = window.api?.setups?.onCurrent?.((setup) => {
      dispatch({ type: "SURFACED_SETUP", setup });
    });
    return offSetup;
  }, []);

  // Subscribe to trade events
  useEffect(() => {
    const off1 = window.api?.trade?.onAccepted?.((trade) => dispatch({ type: "ACTIVE_TRADE_SET", trade }));
    const off2 = window.api?.trade?.onOutcome?.(() => dispatch({ type: "ACTIVE_TRADE_CLEAR" }));
    return () => { off1?.(); off2?.(); };
  }, []);

  const subState = deriveSubState(state);

  const acceptSetup = useCallback(async (setup) => {
    dispatch({ type: "ACCEPT_SETUP" });
    return window.api?.trade?.accept?.(setup);
  }, []);

  const rejectSetup = useCallback(async (setupId, reason) => {
    dispatch({ type: "REJECT_SETUP" });
    return window.api?.trade?.reject?.(setupId, reason);
  }, []);

  const tvHandoff = useCallback((kind) => {
    // No broker writes (CLAUDE.md #2). Each kind fires a toast + scrolls
    // the TV chart pane into view. The real chart scroll is done by the
    // TvChart component listening for these events.
    window.dispatchEvent(new CustomEvent("backtest:tv-handoff", { detail: { kind } }));
  }, []);

  return {
    state, subState,
    actions: { acceptSetup, rejectSetup, tvHandoff },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/use-live.test.js 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/hooks/useLive.js tests/use-live.test.js
git commit -m "feat(workstations): useLive hook (subState derivation + accept/reject + TV handoff)"
```

---

### Task 6: `useReview` hook + tests

**Files:**
- Create: `app/renderer/src/hooks/useReview.js`
- Create: `tests/use-review.test.js`

Manages the REVIEW popover's library load + session selection.

- [ ] **Step 1: Write the failing tests**

```js
// tests/use-review.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { reducer, INITIAL } from "../app/renderer/src/hooks/useReview.js";

test("INITIAL — library empty/loading, no journal selected", () => {
  assert.deepEqual(INITIAL.library, { sessions: [], loading: true });
  assert.equal(INITIAL.selectedDate, null);
  assert.equal(INITIAL.selectedSession, null);
  assert.equal(INITIAL.journal, null);
});

test("reducer — LIBRARY_LOADED stores sessions + clears loading", () => {
  const sessions = [
    { date: "2026-05-28", session: "ny-am", grade: "A+", total_r: 1.7 },
    { date: "2026-05-27", session: "ny-am", grade: "A+", total_r: 3.2 },
  ];
  const s = reducer(INITIAL, { type: "LIBRARY_LOADED", sessions });
  assert.equal(s.library.sessions.length, 2);
  assert.equal(s.library.loading, false);
});

test("reducer — SELECT_SESSION records the selected session", () => {
  const s = reducer(INITIAL, { type: "SELECT_SESSION", date: "2026-05-28", session: "ny-am" });
  assert.equal(s.selectedDate, "2026-05-28");
  assert.equal(s.selectedSession, "ny-am");
});

test("reducer — JOURNAL_LOADED stores the journal payload", () => {
  const journal = { ledger: [], agentState: {}, wrapProse: "..." };
  const s = reducer(INITIAL, { type: "JOURNAL_LOADED", journal });
  assert.deepEqual(s.journal, journal);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/use-review.test.js 2>&1 | tail -5
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// app/renderer/src/hooks/useReview.js
// State + IPC for the REVIEW popover. Wraps the existing review:* IPC channels.

import { useEffect, useReducer, useCallback } from "react";

export const INITIAL = {
  library: { sessions: [], loading: true },
  selectedDate: null,
  selectedSession: null,
  journal: null,    // { ledger, agentState, wrapProse, ... } once loaded
};

export function reducer(s, action) {
  switch (action.type) {
    case "LIBRARY_LOADED": return { ...s, library: { sessions: action.sessions, loading: false } };
    case "SELECT_SESSION": return { ...s, selectedDate: action.date, selectedSession: action.session, journal: null };
    case "JOURNAL_LOADED": return { ...s, journal: action.journal };
    default: return s;
  }
}

export function useReview() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Initial library load + default to today's session
  useEffect(() => {
    window.api?.review?.library?.(5).then((sessions) => {
      dispatch({ type: "LIBRARY_LOADED", sessions: sessions ?? [] });
      // Auto-select the most-recent
      const latest = sessions?.[0];
      if (latest) {
        dispatch({ type: "SELECT_SESSION", date: latest.date, session: latest.session });
      }
    });
  }, []);

  // When a session is selected, fetch its journal
  useEffect(() => {
    if (state.selectedDate && state.selectedSession) {
      window.api?.review?.journal?.(state.selectedDate, state.selectedSession)
        .then((journal) => dispatch({ type: "JOURNAL_LOADED", journal }));
    }
  }, [state.selectedDate, state.selectedSession]);

  const selectSession = useCallback((date, session) => {
    dispatch({ type: "SELECT_SESSION", date, session });
  }, []);

  const exportJson = useCallback(() => {
    if (state.selectedDate && state.selectedSession) {
      return window.api?.review?.exportSession?.(state.selectedDate, state.selectedSession);
    }
  }, [state.selectedDate, state.selectedSession]);

  return {
    state,
    actions: { selectSession, exportJson },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/use-review.test.js 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/hooks/useReview.js tests/use-review.test.js
git commit -m "feat(workstations): useReview hook (library + journal + selection)"
```

---

### Task 7: CSS additions — new popover content classes

**Files:**
- Modify: `app/renderer/src/app.css`

Add the CSS rules for the new popover content (PREP form rows, LEVELS grid, BRIEF prose, etc.). Do NOT delete the existing `.main.split-50` rules yet — that happens in Task 12 after the JSX no longer references them.

- [ ] **Step 1: Append new CSS block at the end of `app/renderer/src/app.css`**

The full CSS for PREP/LIVE/REVIEW popovers lives in the mockup file `.superpowers/brainstorm/95688-1779939262/content/prep-420-v2.html` (and `review-660.html`, `live-in-trade-420.html`). Port those style blocks into a new `/* ═══ WORKSTATION POPOVERS ═══ */` section in `app.css`.

Specifically port: `.popover` (660 + 420 width variants), `.popover .head`, `.popover .body`, `.popover .section`, `.popover .sect-hd`, `.status-strip`, `.htf-row`, `.primary`, `.lvl-grp / .lvl-grp-hd / .lvl`, `.pillar2`, `.brief-prose`, `.scn`, `.live-grid-2x2`, `.trade-head`, `.tv-handoffs`, `.trade-narration`, `.lib-row`, `.ledger` (with first/last cell flush padding), `.btn-mini`.

Match the recipe: each popover uses `position:absolute; top:100%; right:0; border-top:0; box-shadow:0 6px 20px rgba(0,0,0,0.6); z-index:60`. Add `max-width:calc(100vw - 40px)` to 660 + 880 variants.

- [ ] **Step 2: Verify app.css still parses (no syntax errors)**

```bash
node -e "const fs=require('fs'); const css=fs.readFileSync('app/renderer/src/app.css','utf8'); console.log('lines:',css.split('\\n').length,'last 3 chars:',JSON.stringify(css.slice(-3)));"
```
Expected: lines count increased; file ends with `}` (no truncation).

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "feat(workstations): add popover CSS for PREP / LIVE / REVIEW bodies"
```

---

### Task 8: Convert `Prep.jsx` → `PrepPopover.jsx` + export `<PrepCell />`

**Files:**
- Rename: `app/renderer/src/Prep.jsx` → `app/renderer/src/PrepPopover.jsx`
- Modify: any importer of `PrepWorkstation`

Existing `Prep.jsx` exports `<PrepWorkstation />` as a full-pane component. Refactor:
- Extract the section bodies into a `<PrepBody />` component
- Add a new `<PrepCell />` thin wrapper that owns the popover open/close state
- Delete the outer `<PrepWorkstation />` wrapper

- [ ] **Step 1: Move the file**

```bash
git mv app/renderer/src/Prep.jsx app/renderer/src/PrepPopover.jsx
```

- [ ] **Step 2: Audit the current exports + sub-components**

```bash
grep -n "^export\|^function" app/renderer/src/PrepPopover.jsx | head -20
```
Note the export names. Most likely `PrepWorkstation` is the only named export; sub-components are private.

- [ ] **Step 3: Refactor to popover shape**

At the top of `PrepPopover.jsx`, restructure:

```jsx
import React, { useState } from "react";
import { usePrep } from "./hooks/usePrep.js";
import { useBacktestRunning } from "./hooks/useBacktest.js";
// ...keep existing imports for sub-components

// Body component — was the inside of <PrepWorkstation>. Restructured for the
// 660px popover surface (LEVELS grouped ABOVE/BELOW, single-line PRICE QUALITY,
// new BRIEF·CLAUDE prose section, etc. — see spec).
function PrepBody({ prep, onClose }) {
  const { running: btRunning, session: btSession } = useBacktestRunning();
  if (btRunning) {
    return (
      <div style={{ padding: "60px 14px", textAlign: "center", color: "var(--label-dim)", letterSpacing: "0.22em", fontSize: 11 }}>
        BACKTEST RUNNING · {btSession?.toUpperCase()}<br />
        LIVE DATA UNAVAILABLE
      </div>
    );
  }
  if (!prep.derived.hasBrief) {
    return (
      <div className="section" style={{ textAlign: "center", padding: "40px 14px" }}>
        <div style={{ color: "var(--label)", fontSize: 12, marginBottom: 14 }}>No brief for today's session yet.</div>
        <button className="start-btn" onClick={prep.actions.runBrief} disabled={prep.state.isLoading}>
          {prep.state.isLoading ? "Running…" : "▶  RUN BRIEF NOW"}
        </button>
        {prep.state.error && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 10 }}>{prep.state.error}</div>}
      </div>
    );
  }
  return (
    <>
      <StatusStrip derived={prep.derived} onRefresh={prep.actions.runBrief} loading={prep.state.isLoading} />
      <HtfBiasSection derived={prep.derived} />
      <LevelsSection derived={prep.derived} onArm={prep.actions.armLevel} onDisarm={prep.actions.disarmLevel} />
      <PriceQualitySection derived={prep.derived} />
      <BriefProseSection derived={prep.derived} />
      <ScenariosSection derived={prep.derived} />
    </>
  );
}

// Cell — exported, mounted in App.jsx topbar
export function PrepCell() {
  const [open, setOpen] = useState(false);
  const prep = usePrep();
  return (
    <div className={"cell pop-cell" + (open ? " open" : "")} onClick={(e) => {
      if (e.target.closest(".popover")) return;
      setOpen((o) => !o);
    }}>
      <span className="k">PREP</span>
      <GradeBadge grade={prep.derived.grade} />
      {open && (
        <div className="popover popover-660" onClick={(e) => e.stopPropagation()}>
          <div className="head">
            <span className="t">PREP · {prep.derived.date ?? "—"} {prep.derived.session?.toUpperCase() ?? ""}</span>
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            <PrepBody prep={prep} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function GradeBadge({ grade }) {
  const cls = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  return <span className={"gp " + cls}>{grade ?? "—"}</span>;
}
```

Move the existing `StatusStrip`, `HtfBiasSection`, `LevelsSection`, etc. sub-components into the file (they were probably inline before). For `LevelsSection`, change the bell `<span>` to a button-style with `onClick` calling `onArm(price, label)` / `onDisarm(id)`. Use the existing armed/unarmed visual state.

Delete the old `<PrepWorkstation />` export.

- [ ] **Step 4: Update importers**

```bash
grep -rn "PrepWorkstation\|from \"./Prep\"" app/renderer/src/ | grep -v PrepPopover
```
If `App.jsx` imports `PrepWorkstation`, replace with `PrepCell` (the App.jsx wiring happens in Task 11; for now just verify no orphan import).

- [ ] **Step 5: Verify helper tests still pass (Prep.helpers.js unchanged)**

```bash
node --test tests/prep-helpers.test.js 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: same pass count.

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/PrepPopover.jsx
git commit -m "refactor(workstations): convert Prep.jsx → PrepPopover.jsx + extract PrepCell"
```

---

### Task 9: Convert `Live.jsx` → `LivePopover.jsx` + export `<LiveCell />`

**Files:**
- Rename: `app/renderer/src/Live.jsx` → `app/renderer/src/LivePopover.jsx`

Same pattern as Task 8 but with 5 sub-states. Body renders one of:
- `IdleBody` (subState === "idle")
- `OpenReactionBody`
- `EntryHuntBody` (HUNT — STEP 5+6 + surfaced setup decision card)
- `InTradeBody` (LIVE GRID 2×2 + risk rows + TV handoffs + BRAIN + setup history)
- `DoneBody` (read-only snapshot of last session's wrap output)

- [ ] **Step 1: Move the file**

```bash
git mv app/renderer/src/Live.jsx app/renderer/src/LivePopover.jsx
```

- [ ] **Step 2: Audit current exports**

```bash
grep -n "^export\|^function" app/renderer/src/LivePopover.jsx | head -20
```

- [ ] **Step 3: Restructure into Body + Cell pattern**

```jsx
import React, { useState } from "react";
import { useLive } from "./hooks/useLive.js";
import { useBacktestRunning } from "./hooks/useBacktest.js";
import { useChat } from "./hooks/useChat.js"; // for BRAIN narration
// ...existing imports

function LiveBody({ live, chat }) {
  const { running: btRunning, session: btSession } = useBacktestRunning();
  if (btRunning) {
    return (
      <div style={{ padding: "60px 14px", textAlign: "center", color: "var(--label-dim)", letterSpacing: "0.22em", fontSize: 11 }}>
        BACKTEST RUNNING · {btSession?.toUpperCase()}<br />
        LIVE DATA UNAVAILABLE
      </div>
    );
  }
  switch (live.subState) {
    case "idle":          return <IdleBody />;
    case "open-reaction": return <OpenReactionBody live={live} />;
    case "entry-hunt":    return <EntryHuntBody live={live} chat={chat} />;
    case "in-trade":      return <InTradeBody live={live} chat={chat} />;
    case "done":          return <DoneBody />;
  }
}

export function LiveCell() {
  const [open, setOpen] = useState(false);
  const live = useLive();
  const chat = useChat();
  return (
    <div className={"cell pop-cell" + (open ? " open" : "")} onClick={(e) => {
      if (e.target.closest(".popover")) return;
      setOpen((o) => !o);
    }}>
      <span className="k">LIVE</span>
      <LiveBadge live={live} />
      {open && (
        <div className="popover popover-420" onClick={(e) => e.stopPropagation()}>
          <div className="head">
            <span className="t">LIVE · {labelForSubState(live.subState)}</span>
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            <LiveBody live={live} chat={chat} />
          </div>
        </div>
      )}
    </div>
  );
}

function LiveBadge({ live }) {
  const ss = live.subState;
  if (ss === "in-trade") {
    const pnlR = live.state.activeTrade?.unrealized_r ?? 0;
    const cls = pnlR >= 0 ? "green" : "red";
    return <><span className={"pulse " + cls} /><span className={"pnl " + cls}>{pnlR >= 0 ? "+" : ""}{pnlR.toFixed(1)}R</span></>;
  }
  if (ss === "entry-hunt" || ss === "open-reaction") {
    return <><span className="pulse" /><span className="state amber">HUNT</span></>;
  }
  if (ss === "done") return <><span className="dot dim" /><span className="state">DONE</span></>;
  return <><span className="dot dim" /><span className="state">IDLE</span></>;
}

function labelForSubState(s) {
  return { idle: "IDLE", "open-reaction": "OPEN REACTION", "entry-hunt": "ENTRY HUNT", "in-trade": "IN TRADE", done: "DONE" }[s] ?? "—";
}
```

Move existing sub-components (`SetupCard`, `TradeCard usage`, etc.) into the file. Restructure the IN-TRADE body to use `.live-grid-2x2` instead of the old 4-wide grid. Wire the TV handoff buttons to call `live.actions.tvHandoff("stop"|"scale"|"close")` and fire toast (existing toast plumbing — check `app/renderer/src/Shared.jsx` for `showToast` or similar).

Delete the old `LiveWorkstation` export.

- [ ] **Step 4: Verify helper tests still pass**

```bash
node --test tests/live-helpers.test.js 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: same pass count.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/LivePopover.jsx
git commit -m "refactor(workstations): convert Live.jsx → LivePopover.jsx + extract LiveCell (5 sub-states)"
```

---

### Task 10: Convert `Review.jsx` → `ReviewPopover.jsx` + export `<ReviewCell />`

**Files:**
- Rename: `app/renderer/src/Review.jsx` → `app/renderer/src/ReviewPopover.jsx`

Same pattern. REVIEW body has STATUS STRIP, WRAP·CLAUDE prose, candidate ledger, AGENT STATE, SESSION LIBRARY.

- [ ] **Step 1: Move the file**

```bash
git mv app/renderer/src/Review.jsx app/renderer/src/ReviewPopover.jsx
```

- [ ] **Step 2: Audit current structure**

```bash
grep -n "^export\|^function" app/renderer/src/ReviewPopover.jsx | head -20
```

- [ ] **Step 3: Restructure into Body + Cell**

```jsx
import React, { useState } from "react";
import { useReview } from "./hooks/useReview.js";
// ...keep existing imports for the ledger + TradeCard pieces

function ReviewBody({ review }) {
  // REVIEW is NOT affected by BACKTEST exclusive mode (reads historical state)
  if (review.state.library.loading) {
    return <div style={{ padding: 20, color: "var(--label-dim)", textAlign: "center" }}>Loading library…</div>;
  }
  return (
    <>
      <StatusStripSection review={review} />
      <WrapProseSection review={review} />
      <LedgerSection review={review} />
      <AgentStateSection review={review} />
      <SessionLibrarySection review={review} />
    </>
  );
}

export function ReviewCell() {
  const [open, setOpen] = useState(false);
  const review = useReview();
  return (
    <div className={"cell pop-cell" + (open ? " open" : "")} onClick={(e) => {
      if (e.target.closest(".popover")) return;
      setOpen((o) => !o);
    }}>
      <span className="k">REVIEW</span>
      <ReviewBadge review={review} />
      {open && (
        <div className="popover popover-660" onClick={(e) => e.stopPropagation()}>
          <div className="head">
            <span className="t">REVIEW · {review.state.selectedDate ?? "—"}</span>
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            <ReviewBody review={review} />
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewBadge({ review }) {
  const selected = review.state.library.sessions[0];   // today's
  if (!selected) return <span className="count dim">0</span>;
  const tr = selected.total_r ?? 0;
  if (tr === 0) return <span className="count">{selected.setups ?? 0}</span>;
  const cls = tr > 0 ? "green" : "red";
  return <span className={"count " + cls}>{tr > 0 ? "+" : ""}{tr.toFixed(1)}R</span>;
}
```

Move existing sub-components. For the candidate ledger, ensure first/last `<td>` and `<th>` use `padding-left: 0 / padding-right: 0` so the TS column aligns with the section's 14px left edge (per spec). Reuse `<TradeCard>` from `Shared.jsx` for inline-expand on confirmed rows.

For `SessionLibrarySection`, use the `.lib-row` grid `55px 70px 1fr 65px 80px`.

Delete the old `<ReviewWorkstation />` export.

- [ ] **Step 4: Verify helper tests**

```bash
node --test tests/review-helpers.test.js 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: same pass count.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/ReviewPopover.jsx
git commit -m "refactor(workstations): convert Review.jsx → ReviewPopover.jsx + extract ReviewCell"
```

---

### Task 11: Rewire App.jsx — remove mode tabs/state, add new cells

**Files:**
- Modify: `app/renderer/src/App.jsx`

- [ ] **Step 1: Audit current App.jsx imports + state**

```bash
grep -n "PrepWorkstation\|LiveWorkstation\|ReviewWorkstation\|\\[mode" app/renderer/src/App.jsx
```

- [ ] **Step 2: Replace imports**

In `App.jsx`, change:

```jsx
import { PrepWorkstation } from "./Prep.jsx";
import { LiveWorkstation } from "./Live.jsx";
import { ReviewWorkstation } from "./Review.jsx";
```

To:

```jsx
import { PrepCell } from "./PrepPopover.jsx";
import { LiveCell } from "./LivePopover.jsx";
import { ReviewCell } from "./ReviewPopover.jsx";
```

- [ ] **Step 3: Remove the mode tabs JSX block**

Find the `<div className="modes">…</div>` block (likely around line 260) and delete it.

- [ ] **Step 4: Remove the `mode` React state**

Find `const [mode, setMode] = useState(...)` and delete. Also delete any `useEffect` that listens to `mode:current` IPC. Delete the `<PrepWorkstation>` / `<LiveWorkstation>` / `<ReviewWorkstation>` mounts in the body — they're gone now.

- [ ] **Step 5: Add the new cells in the topbar status section**

Find the topbar `<div className="status">` and add `<PrepCell />`, `<LiveCell />`, `<ReviewCell />` between `<BacktestCell />` and the existing `<div className="cell pop-cell claude-cell">` block:

```jsx
<BacktestCell />
<PrepCell />
<LiveCell />
<ReviewCell />
<div className="cell pop-cell claude-cell" /* existing CLAUDE cell */ />
```

- [ ] **Step 6: Render the chart as the full main area**

The main pane currently uses `.main.split-50` / `.split-70` to share width with the work-pane. Now the chart fills:

```jsx
<div className="app">
  <Topbar /* ... */ />
  <div className="main"> {/* no split-50 / split-70 class anymore */}
    <TradingViewChart symbol={symbol} />
  </div>
  <Statusline />
</div>
```

(Note `.chart-host` may also have split classes — verify with grep and remove.)

- [ ] **Step 7: Manual smoke (lightweight — don't restart Electron, the backtest is running)**

If you're confident the JSX compiles, skip the full electron launch. Instead:

```bash
node --check app/renderer/src/App.jsx 2>&1 | head -3 || echo "JSX can't be checked directly; rely on Vite's HMR"
```

(JSX won't parse with `node --check` — Vite handles that on next render.)

- [ ] **Step 8: Commit**

```bash
git add app/renderer/src/App.jsx
git commit -m "refactor(workstations): remove mode tabs + mode state; mount PrepCell/LiveCell/ReviewCell"
```

---

### Task 12: Delete dead CSS

**Files:**
- Modify: `app/renderer/src/app.css`

Remove the rules that supported the old full-pane / split layout.

- [ ] **Step 1: Identify the rules to remove**

```bash
grep -n "\\.main\\.split-50\\|\\.main\\.split-70\\|\\.work-pane\\|\\.chart-host\\.split" app/renderer/src/app.css
```

- [ ] **Step 2: Remove them with Edit (one at a time)**

Use the Edit tool to delete each of:
- `.main.split-50 { … }`
- `.main.split-70 { … }`
- `.chart-host.split-50 { … }`
- `.chart-host.split-70 { … }`
- `.work-pane { … }` (if no other consumer)
- `.work-scroll { … }` (if only consumed by work-pane)

Keep `.chart-host` itself (without split modifiers) — TvChart still uses it. Keep `.chart-spacer` if needed.

- [ ] **Step 3: Verify app.css still parses**

```bash
node -e "fs.readFileSync('app/renderer/src/app.css','utf8').match(/\\.main\\.split/) ? console.log('STILL PRESENT') : console.log('CLEAN');"
```
Expected: `CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "refactor(workstations): delete .main.split-50/-70 + .work-pane CSS (popovers replace split-pane)"
```

---

### Task 13: Remove dead `mode:switch` IPC handler + preload exposure

**Files:**
- Modify: `app/main/ipc.js` (if `mode:switch` handler exists and is no longer used)
- Modify: `app/preload.cjs` (remove `mode.switch / mode.onCurrent`)

- [ ] **Step 1: Confirm no remaining consumers**

```bash
grep -rn "mode:switch\|api.mode\\." app/ --include="*.js" --include="*.cjs" --include="*.jsx"
```

If only the handler + preload are left, safe to delete. If any other consumer remains, leave the handler in place + add a `// deprecated` comment.

- [ ] **Step 2: Remove from `ipc.js`**

Find and delete the `ipcMain.handle("mode:switch", ...)` block.

- [ ] **Step 3: Remove from `preload.cjs`**

Find and delete the `mode: { switch(mode) { ... }, onCurrent(cb) { ... } }` block.

- [ ] **Step 4: Verify regression**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ" | tail -5
```
Expected: same pass count as baseline.

- [ ] **Step 5: Commit**

```bash
git add app/main/ipc.js app/preload.cjs
git commit -m "chore(workstations): remove dead mode:switch IPC + preload exposure"
```

---

### Task 14: Hotkeys 1/2/3 → open PREP/LIVE/REVIEW popovers

**Files:**
- Modify: `app/renderer/src/App.jsx` (or wherever the keydown listener lives)

- [ ] **Step 1: Find existing hotkey handler**

```bash
grep -rn "keydown\|onKeyDown\|hotkey" app/renderer/src/ | head -10
```

If hotkeys for `1/2/3` exist, retarget them. If not, add a new listener.

- [ ] **Step 2: Wire the keydown listener in App.jsx**

```jsx
useEffect(() => {
  const onKey = (e) => {
    if (e.target.matches("input, textarea")) return;  // don't intercept typing
    if (e.key === "1") {/* open PREP — see Step 3 */}
    if (e.key === "2") {/* open LIVE */}
    if (e.key === "3") {/* open REVIEW */}
    if (e.key === "Escape") {/* close any open popover */}
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

- [ ] **Step 3: Implement open/close**

Since each `*Cell` owns its own open state, the simplest wiring is to emit window events that the cells listen for:

```jsx
// in App.jsx
const openCell = (which) => window.dispatchEvent(new CustomEvent("topbar:open-cell", { detail: { which } }));
if (e.key === "1") openCell("PREP");
// etc.

// in each *Cell
useEffect(() => {
  const onOpen = (e) => {
    if (e.detail.which === "PREP") setOpen(true);  // adjust per cell
    if (e.detail.which === "all-close") setOpen(false);
  };
  window.addEventListener("topbar:open-cell", onOpen);
  return () => window.removeEventListener("topbar:open-cell", onOpen);
}, []);
```

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/App.jsx app/renderer/src/PrepPopover.jsx app/renderer/src/LivePopover.jsx app/renderer/src/ReviewPopover.jsx
git commit -m "feat(workstations): hotkeys 1/2/3 open PREP/LIVE/REVIEW popovers; Esc closes"
```

---

### Task 15: Final manual smoke + CLAUDE.md row

**Files:** none (testing + docs)

- [ ] **Step 1: Run the full unit test suite**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ" | tail -8
```
Expected: pass count = baseline + new (use-prep + use-live + use-review + schema = ~22 new tests).

- [ ] **Step 2: Smoke fixtures still 16/16**

```bash
npm run smoke:fixtures 2>&1 | tail -8
```
Expected: 16/16 pass.

- [ ] **Step 3: Manual end-to-end (only when the background backtest finishes — DON'T restart Electron until then)**

When safe:
1. Reload the renderer (Cmd-R in Electron) — no full restart needed
2. Confirm topbar: `NEWS · ALERTS · BACKTEST · PREP · LIVE · REVIEW · CLAUDE`. No `01 / 02 / 03` mode tabs.
3. Click PREP — popover at 660px drops down. Shows brief if available, else "▶ RUN BRIEF NOW" button. Click bells → alerts arm.
4. Click LIVE — 420px popover. If a session is live, shows HUNT body. If a trade is open, IN-TRADE body with LIVE GRID 2×2 + TV handoff buttons.
5. Click REVIEW — 660px popover with ledger table + agent state + session library.
6. Hotkeys 1/2/3 open the same popovers; Esc closes.
7. Start a backtest (via BACKTEST popover) — PREP and LIVE popovers should show the "BACKTEST RUNNING" placeholder.
8. Click row in REVIEW SESSION LIBRARY → journal loads in-place.

- [ ] **Step 4: Add architecture-decision row to CLAUDE.md**

In `CLAUDE.md` under **Architecture decisions** table, append:

```markdown
| 2026-05-28 | Workstation popovers (PREP/LIVE/REVIEW → topbar cells) | Retired the 01 PREP / 02 LIVE / 03 REVIEW mode tabs in favor of topbar-anchored popovers matching the BACKTEST/CLAUDE/ALERTS recipe. Chart fills the entire main area below the topbar. Widths: PREP 660px, LIVE 420px always (HUNT + IN-TRADE), REVIEW 660px. Per-cell badges convey state at-a-glance (PREP grade pill, LIVE tri-state dim/amber-HUNT/colored-P&L, REVIEW count or day P&L). Three new hooks (`usePrep`, `useLive`, `useReview`) parallel `useBacktest`'s reducer pattern. Two schema extensions: `prose_summary` field on `surface_session_brief` + `surface_session_summary` so Claude writes free-form prose in BRIEF/WRAP popover sections. Levels bells interactive (wire to existing alert IPC). TV handoff buttons in LIVE IN-TRADE fire toast + chart-scroll only (no broker writes per CLAUDE.md constraint #2). PREP empty state shows `▶ RUN BRIEF NOW` button. HUNT → IN-TRADE transition swaps body in-place without closing the popover. Exclusive mode preserved: PREP/LIVE show "BACKTEST RUNNING" placeholder when a backtest is active; REVIEW is unaffected (reads historical state). Removed: `<*Workstation>` outer wrappers, `.main.split-50/-70` + `.work-pane` CSS, `mode` React state + `mode:switch` IPC. Spec: [docs/superpowers/specs/2026-05-28-workstation-popovers-design.md](docs/superpowers/specs/2026-05-28-workstation-popovers-design.md). Plan: [docs/superpowers/plans/2026-05-28-workstation-popovers.md](docs/superpowers/plans/2026-05-28-workstation-popovers.md). |
```

- [ ] **Step 5: Commit + push + PR**

```bash
git add CLAUDE.md
git commit -m "docs: workstation popovers architecture-decision row"
git push -u origin feat/workstation-popovers
gh pr create --title "feat(workstations): PREP/LIVE/REVIEW → topbar popovers; chart full-width" --body "$(cat <<'EOF'
## Summary
- Retire `01 PREP / 02 LIVE / 03 REVIEW` mode tabs; chart fills the main area
- Add three new topbar cells (PREP / LIVE / REVIEW) matching the BACKTEST/CLAUDE/ALERTS popover recipe
- Widths: PREP 660px, LIVE 420px always (HUNT + IN-TRADE), REVIEW 660px
- Per-cell badges convey state at-a-glance (PREP grade pill, LIVE tri-state with live P&L, REVIEW day P&L)
- Two schema additions: `prose_summary` on `surface_session_brief` + `surface_session_summary` for free-form BRIEF/WRAP prose blocks
- Interactive bells in PREP LEVELS (existing alert IPC, no new server code)
- TV handoff buttons in LIVE IN-TRADE: toast + chart-scroll only (no broker writes per CLAUDE.md #2)
- Exclusive mode preserved: PREP/LIVE show "BACKTEST RUNNING" placeholder when a run is active

## Test plan
- [x] Unit tests for the 3 new hooks + schema extensions (~22 new tests)
- [x] Smoke fixtures still 16/16
- [x] Manual: full session flow — PREP brief, LIVE hunt → accept → in-trade with 2×2 grid, REVIEW ledger + library
- [x] Bells in PREP LEVELS arm/disarm alerts via existing IPC
- [x] Hotkeys 1/2/3 open popovers; Esc closes

Spec: docs/superpowers/specs/2026-05-28-workstation-popovers-design.md
Plan: docs/superpowers/plans/2026-05-28-workstation-popovers.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (do this before handing off)

After all 15 tasks land:

1. **Spec coverage:** Every section of the spec maps to a task:
   - Topbar shape (mode tabs out, 3 new cells) → Task 11
   - Badges per cell → Tasks 8/9/10 (each cell renders its own badge)
   - Widths (660 / 420 / 660) → Task 7 (CSS) + Tasks 8/9/10 (cell mounts with width class)
   - PREP body (HTF / LEVELS / PRICE QUALITY / BRIEF · CLAUDE / SCENARIOS) → Task 8
   - LIVE body (5 sub-states) → Task 9
   - REVIEW body (STATUS / WRAP · CLAUDE / LEDGER / AGENT / LIBRARY) → Task 10
   - Schema additions → Task 2
   - Prompt updates → Task 3
   - Interactive bells → Task 8 (LevelsSection)
   - TV handoffs (toast only, no broker) → Task 9 (`tvHandoff` in useLive)
   - PREP empty state ("RUN BRIEF NOW") → Task 8 (PrepBody empty branch)
   - HUNT → IN-TRADE in-place → Task 9 (Body switches on subState)
   - Exclusive mode → Tasks 8/9 (`useBacktestRunning` check at top of each Body)
   - File reorganization → Tasks 8/9/10 (renames) + Task 12 (CSS dead) + Task 13 (IPC dead)
   - Hotkeys 1/2/3 → Task 14

2. **Placeholder scan:** No "TBD" / "TODO" / "implement later" in any task. Each step has concrete code or a concrete command.

3. **Type consistency:**
   - `subState` always one of `idle | open-reaction | entry-hunt | in-trade | done` across `deriveSubState`, `LiveBody` switch, and `labelForSubState`
   - `prose_summary` (snake_case) used consistently on the JSON / schema side; `proseSummary` (camelCase) used in the React derived state
   - Hook return shape `{ state, derived?, actions }` is consistent across `usePrep / useLive / useReview` and matches `useBacktest`'s shape

4. **Implementation order:** Backend (schemas + prompts) → hooks → CSS → file renames → App.jsx wiring → cleanup → hotkeys → finalize. Each task produces a committable artifact.

---

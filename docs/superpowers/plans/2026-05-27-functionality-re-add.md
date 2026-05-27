# Functionality re-add (essentialist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-add the functionality from PRs #65/#66/#67 (PREP/LIVE/REVIEW) on top of the reference 1:1 port, applying the essentialist cuts and the new design decisions from the 2026-05-27 brainstorm.

**Architecture:** Single feature branch `feat/reference-1to1-port` (already created — commit e23164a is the base). Five logical strata implemented in order: (1) spec/plan commit, (2) `app.css` foundations (palette + unified `.pill` + label width), (3) backend calendar service + IPC + tests, (4) `App.jsx` top-bar additions (CLAUDE popover, NEWS popover rewrite) + drop legacy adapter, (5) per-page rewrites (PREP → 5 panels, LIVE → sub-state routed, REVIEW → 3 panels). Each task is self-contained with a verification step; commits go in often.

**Tech Stack:** Electron main + React 18 renderer (Vite + Babel), ESM throughout, `node --test` for unit tests, existing hooks (`useSessionBrief` / `useTrades` / `useActiveSetup` / `useOpenReaction` / `useReview` / `useLastBar` / `useSymbolCache` / `useChat` / `useHealth` / `useAlerts`), ForexFactory JSON feed for news (`https://nfs.faireconomy.media/ff_calendar_thisweek.json`), `state/calendar/this-week.json` for cache.

**Reference docs:** Spec — [docs/superpowers/specs/2026-05-27-functionality-re-add.md](../specs/2026-05-27-functionality-re-add.md). Final visual mockup — `.superpowers/brainstorm/82664-1779880567/content/05-essentialist.html`. Prior PRs for component recovery — `0ea50fe` (PREP #65), `3898e29` (LIVE #66), `7359110` (REVIEW #67).

---

## File-level inventory

**Created:**
- `app/main/calendar.js` — ForexFactory fetcher + cache + filter + scheduler hookup.
- `tests/calendar.test.js` — unit tests for filter + cache + imminent helper.

**Modified:**
- `app/renderer/src/app.css` — palette swap to black, unified `.pill` class, `.row` label column shrunk 230→160px, CLAUDE popover styles, NEWS popover restyle (weekday grouping + impact tints + imminent highlight).
- `app/renderer/src/App.jsx` — drop `useDataAdapter` writes, add `ClaudePopover` + CLAUDE chip in TopBar, rewrite `NewsPopover` to read `window.api.calendar.thisWeek()`, drill `currentPrice` from `useSymbolCache` into PrepWorkstation.
- `app/renderer/src/Prep.jsx` — replace reference-1:1 body with essentialist 5-panel layout (SESSION BRIEF + STEP 1/2/3 + SCENARIOS), MNQ/MES tabs in SESSION BRIEF header.
- `app/renderer/src/Live.jsx` — replace with essentialist sub-state layout (OpenReaction / EntryHunt / InTrade), broken RISK rows with Stop in red and TP1/TP2 in green, loop banner.
- `app/renderer/src/Review.jsx` — replace with essentialist 3-panel layout (SESSION JOURNAL + CANDIDATE LEDGER + SESSION LIBRARY).
- `app/preload.cjs` — add `calendar.thisWeek()` + `calendar.onUpdate(cb)` IPC bindings.
- `app/main/ipc.js` — register `calendar:this-week` handler.
- `app/electron-main.js` — bootstrap calendar service on app ready.
- `CLAUDE.md` — append decisions-table row for the essentialist re-add.

**Untouched (explicit non-scope):**
- All util pages (System / Risk / Fixtures / Health / Settings) — stay on stub data.
- All renderer hooks — used as-is.
- `app/main/sdk.js`, `app/main/tools/surface.js`, `app/main/prompts/analyze.md` — no backend prompt changes.
- `app/renderer/src/TvChart.jsx`, persistent chart-host — unchanged.
- `app/renderer/src/Shared.jsx` — keep existing exports (TradeCard, ClaudeFeed, etc.) since the popover and ledger expansion reuse them.

---

## Task summary

| # | Task | Files |
|---|------|-------|
| 1 | Commit spec + plan | `docs/superpowers/specs/*.md`, `docs/superpowers/plans/*.md` |
| 2 | CSS: palette + label column + unified `.pill` | `app/renderer/src/app.css` |
| 3 | CSS: CLAUDE popover + restructured RISK colors | `app/renderer/src/app.css` |
| 4 | CSS: NEWS popover restyle (weekday + impact tints + imminent) | `app/renderer/src/app.css` |
| 5 | Calendar backend: `calendar.js` + tests | `app/main/calendar.js`, `tests/calendar.test.js` |
| 6 | Calendar IPC + preload + electron-main bootstrap | `app/main/ipc.js`, `app/preload.cjs`, `app/electron-main.js` |
| 7 | `App.jsx`: drop adapter + drill `currentPrice` + add CLAUDE popover + rewrite NEWS popover | `app/renderer/src/App.jsx` |
| 8 | Prep.jsx rewrite + helper extension | `app/renderer/src/Prep.jsx`, `app/renderer/src/Prep.helpers.js`, `tests/prep-helpers.test.js` |
| 9 | Live.jsx rewrite (sub-state routed, RISK rows broken) | `app/renderer/src/Live.jsx` |
| 10 | Review.jsx rewrite (3-panel essentialist) | `app/renderer/src/Review.jsx` |
| 11 | Manual sanity + dev-server smoke + full test pass | (verification only) |
| 12 | CLAUDE.md decisions row + push + PR | `CLAUDE.md`, branch push |

---

### Task 1: Commit spec + plan

**Files:**
- `docs/superpowers/specs/2026-05-27-functionality-re-add.md` (already created)
- `docs/superpowers/plans/2026-05-27-functionality-re-add.md` (this file, just being created)

- [ ] **Step 1: Verify spec + plan exist**

Run: `ls -la docs/superpowers/specs/2026-05-27-functionality-re-add.md docs/superpowers/plans/2026-05-27-functionality-re-add.md`
Expected: both files present, non-empty.

- [ ] **Step 2: Verify clean working tree apart from the new docs**

Run: `git status --short`
Expected: only the two new doc files (and possibly `tests/.tmp-brief-flow/` which is unrelated and gitignored). No staged changes, no other modifications.

- [ ] **Step 3: Stage the docs**

Run:
```bash
git add docs/superpowers/specs/2026-05-27-functionality-re-add.md docs/superpowers/plans/2026-05-27-functionality-re-add.md
```

- [ ] **Step 4: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
docs(re-add): spec + implementation plan for essentialist re-add

Spec captures the locked design decisions from the 2026-05-27
brainstorm: neutral black palette, unified .pill class (22px height,
44px min-width), CLAUDE conversation as top-bar popover next to ALERTS,
weekly NEWS calendar (ForexFactory, USD high+medium, weekday grouped,
imminent countdown), RISK rows split into Entry/Stop(red)/TP1+TP2(green),
MNQ/MES tabs in SESSION BRIEF header, concise labels with strategy doc
text in title="" tooltips, window.GOFNQ_DATA adapter dropped.

Plan breaks into 12 self-contained tasks; same panel-by-panel discipline
used in PRs #65 (PREP), #66 (LIVE), #67 (REVIEW). Each task ends with a
commit; tests must stay >=309 passing.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify commit**

Run: `git log --oneline -1`
Expected: top line shows `docs(re-add): spec + implementation plan for essentialist re-add`.

---

### Task 2: CSS — palette + label column + unified `.pill`

**Files:**
- Modify: `app/renderer/src/app.css:1-22` (palette tokens)
- Modify: `app/renderer/src/app.css:161-179` (`.row`, `.grade-pill`)

- [ ] **Step 1: Replace `:root` palette tokens**

In `app/renderer/src/app.css`, find the existing `:root` block at the top of the file (currently starts at line 1 with `color-scheme: dark;`). Replace the seven surface/border/label tokens with the neutral-black values from the spec. Keep `--green / --amber / --red / --blue / --prose / --chart-bg / --mono / --topbar-h / --statusline-h / --value / --value-strong` unchanged.

Edit:

```css
:root {
  color-scheme: dark;
  --surface-0:  #000000;
  --surface-1:  #0a0a0a;
  --surface-2:  #131313;
  --border:     #1f1f1f;
  --border-d:   #2e2e2e;
  --label:      #6e6e6e;
  --label-dim:  #3a3a3a;
  --value:      #d8dee8;
  --value-strong: #ffffff;
  --green:      #6ec788;
  --amber:      #ebbb3d;
  --red:        #e0524a;
  --blue:       #6aa3d1;
  --prose:      #b5bdc8;
  --chart-bg:   #04060a;

  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
  --topbar-h: 42px;
  --statusline-h: 28px;
}
```

Leave `html[data-theme="light"]` block (starts ~line 24) untouched — light theme stays as-is.

- [ ] **Step 2: Shrink `.row` label column from 230px to 160px**

In `app/renderer/src/app.css`, locate `.row { display: grid; grid-template-columns: 230px 1fr; ...`. Change `230px` to `160px`:

```css
.row {
  display: grid; grid-template-columns: 160px 1fr;
  gap: 14px; padding: 5px 0; font-size: 11.5px;
  border-bottom: 1px dashed var(--label-dim);
}
```

- [ ] **Step 3: Add unified `.pill` class above the existing `.grade-pill` block**

In `app/renderer/src/app.css`, locate the `.grade-pill` block (currently `.grade-pill { display: inline-block; padding: 1px 7px; ...`). Insert a `.pill` system above it AND retain `.grade-pill` (existing scattered usages depend on it; we make it inherit `.pill` geometry).

Replace the existing block:

```css
.grade-pill {
  display: inline-block; padding: 1px 7px; border: 1px solid;
  font-size: 10px; letter-spacing: 0.14em;
}
.grade-pill.green { color: var(--green); border-color: var(--green); }
.grade-pill.amber { color: var(--amber); border-color: var(--amber); }
.grade-pill.dim   { color: var(--label); border-color: var(--label-dim); }
```

with:

```css
.pill {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 10px; height: 22px; min-width: 44px;
  border: 1px solid var(--border-d);
  font-size: 10px; letter-spacing: 0.14em;
  background: transparent; color: var(--value);
  cursor: default; font-family: var(--mono);
  box-sizing: border-box;
}
.pill.interactive { cursor: pointer; }
.pill.interactive:hover { background: var(--surface-2); }
.pill.green { color: var(--green); border-color: var(--green); }
.pill.amber { color: var(--amber); border-color: var(--amber); }
.pill.red   { color: var(--red);   border-color: var(--red); }
.pill.blue  { color: var(--blue);  border-color: var(--blue); }
.pill.dim   { color: var(--label); border-color: var(--label-dim); }
.pill.active {
  color: var(--amber); border-color: var(--amber);
  background: rgba(235,187,61,0.05);
}

/* Legacy alias kept for SetupCard / ledger rows / scenarios — same geometry. */
.grade-pill {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 10px; height: 22px; min-width: 44px;
  border: 1px solid var(--border-d);
  font-size: 10px; letter-spacing: 0.14em;
  background: transparent;
  font-family: var(--mono);
  box-sizing: border-box;
}
.grade-pill.green { color: var(--green); border-color: var(--green); }
.grade-pill.amber { color: var(--amber); border-color: var(--amber); }
.grade-pill.red   { color: var(--red);   border-color: var(--red); }
.grade-pill.blue  { color: var(--blue);  border-color: var(--blue); }
.grade-pill.dim   { color: var(--label); border-color: var(--label-dim); }
```

- [ ] **Step 4: Boot the renderer + visually verify**

Run (in a second terminal that survives):
```bash
npm --prefix app run dev
```
Open the Electron window. Verify (a) the background is true black, not navy, (b) panel borders are still visible (`--surface-1` = #0a0a0a > black), (c) any existing `grade-pill` (e.g. PREP scenario "A+" / REVIEW row pills) renders at the new 22px tall, ~44px wide shape. Don't pin functionality — the panels will be rewritten in later tasks. We're only checking the color/sizing tokens.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "$(cat <<'EOF'
feat(css): black palette + unified .pill + 160px row label

Replaces the navy-tinted dark palette with neutral black:
  --surface-0 #06090f -> #000000
  --surface-1 #0a0f18 -> #0a0a0a
  --surface-2 #0d1420 -> #131313
  --border    #1c2333 -> #1f1f1f
  --border-d  #3a4456 -> #2e2e2e
  --label     #6a7689 -> #6e6e6e
  --label-dim #3a4456 -> #3a3a3a

Adds a unified .pill class (22px height, 44px min-width, 10px font,
0.14em letter-spacing) used by every chip / tab / small action button.
.grade-pill keeps its name as a legacy alias but inherits the same
geometry so SetupCard / ledger / scenarios match the top-bar pills
visually. New .pill.interactive variant carries a hover state.

.row label column shrinks 230px -> 160px to make room for the
concise strategy labels added later in this PR.

Light-theme palette is untouched.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: CSS — CLAUDE popover + restructured RISK row tones

**Files:**
- Modify: `app/renderer/src/app.css` (append new sections)

- [ ] **Step 1: Append CLAUDE popover styles at the end of `app/renderer/src/app.css`**

Add the new section immediately after the `.alert-toast` rule (which is the last block in the file currently). The popover lives inside a `.cell.pop-cell` so it inherits the same anchoring as NEWS / ALERTS popovers.

Append:

```css
/* CLAUDE chip in top bar — green dot when active. */
.cell .claude-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--label-dim); margin-left: 6px; transition: background 0.2s;
}
.cell .claude-dot.active { background: var(--green); animation: claudePulse 1.6s ease-in-out infinite; }
@keyframes claudePulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1.0;  }
}

/* CLAUDE popover anchored under the CLAUDE chip. */
.claude-popover {
  position: absolute;
  top: 100%;
  right: 0;
  width: 420px;
  max-height: 500px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-top: 0;
  box-shadow: 0 6px 20px rgba(0,0,0,0.6);
  z-index: 60;
  display: flex; flex-direction: column;
  cursor: default;
}
.claude-popover .head {
  padding: 6px 12px; background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
}
.claude-popover .head .t {
  color: var(--blue); font-size: 10px; letter-spacing: 0.22em;
}
.claude-popover .head .x { color: var(--label); cursor: pointer; font-size: 13px; }
.claude-popover .body { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.claude-popover .empty { padding: 14px; color: var(--label); font-size: 11px; text-align: center; }

@media (max-height: 800px) {
  .claude-popover { max-height: 80vh; }
}
```

- [ ] **Step 2: Append RISK-row tone classes for separate Entry/Stop/TP1/TP2 rows**

The existing `.row .v.ok / warn / bad / dim` covers tone variants, but we want the explicit colored numbers in LIVE's restructured RISK rows. Add the tone aliases needed by `Live.jsx` (`.row .v.num` is already used in the renderer; add `.num.red` and `.num.green` so we don't have to thread `tone="red"` and `tone="green"` everywhere). Append:

```css
/* RISK row tones — used by Live.jsx Entry/Stop/TP1/TP2 numbers. */
.row .v.num         { font-variant-numeric: tabular-nums; }
.row .v.num.red     { color: var(--red); }
.row .v.num.green   { color: var(--green); }
.row .v.num.amber   { color: var(--amber); }
```

- [ ] **Step 3: Boot the renderer and visually verify (still old panels)**

Run (in your dev-server terminal if not already up): `npm --prefix app run dev`. There are no consumers of the new CSS yet (they land in later tasks), so this just confirms the file parses and the dev server reloads without error.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "$(cat <<'EOF'
feat(css): CLAUDE popover + restructured RISK row tones

Adds .claude-popover anchored under the new CLAUDE chip in the top
bar — 420px wide, max-height 500px (80vh on screens shorter than
800px), green pulsing 7px dot when chat is active. Header uses the
blue accent so the popover reads as Claude-channel (NEWS = red,
ALERTS = amber, CLAUDE = blue).

Adds .row .v.num.red / .num.green tone aliases so the new LIVE
RISK rows can render Stop in red, TP1/TP2 in green without each
consumer threading explicit tone props.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: CSS — NEWS popover restyle (weekday grouping + impact tints + imminent)

**Files:**
- Modify: `app/renderer/src/app.css` — replace the existing `.news-popover` / `.news-row` section.

- [ ] **Step 1: Replace the existing `.news-popover` block**

In `app/renderer/src/app.css`, find the section starting `.news-popover { position: absolute; ...` (currently ~line 455) and ending at `.news-row .impact.low { ... }`. Replace the whole block with the new weekday-grouped layout:

```css
.news-popover {
  position: absolute;
  top: 100%;
  right: 0;
  width: 460px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-top: 0;
  box-shadow: 0 6px 20px rgba(0,0,0,0.6);
  z-index: 60;
  max-height: 520px;
  overflow-y: auto;
  cursor: default;
}
.news-popover .head {
  padding: 6px 12px; background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
}
.news-popover .head .t { color: var(--red); font-size: 10px; letter-spacing: 0.22em; }
.news-popover .head .sub { color: var(--label); font-size: 9px; letter-spacing: 0.14em; }
.news-popover .head .x { color: var(--label); cursor: pointer; font-size: 13px; }
.news-popover .empty { padding: 14px; color: var(--label); font-size: 11px; }
.news-popover .day-header {
  padding: 4px 12px; background: var(--surface-2);
  color: var(--label); font-size: 10px; letter-spacing: 0.22em;
  border-bottom: 1px solid var(--border);
}
.news-popover .day-header.today {
  color: var(--amber);
}
.news-popover .day-header.today::after {
  content: " · TODAY"; color: var(--amber);
}
.news-row {
  display: grid;
  grid-template-columns: 60px 36px 1fr auto;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px dashed var(--label-dim);
  font-size: 11px;
  align-items: center;
}
.news-row:last-child { border-bottom: 0; }
.news-row.past { opacity: 0.45; }
.news-row.imminent {
  background: rgba(235,187,61,0.06);
  border-left: 3px solid var(--amber);
  padding-left: 9px;
}
.news-row .ts {
  color: var(--label); font-variant-numeric: tabular-nums;
}
.news-row.imminent .ts {
  color: var(--amber); font-weight: 600;
}
.news-row .ccy {
  color: var(--value); font-weight: 600; letter-spacing: 0.06em;
}
.news-row .event { color: var(--value); }
.news-row .event .fc { color: var(--label); font-size: 10.5px; }
.news-row .impact {
  font-size: 9px; letter-spacing: 0.18em;
  padding: 1px 6px; border: 1px solid;
  font-variant-numeric: tabular-nums;
}
.news-row .impact.high   { color: var(--red);   border-color: var(--red); }
.news-row .impact.medium { color: var(--amber); border-color: var(--amber); }

/* NEWS chip — inline countdown beside the count badge when an event is imminent. */
.cell.pop-cell .countdown {
  margin-left: 6px; color: var(--amber);
  font-size: 9.5px; letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 2: Boot the renderer and verify file parses**

The existing `NewsPopover` in `App.jsx` still emits a 4-column grid that matches the new column template, so visually nothing should break in the still-empty popover. Verify the Electron window loads without console error.

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "$(cat <<'EOF'
feat(css): NEWS popover restyle for weekly view

Widens popover to 460px and adds weekday-grouped layout primitives:
.day-header (e.g. "MON · MAY 25"; .today variant gets "· TODAY"
suffix in amber), .news-row.past (opacity 0.45 for events that
already released), .news-row.imminent (amber tint + 3px amber left
border for the next event within 2h).

Adds .cell.pop-cell .countdown for the inline countdown that ticks
beside the NEWS chip count when an event is imminent.

Visually compatible with the existing NewsPopover's 4-column grid —
it just stops being used in the next task when App.jsx is rewritten
to read window.api.calendar.thisWeek().

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Calendar backend — `app/main/calendar.js` + tests

**Files:**
- Create: `app/main/calendar.js`
- Create: `tests/calendar.test.js`

- [ ] **Step 1: Write the failing test file `tests/calendar.test.js`**

```javascript
// tests/calendar.test.js — unit tests for app/main/calendar.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  filterEvents,
  isImminent,
  groupByDay,
  countRemaining,
} from "../app/main/calendar.js";

describe("filterEvents", () => {
  it("keeps USD high + medium events; drops low + non-USD", () => {
    const raw = [
      { country: "USD", impact: "High",   date: "2026-05-27T12:30:00Z", title: "CPI" },
      { country: "USD", impact: "Medium", date: "2026-05-27T14:00:00Z", title: "Consumer Confidence" },
      { country: "USD", impact: "Low",    date: "2026-05-27T15:00:00Z", title: "Crude Inventories" },
      { country: "EUR", impact: "High",   date: "2026-05-27T08:00:00Z", title: "ECB Rate Decision" },
      { country: "GBP", impact: "Medium", date: "2026-05-27T09:30:00Z", title: "GDP" },
    ];
    const kept = filterEvents(raw);
    assert.equal(kept.length, 2);
    assert.equal(kept[0].title, "CPI");
    assert.equal(kept[1].title, "Consumer Confidence");
  });

  it("normalizes the impact strings to lower-case", () => {
    const raw = [{ country: "USD", impact: "High", date: "2026-05-27T12:30:00Z", title: "CPI" }];
    const kept = filterEvents(raw);
    assert.equal(kept[0].impact, "high");
  });

  it("handles empty / null input", () => {
    assert.deepEqual(filterEvents(null), []);
    assert.deepEqual(filterEvents([]), []);
    assert.deepEqual(filterEvents(undefined), []);
  });
});

describe("isImminent", () => {
  it("returns true for an event within 2h in the future", () => {
    const now = new Date("2026-05-27T12:00:00-04:00");
    const ev = { ts: "2026-05-27T13:30:00-04:00" };
    assert.equal(isImminent(ev, now), true);
  });

  it("returns false for an event already past", () => {
    const now = new Date("2026-05-27T12:00:00-04:00");
    const ev = { ts: "2026-05-27T11:00:00-04:00" };
    assert.equal(isImminent(ev, now), false);
  });

  it("returns false for an event more than 2h out", () => {
    const now = new Date("2026-05-27T12:00:00-04:00");
    const ev = { ts: "2026-05-27T16:00:00-04:00" };
    assert.equal(isImminent(ev, now), false);
  });

  it("treats events without ts as not-imminent", () => {
    assert.equal(isImminent({}, new Date()), false);
    assert.equal(isImminent(null, new Date()), false);
  });
});

describe("groupByDay", () => {
  it("groups events by ET weekday + date", () => {
    const events = [
      { ts: "2026-05-26T13:30:00Z", title: "Monday early" }, // 09:30 ET Mon
      { ts: "2026-05-26T22:00:00Z", title: "Monday late"  }, // 18:00 ET Mon
      { ts: "2026-05-27T12:30:00Z", title: "Tuesday"      }, // 08:30 ET Tue
    ];
    const groups = groupByDay(events);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].weekday, "MON");
    assert.equal(groups[0].events.length, 2);
    assert.equal(groups[1].weekday, "TUE");
    assert.equal(groups[1].events.length, 1);
  });

  it("preserves chronological order across days", () => {
    const events = [
      { ts: "2026-05-29T12:00:00Z", title: "Friday" },
      { ts: "2026-05-27T12:00:00Z", title: "Wednesday" },
      { ts: "2026-05-28T12:00:00Z", title: "Thursday" },
    ];
    const groups = groupByDay(events);
    assert.deepEqual(groups.map((g) => g.weekday), ["WED", "THU", "FRI"]);
  });
});

describe("countRemaining", () => {
  it("counts only events strictly after now", () => {
    const now = new Date("2026-05-27T12:00:00-04:00");
    const events = [
      { ts: "2026-05-27T11:00:00-04:00" }, // past
      { ts: "2026-05-27T13:00:00-04:00" }, // future
      { ts: "2026-05-28T09:00:00-04:00" }, // future
    ];
    assert.equal(countRemaining(events, now), 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/calendar.test.js`
Expected: FAIL with `Cannot find module ... calendar.js` or `filterEvents is not a function`.

- [ ] **Step 3: Create `app/main/calendar.js`**

```javascript
// app/main/calendar.js — ForexFactory weekly economic calendar.
//
// Pulls https://nfs.faireconomy.media/ff_calendar_thisweek.json (Faireconomy's
// JSON mirror of the ForexFactory red-folder calendar). Filters down to USD
// high + medium impact events, normalizes the shape, caches to disk at
// state/calendar/this-week.json, and refreshes:
//   - on app boot if the cache is missing or older than 24h
//   - every Monday at 06:00 ET (via the makeScheduledTurn pattern? no — much
//     simpler since there's no LLM turn; we use a plain setTimeout to next
//     Monday 06:00 ET and reschedule from inside the callback).
//
// Public surface:
//   bootstrap({ send })     — call once at app boot
//   readCache()             — returns { events, fetched_at } or { events: [] }
//   refreshNow()            — manual / scheduler-triggered re-fetch
//   filterEvents(raw)       — exported for tests
//   isImminent(ev, now)     — exported for tests + renderer logic
//   groupByDay(events)      — exported for tests + renderer logic
//   countRemaining(...)     — exported for tests + renderer logic

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CACHE_FILE = path.join(REPO_ROOT, "state", "calendar", "this-week.json");

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const STALE_MS = 24 * 60 * 60 * 1000; // 24h
const IMMINENT_MS = 2 * 60 * 60 * 1000; // 2h window for amber highlight

// ── filtering / normalization ───────────────────────────────────────────

// Filter raw ForexFactory rows down to USD high + medium events. Normalizes
// the shape so the renderer sees a stable schema:
//   { ts, currency, event, impact, forecast, previous, released }
//
// The Faireconomy feed uses fields:
//   country  ("USD" / "EUR" / ...)
//   title    ("CPI m/m")
//   date     ISO timestamp (UTC)
//   impact   ("High" / "Medium" / "Low" / "Holiday")
//   forecast (string)
//   previous (string)
export function filterEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && r.country === "USD")
    .filter((r) => {
      const i = String(r.impact || "").toLowerCase();
      return i === "high" || i === "medium";
    })
    .map((r) => ({
      ts: r.date,
      currency: r.country,
      event: r.title,
      impact: String(r.impact).toLowerCase(),
      forecast: r.forecast || "",
      previous: r.previous || "",
      released: false, // back-fill is done in the renderer by comparing to now
    }));
}

// Is an event imminent? True if the event hasn't released yet and starts
// within IMMINENT_MS from `now`.
export function isImminent(ev, now = new Date()) {
  if (!ev || !ev.ts) return false;
  const dt = new Date(ev.ts).getTime();
  if (!Number.isFinite(dt)) return false;
  const dtNow = now.getTime();
  return dt > dtNow && (dt - dtNow) <= IMMINENT_MS;
}

// Count events whose timestamp is strictly after `now`. Used by the topbar
// count badge to show "events remaining this week".
export function countRemaining(events, now = new Date()) {
  if (!Array.isArray(events)) return 0;
  const dtNow = now.getTime();
  return events.filter((e) => {
    const t = new Date(e?.ts).getTime();
    return Number.isFinite(t) && t > dtNow;
  }).length;
}

// Group events by ET weekday. Returns [{ weekday: "MON", date: "MAY 25",
// dateIso: "2026-05-25", events: [...] }] sorted chronologically.
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS   = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function etParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday: (get("weekday") || "").toUpperCase().slice(0, 3),
  };
}

export function groupByDay(events) {
  if (!Array.isArray(events)) return [];
  const byKey = new Map();
  for (const ev of events) {
    if (!ev?.ts) continue;
    const d = new Date(ev.ts);
    if (!Number.isFinite(d.getTime())) continue;
    const p = etParts(d);
    const key = `${p.year}-${p.month}-${p.day}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        weekday: p.weekday,
        date: `${MONTHS[Number(p.month) - 1]} ${Number(p.day)}`,
        dateIso: key,
        events: [],
      });
    }
    byKey.get(key).events.push(ev);
  }
  // Sort by dateIso ascending so days are chronological.
  return [...byKey.values()].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

// ── cache I/O ────────────────────────────────────────────────────────────

async function writeCache(payload) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

export async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { events: [], fetched_at: null };
  }
}

async function cacheAgeMs() {
  try {
    const stat = await fs.stat(CACHE_FILE);
    return Date.now() - stat.mtimeMs;
  } catch {
    return Infinity;
  }
}

// ── fetcher ──────────────────────────────────────────────────────────────

export async function refreshNow({ send } = {}) {
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const events = filterEvents(raw);
    const payload = { events, fetched_at: new Date().toISOString() };
    await writeCache(payload);
    if (send) send("calendar:update", payload);
    // eslint-disable-next-line no-console
    console.log(`[calendar] refreshed ${events.length} USD high/medium events`);
    return payload;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[calendar] refresh failed", err?.message || err);
    return null;
  }
}

// ── scheduler ────────────────────────────────────────────────────────────

let _timer = null;

function msUntilNextMondaySixAmET(now = new Date()) {
  // Walk minute-by-minute (DST-correct because we ask the formatter for
  // ET hour/weekday each probe). Cap at 8d so the loop always terminates.
  const start = now.getTime();
  for (let off = 1; off < 8 * 24 * 60; off += 1) {
    const probe = new Date(start + off * 60_000);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(probe);
    const get = (t) => fmt.find((p) => p.type === t)?.value;
    if (get("weekday") === "Mon" && Number(get("hour")) === 6 && Number(get("minute")) === 0) {
      return Math.floor(probe.getTime() / 60_000) * 60_000 - start;
    }
  }
  return 7 * 24 * 60 * 60_000; // fallback — shouldn't reach
}

function scheduleNext({ send }) {
  if (_timer) clearTimeout(_timer);
  const ms = msUntilNextMondaySixAmET();
  _timer = setTimeout(async () => {
    await refreshNow({ send });
    scheduleNext({ send });
  }, ms);
  // eslint-disable-next-line no-console
  console.log(`[calendar] next Monday 06:00 ET refresh in ${Math.round(ms / 60_000)} min`);
}

// ── boot ─────────────────────────────────────────────────────────────────

export async function bootstrap({ send }) {
  const age = await cacheAgeMs();
  if (age === Infinity || age > STALE_MS) {
    // Fire-and-forget; don't block app boot.
    refreshNow({ send }).catch(() => {});
  }
  scheduleNext({ send });
}

export function stop() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/calendar.test.js`
Expected: PASS — all four `describe` blocks green.

- [ ] **Step 5: Run the full test suite to make sure nothing regressed**

Run: `npm run test:unit` (or `npm test` if test:unit isn't defined — check `package.json` first)
Run: `cat package.json | grep -A 5 '"scripts"'`
Use whichever script runs `node --test tests/**/*.test.js`. Expected: still ≥309 tests passing, plus the new ones from `tests/calendar.test.js`.

- [ ] **Step 6: Commit**

```bash
git add app/main/calendar.js tests/calendar.test.js
git commit -m "$(cat <<'EOF'
feat(calendar): ForexFactory weekly economic calendar service

Pulls https://nfs.faireconomy.media/ff_calendar_thisweek.json on boot
(if cache is missing or >24h old) and every Monday at 06:00 ET.
Filters down to USD high + medium impact events; caches the normalized
payload at state/calendar/this-week.json. Renderer reads via IPC in a
follow-up commit.

Exports four pure helpers covered by tests/calendar.test.js:
- filterEvents — USD high+medium only, normalized shape
- isImminent — within next 2h, not already past
- groupByDay — ET-weekday grouping, chronological
- countRemaining — count of events strictly after now

Public bootstrap({send}) wires the IPC broadcast channel
"calendar:update" so the renderer can react to refreshes without
polling.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire calendar IPC + preload + electron-main bootstrap

**Files:**
- Modify: `app/main/ipc.js:24` (register handler)
- Modify: `app/preload.cjs:209` (add `calendar` bindings)
- Modify: `app/electron-main.js:102` (call `bootstrap`)

- [ ] **Step 1: Register the `calendar:this-week` handler in `app/main/ipc.js`**

Open `app/main/ipc.js`. Near the top of the file (around line 20), add the import:

```javascript
import { readCache as readCalendarCache } from "./calendar.js";
```

Then, inside the `registerIpc(win) { ... }` function — somewhere after the `quote:cache_get` handler near the bottom — register the new handler:

```javascript
  ipcMain.handle("calendar:this-week", async () => {
    try {
      const payload = await readCalendarCache();
      return { ok: true, ...payload };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
```

- [ ] **Step 2: Add `calendar` bindings in `app/preload.cjs`**

Open `app/preload.cjs`. Inside the existing `contextBridge.exposeInMainWorld("api", { ... })` block, just before the closing `});` (line 209), add:

```javascript
  calendar: {
    thisWeek() {
      return ipcRenderer.invoke("calendar:this-week");
    },
    onUpdate(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("calendar:update", listener);
      return () => ipcRenderer.removeListener("calendar:update", listener);
    },
  },
```

- [ ] **Step 3: Bootstrap the calendar service in `app/electron-main.js`**

Open `app/electron-main.js`. Near the top with the other imports (line ~14), add:

```javascript
import { bootstrap as bootstrapCalendar } from "./main/calendar.js";
```

Inside `app.whenReady().then(async () => { ... })`, right after `bootstrapSessionWrap({ send: ipc.send })` (currently around line 107), add:

```javascript
  // ForexFactory weekly calendar: refresh on boot if cache is missing or
  // older than 24h, then every Monday 06:00 ET.
  bootstrapCalendar({ send: ipc.send }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[calendar] bootstrap failed", err);
  });
```

- [ ] **Step 4: Run the existing test suite to make sure imports still work**

Run: `npm run test:unit`
Expected: still all green; no regression.

- [ ] **Step 5: Boot the app and inspect the calendar broadcast**

Run `npm --prefix app run dev` in another terminal if not already running. Open the Electron dev-tools (View → Toggle Developer Tools). In the console, run:

```javascript
const r = await window.api.calendar.thisWeek(); console.log(r);
```

Expected: `{ ok: true, events: [...], fetched_at: "2026-05-27T..." }` (events may be empty briefly on first boot while the fetch is in flight; wait 2-3s and re-run to see the populated array).

- [ ] **Step 6: Commit**

```bash
git add app/main/ipc.js app/preload.cjs app/electron-main.js
git commit -m "$(cat <<'EOF'
feat(ipc): wire calendar service to renderer

Adds:
- ipcMain.handle("calendar:this-week") — returns the cached
  {events, fetched_at} payload
- window.api.calendar.thisWeek() — preload binding for the renderer
- window.api.calendar.onUpdate(cb) — subscribe to refresh broadcasts
- bootstrapCalendar() call in electron-main.js, fires on app ready

Calendar refresh is fire-and-forget on boot; the broadcast channel
("calendar:update") lets the renderer react to Monday 06:00 ET
refreshes without re-polling.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `App.jsx` — drop adapter, drill currentPrice, add CLAUDE popover, rewrite NEWS popover

**Files:**
- Modify: `app/renderer/src/App.jsx`

- [ ] **Step 1: Add `useChat` and `useSymbolCache` imports + remove `useDataAdapter`**

Open `app/renderer/src/App.jsx`. In the imports block, locate the hook imports and add:

```javascript
import { useChat } from "./hooks/useChat.js";
import { useSymbolCache } from "./hooks/useSymbolCache.js";
```

Then locate the entire `useDataAdapter` function (currently spans lines 237-427) and delete it in its entirety. Also remove the `useDataAdapter({ ... })` call inside `App()` (currently line 507).

- [ ] **Step 2: Replace `NewsPopover` and add `useCalendar` hook helper**

Above `NewsPopover` (currently line 75), insert a small `useCalendar` hook that wraps the preload IPC + onUpdate subscription:

```javascript
function useCalendar() {
  const [payload, setPayload] = useState({ events: [], fetched_at: null });
  useEffect(() => {
    let mounted = true;
    window.api?.calendar?.thisWeek?.().then((res) => {
      if (mounted && res?.ok) setPayload({ events: res.events || [], fetched_at: res.fetched_at });
    }).catch(() => {});
    const off = window.api?.calendar?.onUpdate?.((p) => {
      if (mounted) setPayload(p || { events: [] });
    });
    return () => { mounted = false; off?.(); };
  }, []);
  return payload;
}
```

Then replace the existing `NewsPopover` component (the function declaration starting `function NewsPopover({ events, onClose }) { ... }` and its body) with a weekday-grouped + imminent-aware version. The function below pulls directly from a `payload` prop and uses the helpers from `app/main/calendar.js` re-implemented inline (the renderer cannot import from `app/main/`). Keep them in sync with the test exports.

```javascript
// Lightweight ET-weekday grouping; matches app/main/calendar.js groupByDay
// (we duplicate to avoid the renderer importing from main).
function groupByDayET(events) {
  if (!Array.isArray(events)) return [];
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const byKey = new Map();
  for (const ev of events) {
    if (!ev?.ts) continue;
    const d = new Date(ev.ts);
    if (!Number.isFinite(d.getTime())) continue;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    }).formatToParts(d);
    const get = (t) => fmt.find((p) => p.type === t)?.value;
    const key = `${get("year")}-${get("month")}-${get("day")}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        weekday: (get("weekday") || "").toUpperCase().slice(0, 3),
        date: `${MONTHS[Number(get("month"))-1]} ${Number(get("day"))}`,
        dateIso: key,
        events: [],
      });
    }
    byKey.get(key).events.push(ev);
  }
  return [...byKey.values()].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

function todayKeyET(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function fmtTimeET(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " ET";
}

function fmtCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function NewsPopover({ payload, now, onClose }) {
  const events = payload?.events || [];
  const groups = groupByDayET(events);
  const todayKey = todayKeyET(now);
  const dtNow = now.getTime();
  return (
    <div className="news-popover" onClick={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="t">NEWS · THIS WEEK</span>
        <span className="sub">USD HIGH + MED · ET</span>
        <span className="x" onClick={onClose}>×</span>
      </div>
      {events.length === 0 && (
        <div className="empty">no events cached yet — try again in a minute</div>
      )}
      {groups.map((g) => (
        <React.Fragment key={g.dateIso}>
          <div className={"day-header" + (g.dateIso === todayKey ? " today" : "")}>
            {g.weekday} · {g.date}
          </div>
          {g.events.map((e, i) => {
            const dt = new Date(e.ts).getTime();
            const past = dt < dtNow;
            const imminent = !past && (dt - dtNow) <= 2 * 60 * 60 * 1000;
            return (
              <div key={i} className={"news-row" + (past ? " past" : "") + (imminent ? " imminent" : "")}>
                <span className="ts">
                  {imminent ? `IN ${fmtCountdown(dt - dtNow)}` : fmtTimeET(e.ts)}
                </span>
                <span className="ccy">{e.currency}</span>
                <span className="event">
                  {e.event}
                  {e.forecast && (
                    <span className="fc"> · fcst {e.forecast}{e.previous ? ` · prev ${e.previous}` : ""}</span>
                  )}
                </span>
                <span className={"impact " + e.impact}>{e.impact.toUpperCase().slice(0, 3)}</span>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add `ClaudePopover` component**

Insert above the `TopBar` function (currently line 142):

```javascript
function ClaudePopover({ chat, onClose }) {
  const messages = chat?.messages || [];
  return (
    <div className="claude-popover" onClick={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="t">CLAUDE · CONVERSATION</span>
        <span className="x" onClick={onClose}>×</span>
      </div>
      <div className="body">
        {/* Reuses the existing ClaudeFeed component for messages + composer.
            Composer's STOP/RESET buttons + ask-claude input live inside. */}
        <ClaudeFeed
          messages={messages}
          typing={chat?.typing}
          onSubmit={(text) => chat?.send?.(text)}
          onCancel={chat?.typing ? chat?.cancel : null}
          onReset={chat?.reset}
        />
      </div>
    </div>
  );
}
```

Then add to the imports near the top:

```javascript
import { ClaudeFeed } from "./Shared.jsx";
```

Add `ClaudeFeed` to the import list if it isn't already there.

- [ ] **Step 4: Add CLAUDE chip + popover wiring in `TopBar`**

In the existing `TopBar` props destructure (around line 142), add `chat`, `claudeOpen`, `setClaudeOpen` to the args. The new prop list:

```javascript
function TopBar({ mode, setMode, symbol, setSymbol, theme, setTheme,
                  clock,
                  news, newsOpen, setNewsOpen, newsImminent,
                  alerts, alertsOpen, setAlertsOpen, onDisarm,
                  chat, claudeOpen, setClaudeOpen,
                  loopStatus }) {
```

Inside the `.status` div, between the existing ALERTS cell and the LOOP cell, insert the CLAUDE cell:

```javascript
        <div className={"cell pop-cell"}
             onClick={() => setClaudeOpen((o) => !o)}>
          <span className="k">CLAUDE</span>
          <span className={"claude-dot" + (chat?.typing || (chat?.messages?.length > 0) ? " active" : "")} />
          {claudeOpen && (
            <ClaudePopover chat={chat} onClose={() => setClaudeOpen(false)} />
          )}
        </div>
```

Also: update the NEWS cell to use the new payload + imminent counter. Replace the existing NEWS cell with:

```javascript
        <div className={"cell pop-cell" + (news.length > 0 ? " has-news" : "")}
             onClick={() => setNewsOpen((o) => !o)}>
          <span className="k">NEWS</span>
          <span className="count">{news.length}</span>
          {newsImminent && (
            <span className="countdown">{newsImminent}</span>
          )}
          {newsOpen && (
            <NewsPopover payload={{ events: news }} now={new Date()} onClose={() => setNewsOpen(false)} />
          )}
        </div>
```

- [ ] **Step 5: Update `App()` body — wire `useChat` + `useCalendar` + `useSymbolCache` + drill `currentPrice`**

Inside `App()`, after the existing hook calls (current line ~498 has `const clock = useClock(); const lastBar = useLastBar(); ...`), add:

```javascript
  // CLAUDE popover state
  const chat = useChat();
  const [claudeOpen, setClaudeOpen] = useState(false);

  // Calendar — real ForexFactory feed via main process
  const calendarPayload = useCalendar();
  const symbolCache = useSymbolCache(false);

  // currentPrice for the active symbol — used by PREP STEP 2 for above/below grouping
  const currentPrice = symbolCache?.[symbol]?.px ?? null;

  // Imminent NEWS countdown: ticks every 60s so the chip updates in real time
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const remainingEvents = useMemo(() => {
    const t = nowTick.getTime();
    return (calendarPayload.events || []).filter((e) => {
      const dt = new Date(e?.ts).getTime();
      return Number.isFinite(dt) && dt > t;
    });
  }, [calendarPayload.events, nowTick]);
  const newsImminent = useMemo(() => {
    const t = nowTick.getTime();
    const nextEvent = (calendarPayload.events || []).find((e) => {
      const dt = new Date(e?.ts).getTime();
      return Number.isFinite(dt) && dt > t && (dt - t) <= 2 * 60 * 60 * 1000;
    });
    if (!nextEvent) return null;
    const dt = new Date(nextEvent.ts).getTime();
    return `${nextEvent.event} in ${fmtCountdown(dt - t)}`;
  }, [calendarPayload.events, nowTick]);
```

Add `useMemo` to the React import line if it isn't already there:

```javascript
import React, { useState, useEffect, useRef, useMemo } from "react";
```

Delete the now-unused legacy `const [news] = useState([]);` line.

In the TopBar usage (currently around line 522), change `news={news}` to `news={remainingEvents}` and add the new props:

```javascript
      <TopBar mode={mode}
              setMode={(m) => { setMode(m); window.api?.mode?.switch?.(m); }}
              symbol={symbol} setSymbol={setSymbol}
              theme={theme} setTheme={setTheme}
              clock={clock}
              loopStatus={health?.loop}
              news={remainingEvents}
              newsOpen={newsOpen} setNewsOpen={setNewsOpen}
              newsImminent={newsImminent}
              alerts={alerts}
              alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen}
              onDisarm={disarm}
              chat={chat}
              claudeOpen={claudeOpen} setClaudeOpen={setClaudeOpen} />
```

Finally, pass `currentPrice` down to the workstation. The `Workstation` mount currently has no props. Change:

```javascript
      <Workstation />
```

to:

```javascript
      <Workstation symbol={symbol} currentPrice={currentPrice} />
```

- [ ] **Step 6: Boot the app and verify**

Run the dev server (if not already running): `npm --prefix app run dev`. Verify:

1. The Electron window loads without console error.
2. The top bar shows a new `CLAUDE · ●` cell between ALERTS and LOOP. The dot starts dim; clicking the cell opens a 420px popover with the existing chat composer.
3. The NEWS chip shows a count (number of high+medium events left this week). Click it — the popover shows day-grouped rows; today's day-header has a `· TODAY` suffix in amber.
4. Existing PREP/LIVE/REVIEW pages still render (they still consume the legacy `window.GOFNQ_DATA` shape because we deleted the adapter — they'll show `—`/empty until the panel rewrites land in the following tasks). This is expected and OK.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(app): top-bar CLAUDE popover + weekday NEWS + drop adapter

Drops the window.GOFNQ_DATA adapter and the useDataAdapter call.
Panels read hooks directly in the next three commits; this commit
intentionally leaves Prep/Live/Review broken (they still reference
window.GOFNQ_DATA), to be rewritten next.

Adds CLAUDE chip + popover anchored under the chip — 420px wide,
reuses ClaudeFeed for the message stream + composer. Green pulsing
dot signals active chat (typing or any message in history).

Rewrites NEWS popover to consume the real ForexFactory feed via
window.api.calendar.thisWeek() + window.api.calendar.onUpdate.
Groups events by ET weekday; today's day-header shows "· TODAY" in
amber; imminent events (within 2h) get an amber tint + 3px amber
left border + an "IN <countdown>" label. The NEWS chip badge counts
events strictly after now; when the next event is imminent, the
chip shows an inline countdown beside the badge (e.g. "USD CPI
in 1h 23m").

Drills currentPrice (from useSymbolCache) down to PrepWorkstation
so STEP 2 can group key levels into above/below currentPrice.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `Prep.jsx` rewrite + helper extension

**Files:**
- Modify: `app/renderer/src/Prep.jsx` (full rewrite)
- Modify: `app/renderer/src/Prep.helpers.js` (add helpers)
- Modify: `tests/prep-helpers.test.js` (add coverage for new helpers)

- [ ] **Step 1: Extend `Prep.helpers.js` with new pure helpers**

Append to `app/renderer/src/Prep.helpers.js`:

```javascript
// Map a brief.htf_bias array to the four concise rows shown in STEP 1.
// brief.htf_bias is shaped: [{ tf, bias, note }] where tf is "D"|"4H"|"1H"
// and bias is "BULL"|"BEAR"|"NEUTRAL". `brief.primary_draw` and
// `brief.htf_destination` provide the imbalance / draw / reaction rows.
//
// Returns [{ k, v, tip }] — one per slot, missing rows render as "—".
// `tip` is the full strategy doc bullet text used as the title="" tooltip.
export function htfBiasToRowsConcise(brief) {
  const biases = (brief?.htf_bias || []).map((r) => `${r.tf}:${r.bias}`).join(" / ");
  const pd = brief?.primary_draw;
  const draw = brief?.htf_destination;
  const reaction = pd?.state || (pd?.took_liq ? "rejected" : null);
  return [
    {
      k: "Structure",
      v: biases || "—",
      tip: "Structure on D / 4H / 1H — bos / mss direction of each",
    },
    {
      k: "Best imbalances",
      v: pd ? `${pd.kind || pd.type || "?"} ${pd.tf || pd.timeframe || "?"} · took_liq ${pd.took_liq ? "yes" : "no"}` : "—",
      tip: "Best imbalances in that direction (large FVGs / BPRs that took liquidity)",
    },
    {
      k: "Main draw",
      v: draw || "—",
      tip: "Main HTF draw (next major buy-side / sell-side pool)",
    },
    {
      k: "PD reaction",
      v: reaction || "—",
      tip: "Recent reaction off HTF PD array",
    },
  ];
}

// Map brief.overnight_block + brief.key_levels to STEP 2 layout. Returns:
//   { headerRows: [{k, v, tip}], above: [...untaken levels...],
//     below: [...untaken levels...] }
//
// headerRows covers Asia H/L, London H/L, and the verdict line. The level
// partitions are produced by groupLevelsByPrice (already exported).
//
// Names accepted for asia/london in key_levels[].name:
//   AS_H / AS.H / ASIA_H   (any of these means Asia high)
//   AS_L / AS.L / ASIA_L
//   LO_H / LO.H / LONDON_H
//   LO_L / LO.L / LONDON_L
export function overnightHeaderRows(brief) {
  const kl = brief?.key_levels || [];
  const findOne = (names) => kl.find((k) => names.some((n) => k.name === n));
  const ah = findOne(["AS_H", "AS.H", "ASIA_H"]);
  const al = findOne(["AS_L", "AS.L", "ASIA_L"]);
  const lh = findOne(["LO_H", "LO.H", "LONDON_H"]);
  const ll = findOne(["LO_L", "LO.L", "LONDON_L"]);
  const overnight = brief?.overnight_block?.verdict
    || brief?.overnight?.[0]?.note
    || "—";
  return [
    {
      k: "Asia H / L",
      v: ah && al ? `${ah.price} / ${al.price}` : "—",
      tip: "Asia high / low — the overnight range that often gets swept on London or NY open",
    },
    {
      k: "London H / L",
      v: lh && ll ? `${lh.price} / ${ll.price}` : "—",
      tip: "London high / low — set during the 02:00-05:00 ET window",
    },
    {
      k: "Overnight",
      v: overnight,
      tip: "Overnight: extending HTF or consolidating",
    },
  ];
}

// Render the SCENARIOS panel meta — sizing-if-A+ line. Reads sizing_note
// from the brief if present. Returns a plain string for the panel meta.
export function scenariosMeta(brief) {
  const note = brief?.sizing_note;
  if (!note) return "claude proposed";
  return `claude proposed · ${note}`;
}
```

- [ ] **Step 2: Extend `tests/prep-helpers.test.js`**

At the top of `tests/prep-helpers.test.js`, change the import line to include the new functions:

```javascript
import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
  htfBiasToRowsConcise,
  overnightHeaderRows,
  scenariosMeta,
} from "../app/renderer/src/Prep.helpers.js";
```

Append three new `describe` blocks at the bottom of the file:

```javascript
describe("htfBiasToRowsConcise", () => {
  it("formats biases as 'D:BULL / 4H:BULL / 1H:BEAR'", () => {
    const brief = {
      htf_bias: [
        { tf: "D",  bias: "BULL" },
        { tf: "4H", bias: "BULL" },
        { tf: "1H", bias: "BEAR" },
      ],
      htf_destination: "PWH 21450",
      primary_draw: { kind: "FVG", tf: "4H", took_liq: true, state: "ce_tapped" },
    };
    const rows = htfBiasToRowsConcise(brief);
    assert.equal(rows[0].k, "Structure");
    assert.equal(rows[0].v, "D:BULL / 4H:BULL / 1H:BEAR");
    assert.equal(rows[1].k, "Best imbalances");
    assert.match(rows[1].v, /FVG 4H · took_liq yes/);
    assert.equal(rows[2].v, "PWH 21450");
    assert.equal(rows[3].v, "ce_tapped");
  });

  it("renders '—' for missing fields", () => {
    const rows = htfBiasToRowsConcise({});
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.v), ["—", "—", "—", "—"]);
  });

  it("each row carries a strategy-doc tooltip", () => {
    const rows = htfBiasToRowsConcise({});
    for (const r of rows) assert.ok(r.tip && r.tip.length > 10);
  });
});

describe("overnightHeaderRows", () => {
  it("formats Asia H/L and London H/L from key_levels", () => {
    const brief = {
      key_levels: [
        { name: "AS_H", price: 21380 },
        { name: "AS_L", price: 21290 },
        { name: "LO_H", price: 21420 },
        { name: "LO_L", price: 21340 },
      ],
      overnight_block: { verdict: "extending HTF" },
    };
    const rows = overnightHeaderRows(brief);
    assert.equal(rows[0].v, "21380 / 21290");
    assert.equal(rows[1].v, "21420 / 21340");
    assert.equal(rows[2].v, "extending HTF");
  });

  it("accepts dotted-name variants for legacy briefs", () => {
    const brief = { key_levels: [
      { name: "AS.H", price: 100 }, { name: "AS.L", price: 90 },
    ]};
    const rows = overnightHeaderRows(brief);
    assert.equal(rows[0].v, "100 / 90");
  });
});

describe("scenariosMeta", () => {
  it("returns 'claude proposed' when no sizing_note", () => {
    assert.equal(scenariosMeta({}), "claude proposed");
  });

  it("appends sizing_note when present", () => {
    assert.equal(scenariosMeta({ sizing_note: "sizing 2c if A+" }), "claude proposed · sizing 2c if A+");
  });
});
```

- [ ] **Step 3: Run helpers tests and confirm they fail (for the new ones) then pass after step 1's helpers exist**

Run: `node --test tests/prep-helpers.test.js`
Expected: PASS — the existing tests still green, the three new `describe` blocks green because the helpers were added in step 1.

(If you ran step 2 before step 1 by mistake, tests will fail with "import not exported" — fix by completing step 1.)

- [ ] **Step 4: Rewrite `Prep.jsx`**

Replace the entire contents of `app/renderer/src/Prep.jsx` with:

```javascript
// PREP workstation — essentialist re-add (2026-05-27).
// 5 panels: SESSION BRIEF · STEP 1 HTF BIAS · STEP 2 OVERNIGHT + LEVELS ·
// STEP 3 PRICE QUALITY · SCENARIOS. Reads hooks directly.

import React, { useState, useEffect } from "react";
import { Panel, Row, Grade, ScenarioCard } from "./Shared.jsx";
import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
  htfBiasToRowsConcise,
  overnightHeaderRows,
  scenariosMeta,
} from "./Prep.helpers.js";
import { useSessionBrief, formatAge } from "./hooks/useSessionBrief.js";
import { armAlertReal, useAlertStateListener } from "./hooks/useAlerts.js";

// ───────────────────────────────────────────────────────────────────────
// SESSION BRIEF panel — prose blob + status + tabs.
function SessionBriefPanel({ brief, session, ageMs, status, chainStatus, availableSymbols, selectedSymbol, setSelectedSymbol, onRefresh, pillarGrade }) {
  const chain = formatChainChip(chainStatus);
  const meta = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "var(--label)", fontSize: 10 }}>{formatAge(ageMs)}</span>
      {chain.visible && (
        <span className={"pill " + (chain.tone === "stale" ? "red" : "amber")}>{chain.label}</span>
      )}
      <Grade value={pillarGrade || "—"} />
    </span>
  );
  return (
    <Panel title={`SESSION BRIEF · ${(session || "—").toUpperCase()}`} right={meta}>
      <div style={{ color: "var(--prose)", fontSize: 12, lineHeight: 1.6,
                     whiteSpace: "pre-wrap", padding: "6px 0 12px 0" }}>
        {brief?.brief || (status === "running" ? "preparing brief…" : "no brief yet")}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, paddingTop: 8, borderTop: "1px dashed var(--label-dim)" }}>
        {(availableSymbols || []).map((sym) => (
          <span key={sym}
                className={"pill interactive" + (sym === selectedSymbol ? " active" : "")}
                onClick={() => setSelectedSymbol(sym)}>
            {sym.replace(/1!$/, "")}
          </span>
        ))}
        <span className="pill interactive" onClick={onRefresh}>REFRESH</span>
      </div>
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// STEP 1 · HTF BIAS — four concise rows with strategy-doc tooltips.
function Step1Panel({ brief }) {
  const rows = htfBiasToRowsConcise(brief);
  return (
    <Panel title="STEP 1 · HTF BIAS" meta="D / 4H / 1H">
      {rows.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className="v">{r.v}</span>
        </div>
      ))}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// STEP 2 · OVERNIGHT + LEVELS — Asia/London + sub-sections of untaken levels.
function LevelBlock({ level, armed, fired, onArm, onDisarm }) {
  const isArmed = armed?.has(level.price);
  const isFired = fired?.has(level.price);
  const bell = isFired ? "◉" : isArmed ? "●" : "○";
  const bellTitle = isFired ? "alert fired" : isArmed ? "alert armed — click to disarm" : "click to arm alert";
  const toggle = () => {
    if (isArmed && onDisarm) return onDisarm(level);
    if (!isArmed && onArm) return onArm(level);
  };
  return (
    <div className="row" style={{ gridTemplateColumns: "160px 1fr auto" }}>
      <span className="k">{level.name}</span>
      <span className="v">
        {level.price}
        {level.state && (
          <span className="pill dim" style={{ marginLeft: 8 }}>{level.state.toUpperCase()}</span>
        )}
      </span>
      <span title={bellTitle}
            onClick={toggle}
            style={{ cursor: "pointer", color: isFired ? "var(--amber)" : isArmed ? "var(--green)" : "var(--label)", fontSize: 14 }}>
        {bell}
      </span>
    </div>
  );
}

function Step2Panel({ brief, currentPrice, armed, fired, onArm, onDisarm }) {
  const rows = overnightHeaderRows(brief);
  // Filter to untaken levels only; the section is "untaken liquidity".
  const untaken = (brief?.key_levels || []).filter((l) => l.state === "untaken" || !l.state);
  const { above, below } = groupLevelsByPrice(untaken, currentPrice);
  return (
    <Panel title="STEP 2 · OVERNIGHT + LEVELS" meta="Asia + London">
      {rows.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className="v">{r.v}</span>
        </div>
      ))}
      {above && above.length > 0 && (
        <>
          <div className="sect-hd" style={{ marginTop: 12 }}>UNTAKEN ABOVE</div>
          {above.map((lv) => (
            <LevelBlock key={lv.name} level={lv}
                        armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
          ))}
        </>
      )}
      {below && below.length > 0 && (
        <>
          <div className="sect-hd" style={{ marginTop: 12 }}>UNTAKEN BELOW</div>
          {below.map((lv) => (
            <LevelBlock key={lv.name} level={lv}
                        armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
          ))}
        </>
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// STEP 3 · PRICE QUALITY — three concise rows wired to brief.pillars[1].
function Step3Panel({ brief }) {
  const pillar2 = selectPillar(brief?.pillars, /price.*action|quality/i);
  const rows = pillar2ToRows(pillar2);
  const tips = {
    "3h range": "3-hour range acceptable (not tiny / choppy)",
    "4H/1H displacement": "4H / 1H candles show real displacement and decent PD array size",
    "15m/5m candles": "15m / 5m candles mainly engulfing, not doji / wick dominated",
  };
  return (
    <Panel title="STEP 3 · PRICE QUALITY">
      {rows.map((r) => (
        <div className="row" key={r.k} title={tips[r.k] || ""}>
          <span className="k">{r.k}</span>
          <span className={"v " + (r.tone || "")}>{r.v}</span>
        </div>
      ))}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SCENARIOS panel.
function ScenariosPanel({ brief }) {
  const scenarios = brief?.scenarios || [];
  return (
    <Panel title="SCENARIOS · IF / THEN" meta={scenariosMeta(brief)}>
      {scenarios.length === 0 ? (
        <div style={{ color: "var(--label)", padding: "8px 0", fontSize: 11 }}>
          no scenarios yet — Claude will propose once HTF + pillars are read
        </div>
      ) : (
        scenarios.map((s) => <ScenarioCard key={s.id || s.condition} scenario={s} />)
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
function PrepWorkstation({ symbol, currentPrice }) {
  const {
    brief,
    availableSymbols, selectedSymbol, setSelectedSymbol,
    session, ageMs, status, refresh,
  } = useSessionBrief();

  // Auto-select the App symbol when the user switches symbols at the top.
  useEffect(() => {
    if (symbol && availableSymbols.includes(symbol)) setSelectedSymbol(symbol);
  }, [symbol, availableSymbols, setSelectedSymbol]);

  // Alert armed / fired state — wire the TV alert ring so the bell icons in
  // STEP 2 reflect the actual armed/fired set.
  const [armed, setArmed] = useState(new Set());
  const [fired, setFired] = useState(new Set());
  useAlertStateListener((ev) => {
    setArmed(new Set((ev?.armed || []).map((a) => a.price)));
  });

  const onArm = async (level) => {
    try {
      await armAlertReal({ price: level.price, label: level.name });
      setArmed((s) => new Set([...s, level.price]));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[prep] arm failed", err?.message || err);
    }
  };
  const onDisarm = async (level) => {
    // Disarm is a re-arm with empty label? In the current alerts wiring
    // disarm is by id; we don't have it here. Easiest correct behavior:
    // pop the price from the renderer's set; the main process resyncs the
    // armed set on next alerts:state push.
    setArmed((s) => {
      const next = new Set(s);
      next.delete(level.price);
      return next;
    });
  };

  const pillarGrade = brief?.pillar_grade;
  const chainStatus = brief?.chain_status;

  return (
    <div className="work-scroll">
      <SessionBriefPanel
        brief={brief}
        session={session}
        ageMs={ageMs}
        status={status}
        chainStatus={chainStatus}
        availableSymbols={availableSymbols}
        selectedSymbol={selectedSymbol}
        setSelectedSymbol={setSelectedSymbol}
        onRefresh={refresh}
        pillarGrade={pillarGrade}
      />
      <Step1Panel brief={brief} />
      <Step2Panel brief={brief} currentPrice={currentPrice}
                  armed={armed} fired={fired}
                  onArm={onArm} onDisarm={onDisarm} />
      <Step3Panel brief={brief} />
      <ScenariosPanel brief={brief} />
    </div>
  );
}

export { PrepWorkstation };
```

- [ ] **Step 5: Boot the app and verify PREP**

Run `npm --prefix app run dev`. Switch to PREP. Verify (with a real brief on disk for today's session, or with the brief in a known fixture state):

1. SESSION BRIEF shows the prose blob.
2. Header right side: `<age>` text · (chain chip if non-clean) · grade pill (`B`/`A+`/`—`).
3. Footer right: `[ MNQ ]` and `[ MES ]` tabs (whichever the brief has). Clicking switches the displayed brief. Active tab is amber-tinted. `[ REFRESH ]` triggers `useSessionBrief.refresh()`.
4. STEP 1 shows 4 rows with concise labels. Hovering each row label shows the full strategy doc bullet text.
5. STEP 2 shows Asia H/L, London H/L, Overnight. Below: `UNTAKEN ABOVE` and `UNTAKEN BELOW` sections with bell icons. Clicking the bell of an untaken level should call `armAlertReal` (check the console + the ALERTS chip count).
6. STEP 3 shows 3 rows: `3h range`, `4H/1H displacement`, `15m/5m candles`. Tooltips on each.
7. SCENARIOS shows ScenarioCard rows. Panel meta line shows `claude proposed · sizing 2c if A+` (if `brief.sizing_note` is set).

If no brief is on disk yet, verify the empty states render cleanly (no console errors).

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:unit`
Expected: still ≥309 passing + the new ones added in step 2. Total should now be 312+.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/Prep.jsx app/renderer/src/Prep.helpers.js tests/prep-helpers.test.js
git commit -m "$(cat <<'EOF'
feat(prep): essentialist 5-panel layout with MNQ/MES tabs

Replaces the reference 1:1 PREP body (which read from
window.GOFNQ_DATA) with five real-data panels:

1. SESSION BRIEF — prose blob, age + chain chip + grade in header,
   MNQ/MES tabs + REFRESH button in footer (all using unified .pill
   geometry). Switching tabs flips useSessionBrief's selectedSymbol.
2. STEP 1 · HTF BIAS — 4 concise rows (Structure, Best imbalances,
   Main draw, PD reaction). Full strategy doc bullet text lives in
   title="" tooltips on each row label.
3. STEP 2 · OVERNIGHT + LEVELS — Asia H/L + London H/L + Overnight,
   then UNTAKEN ABOVE / UNTAKEN BELOW sub-sections grouped by
   currentPrice (drilled in from App.jsx via useSymbolCache). Each
   level has a ○/●/◉ bell that arms/disarms a TV alert via
   armAlertReal.
4. STEP 3 · PRICE QUALITY — three concise rows wired to brief.pillars
   via selectPillar + pillar2ToRows.
5. SCENARIOS · IF / THEN — ScenarioCards from brief.scenarios; sizing
   note lives in the panel meta.

Cut entirely (per essentialist spec): STATUS STRIP (moved into header),
PRE-SESSION GRADE (moved into header), CLAUDE PLAN, PRIMARY HTF DRAW
(it's already a row in STEP 1), PRICE ALERTS (bells in STEP 2 do this),
RECAP.

Prep.helpers.js gains three exports — htfBiasToRowsConcise,
overnightHeaderRows, scenariosMeta — covered by new test cases.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `Live.jsx` rewrite — sub-state routed, RISK rows broken

**Files:**
- Modify: `app/renderer/src/Live.jsx` (full rewrite)

- [ ] **Step 1: Rewrite `Live.jsx`**

Replace the entire contents of `app/renderer/src/Live.jsx` with:

```javascript
// LIVE workstation — essentialist re-add (2026-05-27).
// Sub-state routed: InTrade > EntryHunt > OpenReaction (default).
// CLAUDE conversation lives in the global top-bar popover — no inline chat
// here. RISK rows are broken into Entry / Stop (red) / TP1 / TP2 (green)
// for color-coded scannability.

import React from "react";
import { Panel, Row, Grade } from "./Shared.jsx";
import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  latestBarReadMessage,
} from "./Live.helpers.js";
import { useTrades } from "./hooks/useTrades.js";
import { useActiveSetup } from "./hooks/useActiveSetup.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";
import { useLastBar } from "./hooks/useLastBar.js";
import { useHealth } from "./hooks/useHealth.js";
import { useChat } from "./hooks/useChat.js";

// ── Loop banner (only when unhealthy) ────────────────────────────────
function LoopBanner({ status }) {
  if (status === "healthy" || !status) return null;
  const tone = status === "down" ? "red" : "amber";
  const label = status === "down" ? "DETECTOR DOWN" : "DETECTOR STALE";
  return (
    <div style={{
      padding: "6px 16px",
      borderBottom: "1px solid var(--border)",
      background: "var(--surface-2)",
      color: tone === "red" ? "var(--red)" : "var(--amber)",
      fontSize: 10.5, letterSpacing: ".22em",
    }}>
      {label} · bar-close polling is paused — fix in System page
    </div>
  );
}

// ── Sub-state 1: OPEN REACTION (Step 4) ──────────────────────────────
function OpenReactionView({ openReaction, brief }) {
  const latest = openReaction?.latest;
  const window = latest?.minutes_into_phase != null
    ? `+${latest.minutes_into_phase}m`
    : "—";
  const reaction = latest?.bias_direction
    ? `${latest.bias_direction}${latest.watching ? " @ " + latest.watching : ""}`
    : "—";
  const outcome = brief?.pillar2_verdict === "good" ? "aligned"
                : brief?.pillar2_verdict === "poor" ? "conflicted"
                : "—";
  const liq = (brief?.key_levels || []).slice(0, 12);
  return (
    <div className="work-scroll">
      <Panel title="STEP 4 · NY OPEN LTF BIAS" meta={window}>
        <Row k="Window"   v={window} />
        <Row k="Reaction" v={reaction}
             tone={latest?.bias_direction === "bullish" ? "ok"
                 : latest?.bias_direction === "bearish" ? "warn" : ""} />
        <Row k="Outcome"  v={outcome}
             tone={outcome === "aligned" ? "ok" : outcome === "conflicted" ? "bad" : ""} />
        {liq.length > 0 && (
          <>
            <div className="sect-hd" style={{ marginTop: 12 }}>SESSION LIQUIDITY</div>
            {liq.map((lv) => (
              <Row key={lv.name}
                   k={lv.name}
                   v={`${lv.price} · ${lv.state || "—"}`}
                   tone={lv.state === "untaken" ? "" : "dim"} />
            ))}
          </>
        )}
      </Panel>
    </div>
  );
}

// ── Sub-state 2: ENTRY HUNT (Step 5 + Step 6) ────────────────────────
function EntryHuntView({ activeSetup, noTradeReason, onAccept, onReject }) {
  if (!activeSetup) {
    return (
      <div className="work-scroll">
        <Panel title="ENTRY CANDIDATE">
          <div style={{ color: "var(--label)", padding: "8px 0", fontSize: 11 }}>
            {noTradeReason ? `no-trade · ${noTradeReason}` : "waiting for setup"}
          </div>
        </Panel>
      </div>
    );
  }
  const pillar3 = selectPillar3(activeSetup.pillar_breakdown);
  const confRows = pillar3ToConfirmationRows(pillar3);
  // Map full label -> concise label + tooltip
  const conciseLabel = {
    "PD-array tap": ["PD tap", "PD-array tap — wick touch of an HTF FVG/BPR/OB"],
    "1m close past structure": ["1m close", "1m close past structure — first LTF acknowledgement"],
    "5m close past structure": ["5m close", "5m close past structure — confirmed displacement"],
    "Clean delivery": ["Delivery", "Clean delivery (no wick rejection)"],
  };
  const grade = activeSetup.grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  return (
    <div className="work-scroll">
      <Panel title="ENTRY CANDIDATE"
             right={
               <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                 <span className={"pill " + gradeTone}>{grade}</span>
                 <span style={{ color: "var(--label)", fontSize: 10 }}>
                   {activeSetup.model || "—"} · {(activeSetup.side || "—").toUpperCase()}
                 </span>
               </span>}>
        <div className="sect-hd">CONFIRMATION</div>
        {confRows.map((r) => {
          const [label, tip] = conciseLabel[r.label] || [r.label, ""];
          const tone = r.status === "pass" ? "ok"
                      : r.status === "weak" ? "warn"
                      : r.status === "fail" ? "bad" : "dim";
          return (
            <div className="row" key={r.label} title={tip}>
              <span className="k">{label}</span>
              <span className={"v " + tone}>{r.status === "pass" ? "yes" : (r.status === "missing" ? "—" : r.status)}</span>
            </div>
          );
        })}

        <div className="sect-hd" style={{ marginTop: 12 }}>RISK</div>
        <Row k="Entry" v={<span className="v num">{activeSetup.entry ?? "—"}</span>} />
        <Row k="Stop"  v={<span className="v num red">{activeSetup.stop ?? "—"}</span>} />
        <Row k="TP1"   v={<span className="v num green">{activeSetup.tp1 ?? "—"}</span>} />
        <Row k="TP2"   v={<span className="v num green">{activeSetup.tp2 ?? "—"}</span>} />
        <Row k="R : R" v={activeSetup.rr ?? "—"}
             tone={activeSetup.rr >= 1.5 ? "ok" : activeSetup.rr != null ? "warn" : ""} />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
          <span className="pill interactive red"  onClick={() => onReject?.(activeSetup)}>REJECT</span>
          <span className="pill interactive green" onClick={() => onAccept?.(activeSetup)}>ACCEPT</span>
        </div>
      </Panel>
    </div>
  );
}

// ── Sub-state 3: IN-TRADE ─────────────────────────────────────────────
function InTradeView({ activeTrade, lastBar, chat }) {
  if (!activeTrade) return <div className="stub">[ no active trade ]</div>;
  const grid = liveGridFromTrade(activeTrade, lastBar?.close);
  const barRead = latestBarReadMessage(chat?.messages || []);
  const grade = activeTrade.grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  return (
    <div className="work-scroll">
      <Panel title="IN-TRADE"
             right={
               <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                 <span style={{ color: "var(--value)", fontSize: 11 }}>#{activeTrade.id}</span>
                 <span className={"pill " + (activeTrade.side === "long" ? "green" : "red")}>
                   {(activeTrade.side || "").toUpperCase()}
                 </span>
                 <span className={"pill " + gradeTone}>{grade}</span>
                 <span style={{ color: "var(--label)", fontSize: 10 }}>{activeTrade.model || ""}</span>
               </span>}>
        <div className="sect-hd">RISK PLAN</div>
        <Row k="Entry" v={<span className="v num">{activeTrade.entry}</span>} />
        <Row k="Stop"  v={<span className="v num red">{activeTrade.stop}{activeTrade.tp1_hit ? " · BE" : ""}</span>} />
        <Row k="TP1"   v={<span className="v num green">{activeTrade.tp1}</span>} />
        <Row k="TP2"   v={<span className="v num green">{activeTrade.tp2}</span>} />
        <Row k="Size"  v={activeTrade.size?.label || (activeTrade.size?.contracts ? `${activeTrade.size.contracts}c` : "—")} />

        <div className="sect-hd" style={{ marginTop: 12 }}>LIVE</div>
        <div className="live-grid">
          <div className="lcell"><span className="k">PRICE</span><span className={"v " + grid.price.tone}>{grid.price.v}</span><span className="sub">{grid.price.sub}</span></div>
          <div className="lcell"><span className="k">P&amp;L</span><span className={"v " + grid.pnl.tone}>{grid.pnl.v}</span><span className="sub">{grid.pnl.sub}</span></div>
          <div className="lcell"><span className="k">TO TP1</span><span className={"v " + grid.toTp1.tone}>{grid.toTp1.v}</span><span className="sub">{grid.toTp1.sub}</span></div>
          <div className="lcell"><span className="k">TO STOP</span><span className={"v " + grid.toStop.tone}>{grid.toStop.v}</span><span className="sub">{grid.toStop.sub}</span></div>
        </div>

        <div className="sect-hd" style={{ marginTop: 12 }}>ACTIONS</div>
        <div className="trade-actions">
          <span className="pill interactive amber">▸ TV STOP</span>
          <span className="pill interactive amber">▸ TV SCALE</span>
          <span className="pill interactive red">▸ TV CLOSE</span>
        </div>

        {barRead && (
          <>
            <div className="sect-hd" style={{ marginTop: 12 }}>BRAIN</div>
            <div className="trade-narration" dangerouslySetInnerHTML={{ __html: barRead.body }} />
          </>
        )}
      </Panel>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────
function LiveWorkstation() {
  const health = useHealth();
  const { activeTrade, accept, reject } = useTrades();
  const { activeSetup, noTradeReason } = useActiveSetup();
  const openReaction = useOpenReaction();
  const lastBar = useLastBar();
  const chat = useChat();
  // NOTE: useChat is also used by App.jsx for the popover. Both instances
  // share IPC subscriptions; messages converge because they listen to the
  // same chunks. We accept the cost — duplicated subscriptions but no
  // duplicated state since each hook owns its own setState.
  // brief is used by OpenReactionView for the verdict + liquidity table.
  // Read it via useSessionBrief in the parent so the sub-state component
  // doesn't need its own subscription.
  // (Imported lazily to avoid circular-ish load when LIVE is the first
  // page mounted; not strictly necessary but harmless.)
  const { brief } = useSessionBriefLite();

  // Sub-state precedence
  const subState = activeTrade ? "in-trade"
                 : activeSetup ? "entry-hunt"
                 : "open-reaction";

  let body;
  if (subState === "in-trade") {
    body = <InTradeView activeTrade={activeTrade} lastBar={lastBar} chat={chat} />;
  } else if (subState === "entry-hunt") {
    body = <EntryHuntView activeSetup={activeSetup} noTradeReason={noTradeReason}
                          onAccept={accept} onReject={(s) => reject(s.id, "")} />;
  } else {
    body = <OpenReactionView openReaction={openReaction} brief={brief} />;
  }

  return (
    <>
      <LoopBanner status={health?.loop} />
      {body}
    </>
  );
}

// Tiny wrapper so we can import useSessionBrief lazily without a top-level
// import here (Live.jsx didn't import it pre-essentialist; matches existing
// import discipline).
import { useSessionBrief } from "./hooks/useSessionBrief.js";
function useSessionBriefLite() {
  const { brief } = useSessionBrief();
  return { brief };
}

export { OpenReactionView, EntryHuntView, InTradeView, LiveWorkstation };
```

- [ ] **Step 2: Boot the app and verify LIVE**

Run `npm --prefix app run dev` (or refresh if already running). Switch to LIVE.

Verify (depending on session state):

- **OpenReaction** (default, no active setup, no active trade): STEP 4 panel with Window/Reaction/Outcome + nested SESSION LIQUIDITY list of key levels.
- **EntryHunt** (when an `activeSetup` exists; you may need to wait for a session bar-close or test against a paused brief that already has one): ENTRY CANDIDATE panel with concise CONFIRMATION labels (`PD tap`, `1m close`, `5m close`, `Delivery` — hover for full strategy text); RISK section has separate rows for Entry/Stop/TP1/TP2 with Stop in red and TP1/TP2 in green; ACCEPT + REJECT buttons (red + green pills) at the bottom right.
- **InTrade** (when you accept a setup or trades.jsonl already has an open trade): IN-TRADE panel with grade/side pills in header, RISK PLAN rows, 4-cell LIVE GRID, TV action pills, and BRAIN narration block at the bottom if there's a recent bar-read in chat.
- **LoopBanner** (if `health.loop === "stale"` or `"down"`): banner appears above the sub-state.

If you don't have data to exercise all three sub-states naturally, you can verify the routing logic by:

```javascript
// In dev-tools console:
window.api.setups.current().then(console.log)   // shape of activeSetup
window.api.trade.list().then(console.log)       // open trades
```

- [ ] **Step 3: Run the full test suite (live-helpers tests still pass)**

Run: `npm run test:unit`
Expected: still all green. We didn't modify `Live.helpers.js` or its tests; the rewrite reuses the existing pure helpers.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/Live.jsx
git commit -m "$(cat <<'EOF'
feat(live): essentialist sub-state layout with broken RISK rows

Replaces the reference 1:1 LIVE body (which read from window.GOFNQ_DATA)
with three sub-state views and a global LoopBanner:

- OpenReactionView (default) — STEP 4 panel with Window/Reaction/Outcome
  + nested SESSION LIQUIDITY list.
- EntryHuntView (activeSetup present) — ENTRY CANDIDATE panel with
  concise CONFIRMATION labels (PD tap / 1m close / 5m close / Delivery)
  carrying strategy-doc tooltips; RISK rows broken into separate
  Entry/Stop(red)/TP1+TP2(green) so the eye hits the numbers faster;
  ACCEPT + REJECT pills at the bottom.
- InTradeView (activeTrade present) — IN-TRADE panel with grade/side
  pills in header, RISK PLAN rows with same color discipline,
  4-cell LIVE GRID, TV action pills (toast-only — no broker writes),
  BRAIN narration block when chat has a recent bar-read.
- LoopBanner appears above any sub-state when health.loop is
  "stale" or "down".

Cut entirely: inline ClaudeFeed (moved to top-bar popover), setup
history (REVIEW handles past), rejected list (ditto), pillar
alignment panel (covered by CONFIRMATION rows), Session P&L line
(visible from trade state), queued-behind hint.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `Review.jsx` rewrite — 3-panel essentialist

**Files:**
- Modify: `app/renderer/src/Review.jsx` (full rewrite)

- [ ] **Step 1: Rewrite `Review.jsx`**

Replace the entire contents of `app/renderer/src/Review.jsx` with:

```javascript
// REVIEW workstation — essentialist re-add (2026-05-27).
// 3 panels: SESSION JOURNAL · CANDIDATE LEDGER · SESSION LIBRARY.
// Reads useReview() directly. CANDIDATE LEDGER rows are clickable to
// expand into a full TradeCard for confirmed/accepted rows.

import React, { useState } from "react";
import { Panel, Row, Grade, TradeCard } from "./Shared.jsx";
import {
  buildLedger,
  deriveLedgerState,
  deriveLedgerReason,
  formatGradeShort,
} from "./Review.helpers.js";
import { useReview } from "./hooks/useReview.js";

// ── SESSION JOURNAL ──────────────────────────────────────────────────
function SessionJournalPanel({ journal, onExport }) {
  if (!journal) {
    return (
      <Panel title="SESSION JOURNAL" meta="—">
        <div style={{ color: "var(--label)", padding: "8px 0", fontSize: 11 }}>
          no journal yet for today's active session
        </div>
      </Panel>
    );
  }
  const grade = journal.brief?.pillar_grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  const meta = (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className={"pill " + gradeTone}>{grade}</span>
      <span className="pill interactive" onClick={onExport}>EXPORT JSON</span>
    </span>
  );
  return (
    <Panel title={`SESSION JOURNAL · ${(journal.session || "").toUpperCase()} · ${journal.date}`} right={meta}>
      <div style={{ color: "var(--prose)", fontSize: 12, lineHeight: 1.6,
                     whiteSpace: "pre-wrap", padding: "6px 0" }}>
        {journal.summary?.bias_picture || journal.brief?.brief || "no summary yet"}
      </div>
    </Panel>
  );
}

// ── CANDIDATE LEDGER ─────────────────────────────────────────────────
function LedgerRow({ row, expanded, onToggle }) {
  const setup = row.setup;
  const tone = row.state?.tone || "dim";
  const cycle = setup.ts
    ? new Date(setup.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" })
    : "—";
  const side = (setup.direction || setup.side || "").toUpperCase();
  const grade = formatGradeShort(setup.grade);
  const clickable = row.expandable;
  return (
    <>
      <div className="cand-row"
           style={{ cursor: clickable ? "pointer" : "default" }}
           onClick={clickable ? onToggle : undefined}>
        <span className="cyc">{cycle}</span>
        <span className="mod">
          <span className="pill dim" style={{ marginRight: 6 }}>{grade}</span>
          {setup.model || "—"}
        </span>
        <span className={"side " + (setup.direction === "long" || setup.side === "long" ? "l" : "s")}>
          {side}
        </span>
        <span className={"pill " + tone}>{row.state?.label || "—"}</span>
        <span className="reason">{row.reason || ""}</span>
      </div>
      {expanded && row.trade && (
        <div style={{ padding: "6px 0 12px 0" }}>
          <TradeCard trade={ledgerTradeToTradeCard(row)} showSnapshot={false} />
        </div>
      )}
    </>
  );
}

// Map a folded ledger row into the shape TradeCard expects (it was designed
// for the older review schema). Defensive — fall back to "—" for missing fields.
function ledgerTradeToTradeCard(row) {
  const t = row.trade || {};
  const s = row.setup || {};
  return {
    id: s.id || t.id || "—",
    setupId: s.id,
    grade: s.grade || "—",
    side: t.side || s.direction || s.side || "long",
    model: s.model || t.model || "—",
    taken: s.ts ? new Date(s.ts).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—",
    entry: s.entry ?? t.entry ?? "—",
    stop:  s.stop  ?? t.stop  ?? "—",
    tp1:   s.tp1   ?? t.tp1   ?? "—",
    tp2:   s.tp2   ?? t.tp2   ?? "—",
    size:  t.size?.label || (t.size?.contracts ? `${t.size.contracts}c` : "—"),
    risk:  t.size?.risk_dollars ? `$${t.size.risk_dollars}` : "—",
    rr:    s.rr ?? "—",
    pnl:   t.r_realized != null ? `${t.r_realized > 0 ? "+" : ""}${t.r_realized} R` : "—",
    pnlPositive: t.r_realized > 0,
    pnlNegative: t.r_realized < 0,
    outcome:      (t.outcome || "").toLowerCase(),
    outcomeLabel: t.outcome || "OPEN",
    statusNote:   row.state?.label || "",
  };
}

function CandidateLedgerPanel({ ledger }) {
  const [expanded, setExpanded] = useState(new Set());
  const toggle = (id) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <Panel title="CANDIDATE LEDGER"
           meta={`${ledger.length} candidate${ledger.length === 1 ? "" : "s"} · click confirmed rows to expand`}>
      {ledger.length === 0 && (
        <Row k="—" v="no candidates this session" tone="dim" />
      )}
      {ledger.map((row) => {
        const id = row.setup?.id || row.setup?.ts || Math.random();
        return (
          <LedgerRow key={id}
                     row={row}
                     expanded={expanded.has(id)}
                     onToggle={() => toggle(id)} />
        );
      })}
    </Panel>
  );
}

// ── SESSION LIBRARY ──────────────────────────────────────────────────
function SessionLibraryPanel({ library, currentDate, currentSession, onPick }) {
  return (
    <Panel title="SESSION LIBRARY" meta="recent · click to load">
      <table className="lib-table">
        <thead>
          <tr>
            <th>DATE</th><th>SESSION</th><th>GRADE</th>
            <th className="r">CANDS</th><th className="r">CONFIRMED</th>
          </tr>
        </thead>
        <tbody>
          {library.length === 0 && (
            <tr><td colSpan={5} style={{ color: "var(--label)", padding: 14 }}>no sessions yet</td></tr>
          )}
          {library.map((r, i) => {
            const isCur = r.date === currentDate && r.session === currentSession;
            return (
              <tr key={i} className={isCur ? "cur" : ""}
                  style={{ cursor: "pointer" }}
                  onClick={() => onPick?.(r)}>
                <td>{r.date}</td>
                <td className="dim">{r.session}</td>
                <td>{r.grade || "—"}</td>
                <td className="r">{r.stats?.setups ?? "—"}</td>
                <td className="r">{r.stats?.accepted ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

// ── Workstation ──────────────────────────────────────────────────────
function ReviewWorkstation() {
  const [picked, setPicked] = useState({});
  const { journal, library } = useReview(picked);
  const ledger = React.useMemo(
    () => buildLedger(journal?.setups || [], journal?.trades || []),
    [journal],
  );
  const onExport = () => {
    if (!journal) return;
    window.api?.review?.exportSession?.(journal.date, journal.session).then((res) => {
      if (res?.ok) {
        // eslint-disable-next-line no-console
        console.log("[review] exported to", res.path);
      }
    }).catch(() => {});
  };
  const onPickLibrary = (row) => {
    if (!row?.date || !row?.session) return;
    setPicked({ date: row.date, session: row.session });
  };
  return (
    <div className="work-scroll">
      <SessionJournalPanel journal={journal} onExport={onExport} />
      <CandidateLedgerPanel ledger={ledger} />
      <SessionLibraryPanel library={library}
                           currentDate={journal?.date}
                           currentSession={journal?.session}
                           onPick={onPickLibrary} />
    </div>
  );
}

export { ReviewWorkstation };
```

- [ ] **Step 2: Boot the app and verify REVIEW**

Run `npm --prefix app run dev`. Switch to REVIEW.

Verify:

1. **SESSION JOURNAL** — title shows `<session> · <date>`. Header right: grade pill + `[ EXPORT JSON ]` pill. Body shows `summary.bias_picture` (or `brief.brief` as fallback) as prose.
2. **CANDIDATE LEDGER** — meta line: `<N> candidates · click confirmed rows to expand`. Rows show: time HH:MM ET · grade pill + model · side pill (L/S) · state pill · short reason.
3. Clicking a confirmed/accepted row expands to an inline TradeCard at the SAME width as the row above (no negative margins, no wider). Click again to collapse.
4. **SESSION LIBRARY** — table of recent sessions. Current session row has `.cur` highlight (amber tint). Clicking a row updates `picked` and `useReview` re-fetches the journal for that date+session.
5. EXPORT JSON triggers `window.api.review.exportSession`; check the dev-tools console for the saved path (it writes to `~/Downloads/session-<date>-<session>.json`).

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:unit`
Expected: still ≥309 + 3 (calendar) + 3 (prep helper additions) = 315+ tests passing.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/Review.jsx
git commit -m "$(cat <<'EOF'
feat(review): essentialist 3-panel layout

Replaces the reference 1:1 REVIEW body (which read from
window.GOFNQ_DATA) with three panels:

1. SESSION JOURNAL — title "<session> · <date>", header right has the
   grade pill + EXPORT JSON action pill. Body is summary.bias_picture
   prose (falls back to brief.brief). Stats grid cut — pill colors in
   the ledger row already encode the counts visually.
2. CANDIDATE LEDGER — chronological rows from buildLedger (existing
   helper). Each row shows ts/grade/side/model/state pill/reason.
   Accepted/confirmed rows are clickable; clicking expands to an
   inline TradeCard at the same width as the row above (no negative
   margin).
3. SESSION LIBRARY — table of recent sessions, clickable rows that
   re-fetch the journal for that date+session via useReview.

Cut entirely: BLOCKED MOMENTS placeholder (we don't track blockers
separately yet), WATCH NEXT SESSION (lives in summary prose), AGENT
STATE panel (moves to a future System util-page revision).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Manual sanity + dev-server smoke + full test pass

**Files:** (verification only — no commits unless a fix is needed)

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test:unit`
Expected: ≥315 passing. No failures.

- [ ] **Step 2: Run the fixture smoke test (CLAUDE.md harness)**

Run: `npm run smoke:fixtures`
Expected: all paired fixtures pass. No regression in citation-verifier or schema.

- [ ] **Step 3: Boot the Electron app and walk the golden path**

Run: `npm --prefix app run dev`. Verify each page in turn:

**Top bar:**
- [ ] CLAUDE chip visible between ALERTS and LOOP. Click → 420px popover opens under the chip. Chat history (if any) renders. Composer input + STOP (only while typing) + RESET buttons present.
- [ ] NEWS chip count matches `(window.api.calendar.thisWeek()).events.filter(e => new Date(e.ts) > new Date()).length`.
- [ ] Click NEWS → popover groups by weekday; today's day-header has `· TODAY` in amber; any event within next 2h has amber tint + 3px left border; ALL past events are at opacity 0.45.
- [ ] If there's a high-impact event within 2h, the NEWS chip shows `<event> in <countdown>` after the count.

**PREP:**
- [ ] 5 panels in order: SESSION BRIEF · STEP 1 · STEP 2 · STEP 3 · SCENARIOS.
- [ ] SESSION BRIEF header right shows age + (chain chip if non-clean) + grade pill — all matching pill geometry (~22px tall, ~44px min-width).
- [ ] SESSION BRIEF footer right shows `[ MNQ ] [ MES ] [ REFRESH ]` — active tab is amber-tinted.
- [ ] Switching tabs flips the displayed brief (use one symbol that has a brief, switch to one that doesn't, verify "no brief yet" empty state).
- [ ] STEP 1 / STEP 2 / STEP 3 row labels are concise; hovering each shows the full strategy doc bullet text via the title attribute.
- [ ] STEP 2 UNTAKEN ABOVE / UNTAKEN BELOW: a bell at the right of each level. Click the bell → ALERTS chip count increments and the bell switches from ○ to ●.

**LIVE:**
- [ ] OpenReaction default: STEP 4 panel with Window/Reaction/Outcome + SESSION LIQUIDITY rows.
- [ ] EntryHunt (if `activeSetup` is set on disk or push): ENTRY CANDIDATE panel with concise CONFIRMATION labels; RISK rows show Entry (default), Stop (red), TP1 + TP2 (green); ACCEPT + REJECT pills at bottom right with red/green border.
- [ ] InTrade (if accept fires): IN-TRADE panel with side pill (green/red), grade pill, LIVE GRID 4-cell, TV action pills, BRAIN narration if chat has a bar-read.
- [ ] LoopBanner does NOT appear when health is healthy. Confirm by checking `window.api.health.onUpdate` events match the banner state.

**REVIEW:**
- [ ] SESSION JOURNAL: title + grade pill + EXPORT JSON pill. Body shows bias_picture prose.
- [ ] CANDIDATE LEDGER: rows render chronologically. Click a confirmed row → inline TradeCard expansion at the same width.
- [ ] EXPORT JSON triggers `window.api.review.exportSession` (check console for the path).
- [ ] SESSION LIBRARY table: click a non-current row → journal switches; the clicked row gets `.cur` amber highlight.

**Theme toggle:**
- [ ] Click `◐` (dark) → black palette. Click `◑` (light) → light theme renders cleanly.

- [ ] **Step 4: Confirm no console errors / warnings during walkthrough**

In the Electron dev-tools, with the Console tab open: walk through every page + every interaction. Expected: no red error messages, no `Uncaught` references. Warnings about `[useChat] subscribing` and similar `console.log`s in DEBUG-gated code are fine.

- [ ] **Step 5: If anything broke, fix inline + commit**

If you spot a regression (e.g. a tab doesn't switch, a row doesn't expand, an alert bell doesn't fire), debug locally. Use `Read` + `Edit` to fix. Commit each fix as its own commit with a `fix(...)` subject so the history is reviewable per-issue.

If everything works, no commit needed — proceed to Task 12.

---

### Task 12: CLAUDE.md decisions row + push + PR

**Files:**
- Modify: `CLAUDE.md` (append decisions table row)

- [ ] **Step 1: Append a decisions-table row in `CLAUDE.md`**

Open `CLAUDE.md`. Find the existing decisions table (the `| Date | Decision | Rationale |` table under `## Architecture decisions`). Locate the last row (currently `2026-05-26 | Strategy chain ...`). Insert a new row at the bottom:

```markdown
| 2026-05-27 | Essentialist re-add on top of reference 1:1 port + new CLAUDE popover + ForexFactory NEWS calendar | The reference 1:1 port (commit `e23164a`) gave us a coherent visual shell but stripped real functionality (live brief, alert bells, candidate ledger expansion, active trade narration). This PR re-adds the function while applying the essentialist cuts decided in the 2026-05-27 brainstorm: each piece of info appears in exactly one place (10 PREP panels → 5; 6 REVIEW panels → 3); CLAUDE conversation moves from page-inline to a global top-bar popover (was instantiated twice in LIVE sub-states); new weekly ForexFactory NEWS calendar replaces the empty-state stub; RISK rows are broken into separate Entry/Stop(red)/TP1+TP2(green) for color-coded scannability; unified `.pill` class (22px height, 44px min-width) replaces the scattered chip/tab/button sizes; neutral black palette replaces the navy tint. `window.GOFNQ_DATA` adapter dropped — panels read hooks directly. Calendar backend lives in `app/main/calendar.js`; refreshes on boot (if cache >24h) and every Monday 06:00 ET. Spec: [docs/superpowers/specs/2026-05-27-functionality-re-add.md](docs/superpowers/specs/2026-05-27-functionality-re-add.md). Plan: [docs/superpowers/plans/2026-05-27-functionality-re-add.md](docs/superpowers/plans/2026-05-27-functionality-re-add.md). |
```

- [ ] **Step 2: Commit the CLAUDE.md update**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude): record essentialist re-add + NEWS calendar decision

Adds a row to the architecture-decisions table summarizing the
2026-05-27 re-add: hookless panel reads, unified .pill geometry,
black palette, CLAUDE top-bar popover, ForexFactory NEWS calendar,
broken RISK rows. Links to spec + plan.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push the branch + open PR**

Run:
```bash
git push -u origin feat/reference-1to1-port
```

Open the PR:

```bash
gh pr create --base main --title "feat: essentialist re-add on top of reference 1:1 port" --body "$(cat <<'EOF'
## Summary
- Re-adds functionality from PRs #65 (PREP) / #66 (LIVE) / #67 (REVIEW) on top of the reference 1:1 port at commit `e23164a`, applying the essentialist cuts and new design decisions from the 2026-05-27 brainstorm.
- New top-level features: CLAUDE conversation as a global top-bar popover (was inline per page), weekly ForexFactory NEWS calendar (USD high+medium, grouped by weekday, today highlighted, imminent countdown).
- Visual: neutral black palette (no navy tint), unified `.pill` class for every chip/tab/button (22px height, 44px min-width), `.row` label column shrunk 230→160px.
- PREP: 10 panels → 5 (SESSION BRIEF · STEP 1 · STEP 2 · STEP 3 · SCENARIOS). MNQ/MES tabs in SESSION BRIEF footer. Untaken levels grouped above/below currentPrice with ○/●/◉ alert bells.
- LIVE: sub-state routed (OpenReaction / EntryHunt / InTrade) + always-on LoopBanner (when health.loop !== "healthy"). RISK rows broken into separate Entry/Stop(red)/TP1+TP2(green).
- REVIEW: 4 panels → 3 (SESSION JOURNAL · CANDIDATE LEDGER · SESSION LIBRARY). Ledger rows expandable in-place into TradeCard.
- `window.GOFNQ_DATA` adapter dropped — panels read hooks directly.

## Test Plan
- [ ] `npm run test:unit` — all green (≥315 passing including new calendar + prep-helper tests).
- [ ] `npm run smoke:fixtures` — all paired fixtures still pass citation + schema check.
- [ ] Manual: PREP shows 5 panels in essentialist order; switching MNQ/MES tabs flips the displayed brief; alert bells fire TV alerts.
- [ ] Manual: LIVE OpenReaction default; arming a setup flips to EntryHunt with ACCEPT/REJECT pills; accepting flips to InTrade with LIVE GRID.
- [ ] Manual: REVIEW SESSION JOURNAL renders bias_picture; ledger rows click to expand at same width; library row click switches journal.
- [ ] Manual: CLAUDE popover opens under the new top-bar chip on every page; chat composer + STOP/RESET work.
- [ ] Manual: NEWS popover shows weekly events grouped by day; TODAY chip; imminent events highlighted; chip count + countdown tick every 60s.
- [ ] Manual: light theme toggle still works.
- [ ] Boot: no console errors.

## Files changed
- `app/renderer/src/app.css` — palette swap to black, unified `.pill`, label column shrink, NEWS popover restyle, CLAUDE popover styles, RISK row tones.
- `app/renderer/src/App.jsx` — drop `useDataAdapter`, add `CLAUDE` chip + popover, rewrite `NewsPopover` to read calendar IPC, drill `currentPrice`.
- `app/renderer/src/Prep.jsx` — full rewrite to essentialist 5-panel layout.
- `app/renderer/src/Live.jsx` — full rewrite to essentialist sub-state layout.
- `app/renderer/src/Review.jsx` — full rewrite to essentialist 3-panel layout.
- `app/renderer/src/Prep.helpers.js` — three new exports (`htfBiasToRowsConcise`, `overnightHeaderRows`, `scenariosMeta`).
- `app/main/calendar.js` — NEW: ForexFactory fetcher + cache + scheduler.
- `app/main/ipc.js`, `app/preload.cjs`, `app/electron-main.js` — wire calendar IPC + bootstrap.
- `tests/calendar.test.js` — NEW: 4 describes covering filter + isImminent + groupByDay + countRemaining.
- `tests/prep-helpers.test.js` — three new describes.
- `CLAUDE.md` — decisions table row.

Spec: [docs/superpowers/specs/2026-05-27-functionality-re-add.md](docs/superpowers/specs/2026-05-27-functionality-re-add.md)
Plan: [docs/superpowers/plans/2026-05-27-functionality-re-add.md](docs/superpowers/plans/2026-05-27-functionality-re-add.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Verify the PR URL is shown**

Expected: `gh pr create` prints the PR URL to stdout. Return that URL to the user.

---

## Self-Review Checklist

After writing the plan, the author should mentally walk through each spec requirement and confirm a task covers it:

| Spec requirement | Covered by |
|------------------|-----------|
| Black palette (#000000 / #0a0a0a / #131313 / #1f1f1f / #2e2e2e / #6e6e6e / #3a3a3a) | Task 2 step 1 |
| `.pill` class with 22px height, 44px min-width, 10px font | Task 2 step 3 |
| `.grade-pill` retains name but inherits `.pill` geometry | Task 2 step 3 |
| `.row` label column 230→160px | Task 2 step 2 |
| CLAUDE chip + popover next to ALERTS | Task 3 (CSS) + Task 7 (renderer) |
| NEWS popover: weekly view, USD high+medium, weekday grouped, today highlighted, imminent countdown | Task 4 (CSS) + Task 5 (backend filter) + Task 7 (renderer + countdown tick) |
| MNQ/MES tabs in SESSION BRIEF footer | Task 8 step 4 (SessionBriefPanel) |
| Concise labels with strategy-doc tooltips on STEP 1/2/3 row labels | Task 8 step 1 (helpers) + step 4 (renderer) |
| Concise labels on LIVE CONFIRMATION rows with tooltips | Task 9 step 1 (conciseLabel map) |
| RISK rows broken into Entry / Stop (red) / TP1 (green) / TP2 (green) | Task 3 step 2 (CSS) + Task 9 step 1 (markup) |
| Loop banner when health.loop !== "healthy" | Task 9 step 1 (LoopBanner component) |
| `useDataAdapter` dropped | Task 7 step 1 |
| Panels read hooks directly | Tasks 8/9/10 |
| ForexFactory backend fetcher + filter + cache + Monday 06:00 ET refresh | Task 5 |
| `window.api.calendar.thisWeek()` IPC binding | Task 6 |
| Tests for calendar helpers (filter + isImminent + groupByDay + countRemaining) | Task 5 step 1 |
| Tests for new prep helpers | Task 8 step 2 |
| CLAUDE.md decisions row | Task 12 step 1 |
| Tests must remain ≥309 passing | Verified in Tasks 5/8/11 |
| Single PR, panel-by-panel discipline | Tasks 8/9/10 commits + Task 12 PR |
| Risks documented (R1-R5 from spec) | Mitigations live in code: Task 5 try/catch for fetch (R1), `Intl.DateTimeFormat` for ET parsing (R2), `.pill { min-width: 44px }` audit in Task 11 step 3 (R3), `--surface-1: #0a0a0a` keeps panel boundaries visible (R4), `max-height: 80vh` on small screens (Task 3 step 1) (R5) |

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-27-functionality-re-add.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between tasks. Best for catching subtle issues and keeping context windows tight.

**2. Inline Execution** — Execute the 12 tasks in batches with checkpoints in this session. Faster cycle but less review per task. Suggested batches:
- Batch A: Tasks 1-4 (spec/plan commit + CSS foundations)
- Batch B: Tasks 5-6 (calendar backend + IPC)
- Batch C: Task 7 (App.jsx top-bar additions)
- Batch D: Tasks 8-10 (per-page rewrites)
- Batch E: Tasks 11-12 (verification + PR)

**Which approach?**

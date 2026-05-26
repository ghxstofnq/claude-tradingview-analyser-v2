# LIVE Panel Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `app/renderer/src/Live.jsx` around three explicit sub-states (OpenReaction / EntryHunt / InTrade), each with a deliberate focused layout. Promote InTrade to a dedicated panel with LIVE GRID 4-cell, TV hand-off buttons, and BRAIN narration block. Add SESSION LIQUIDITY (OpenReaction) and STEP 5+6 confirmation checks (EntryHunt) as sibling panels.

**Architecture:** Additive only. All data hooks unchanged. No new IPC. No schema changes. Four pure helpers extracted to `Live.helpers.js` for `node --test` coverage. Six new sub-components live inside `Live.jsx` (matching the existing single-file pattern). `useTrades().activeTrade` is hoisted into the `LiveWorkstation` router so the InTrade branch is explicit. The TradeCard usage in LIVE is replaced by the new `InTrade` panel; TradeCard itself stays exported from Shared.jsx for REVIEW.

**Tech Stack:** React 18 (Vite + Babel via `@vitejs/plugin-react`), `node --test` runner, existing IPC plumbing through `app/main/preload.cjs`. Same stack as PREP redesign (PR #65).

**Spec:** [docs/superpowers/specs/2026-05-27-live-panel-redesign.md](../specs/2026-05-27-live-panel-redesign.md)

**Branch:** `feat/live-panel-redesign` — cut from `main` after PR #65 lands.

---

## File Inventory

**Created:**
- `app/renderer/src/Live.helpers.js` — four pure helpers (`selectPillar3`, `pillar3ToConfirmationRows`, `liveGridFromTrade`, `latestBarReadMessage`).
- `tests/live-helpers.test.js` — node test for the four helpers above.

**Modified:**
- `app/renderer/src/Live.jsx` — full restructure (new `OpenReactionView`, `SessionLiquidityPanel`, `Step5n6Panel`, `InTrade`, `BrainNarrationBlock`, `TvHandoffActions`; existing `EntryHunt` renamed `EntryHuntView`; router refactored).
- `app/renderer/src/Shared.jsx` — add `LiveCell` export. No changes to existing exports.
- `app/renderer/src/app.css` — additive (`.intrade-panel`, `.live-grid-2x2`, `.live-cell`, `.brain-narration`, `.tv-handoff`, `.step5n6-panel`, `.session-liquidity`, `.tv-toast`, `.confirmation-row`). Existing classes untouched.
- `CLAUDE.md` — append a decisions-table row for the LIVE redesign.

**Untouched (explicit non-scope):**
- `app/renderer/src/Prep.jsx` (shipped PR #65), `app/renderer/src/Review.jsx`, `app/renderer/src/TvChart.jsx`
- All hooks in `app/renderer/src/hooks/`
- `app/main/sdk.js`, `app/main/tools/surface.js`, `app/main/trades.js`, `app/main/prompts/analyze.md`

---

## Task Dependency Graph

```
Task 1 (branch + spec commit)
  ├─ Task 2 (Live.helpers.js)
  │    └─ Task 3 (helper tests)
  ├─ Task 4 (CSS additions)
  ├─ Task 5 (LiveCell in Shared.jsx)
  │
  └─ Task 6 (full Live.jsx restructure) ─┐
       │                                  ↓
       └─ Task 7 (full test + smoke + manual)
            └─ Task 8 (CLAUDE.md row)
                 └─ Task 9 (push + PR)
```

Tasks 2-3, 4, 5 can land in any order before Task 6 (they don't conflict). Recommended sequential: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

---

### Task 1: Cut branch + sanity baseline + commit spec

**Files:**
- The spec at `docs/superpowers/specs/2026-05-27-live-panel-redesign.md` is currently untracked. Commit it to the new branch.

- [ ] **Step 1: Verify clean working state**

Run: `git status`
Expected: on `main` or current working branch. Spec file shows as untracked. If working tree has unrelated changes, stash before proceeding.

- [ ] **Step 2: Sync main**

Run:
```bash
git checkout main
git pull --ff-only origin main
```
Expected: latest main. PR #65 should be in the log.

- [ ] **Step 3: Cut branch**

Run: `git checkout -b feat/live-panel-redesign`
Expected: on the new branch.

- [ ] **Step 4: Baseline tests + smoke**

Run: `npm run test:unit && npm run smoke:fixtures`
Expected: both green. Note the baseline test count for comparison after.

- [ ] **Step 5: Commit spec + this plan**

```bash
git add docs/superpowers/specs/2026-05-27-live-panel-redesign.md docs/superpowers/plans/2026-05-27-live-panel-redesign.md
git commit -m "$(cat <<'EOF'
docs(live): spec + implementation plan for LIVE redesign

Spec — three sub-state layouts (OpenReaction adds SESSION LIQUIDITY +
STEP 4 prefix; EntryHunt adds STEP 5+6 panel with explicit confirmation
checks above SetupCard; InTrade is the new hybrid layout with LIVE GRID
4-cell + 3 TV hand-off buttons + BRAIN narration). No schema changes.
No new IPC. Same hooks. CLAUDE.md constraint #2 satisfied (no MCP).

Plan — 9 bite-sized tasks with full code blocks per step. Single-file
restructure for Live.jsx; pure helpers in Live.helpers.js for node --test.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Live.helpers.js — pure helpers

**Files:**
- Create: `app/renderer/src/Live.helpers.js`

- [ ] **Step 1: Create the helpers file**

Write `app/renderer/src/Live.helpers.js`:

```js
// Pure helpers for Live.jsx — extracted so they can be unit-tested with
// `node --test`. Importing this file has no side effects.

// Find Pillar 3 ("Entry Model + Confirmation") in a pillar_breakdown array
// by name substring (case-insensitive). Robust to ordering changes in the
// prompt — index-based access is fragile.
//
// Returns the pillar object or null if not found.
export function selectPillar3(pillars) {
  if (!Array.isArray(pillars)) return null;
  return pillars.find((p) => p && typeof p.name === "string" && /entry|confirmation/i.test(p.name)) || null;
}

// Map Pillar 3 elements to the four confirmation rows displayed in the
// STEP 5+6 panel. Elements are matched by name substring:
//   - "PD-array tap" → /pd|tap/i
//   - "1m close past structure" → /1m/i
//   - "5m close past structure" → /5m/i
//   - "Clean delivery" → /delivery|clean/i
//
// Returns [{ label, status, detail }] — one entry per slot, always 4 rows.
// Missing elements render as { status: "missing", detail: "—" }.
export function pillar3ToConfirmationRows(pillar3) {
  const elements = pillar3?.elements || [];
  const find = (rx) => elements.find((e) => e && typeof e.name === "string" && rx.test(e.name));
  const rowFor = (label, rx) => {
    const el = find(rx);
    if (!el) return { label, status: "missing", detail: "—" };
    return {
      label,
      status: el.status || "pending",
      detail: el.detail || el.note || (el.status === "pass" ? "yes" : el.status === "pending" ? "pending" : "—"),
    };
  };
  return [
    rowFor("PD-array tap", /pd|tap/i),
    rowFor("1m close past structure", /1m/i),
    rowFor("5m close past structure", /5m/i),
    rowFor("Clean delivery", /delivery|clean/i),
  ];
}

// Compute LIVE GRID 4-cell data from a trade + live close price.
// Returns { price, pnl, toTp1, toStop } each with { v: string, sub: string, tone: string }.
//
// When lastClose isn't a finite number, returns nulls — the renderer
// falls back to "—" placeholders.
export function liveGridFromTrade(trade, lastClose) {
  if (!trade || typeof lastClose !== "number" || !Number.isFinite(lastClose)) {
    return {
      price: { v: "—", sub: "", tone: "" },
      pnl: { v: "—", sub: "", tone: "" },
      toTp1: { v: "—", sub: "", tone: "" },
      toStop: { v: "—", sub: "", tone: "" },
    };
  }
  const fmt = (n) => Number(n.toFixed(2));
  const fmtPx = (n) => {
    const [whole, dec = ""] = String(n).split(".");
    const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
  };
  const entry = Number(trade.entry);
  const tp1 = Number(trade.tp1);
  const stop = Number(trade.stop);
  const isLong = trade.side === "long";
  const fromEntry = isLong ? lastClose - entry : entry - lastClose;
  const distTp1 = isLong ? tp1 - lastClose : lastClose - tp1;
  const distStop = isLong ? lastClose - stop : stop - lastClose;
  const pnlR = trade.r_realized != null
    ? Number(trade.r_realized)
    : Number.isFinite(entry) && Number.isFinite(stop) && entry !== stop
      ? fmt(fromEntry / Math.abs(entry - stop))
      : null;
  return {
    price: {
      v: fmtPx(lastClose),
      sub: Number.isFinite(fromEntry) ? `${fromEntry >= 0 ? "+" : ""}${fmt(fromEntry)} from entry` : "",
      tone: "",
    },
    pnl: {
      v: pnlR != null ? `${pnlR > 0 ? "+" : ""}${pnlR} R` : "—",
      sub: trade.r_realized != null ? "realized" : "unrealized",
      tone: pnlR == null ? "" : pnlR > 0 ? "green" : pnlR < 0 ? "red" : "",
    },
    toTp1: {
      v: Number.isFinite(distTp1) ? String(Math.abs(fmt(distTp1))) : "—",
      sub: distTp1 > 0 ? "pts away" : "past",
      tone: "green",
    },
    toStop: {
      v: Number.isFinite(distStop) ? String(Math.abs(fmt(distStop))) : "—",
      sub: trade.tp1_hit ? "pts (BE)" : "pts",
      tone: "red",
    },
  };
}

// Find the latest "bar-read" message from a useChat-shaped messages array.
// Each message has shape { type, body, t }. Returns the message or null.
//
// The chat history is ordered oldest-first, so we scan from the end.
export function latestBarReadMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.type === "bar-read") return m;
  }
  return null;
}
```

- [ ] **Step 2: Verify the module loads**

Run: `node -e "import('./app/renderer/src/Live.helpers.js').then((m) => console.log('exports:', Object.keys(m).sort().join(','))).catch((e) => { console.error(e.message); process.exit(1); })"`
Expected: `exports: latestBarReadMessage,liveGridFromTrade,pillar3ToConfirmationRows,selectPillar3`

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/Live.helpers.js
git commit -m "$(cat <<'EOF'
feat(live): extract pure helpers for LIVE redesign

Four exports:
- selectPillar3 — find Pillar 3 by name substring
- pillar3ToConfirmationRows — map elements to 4 confirmation rows
- liveGridFromTrade — compute LIVE GRID 4-cell from trade + lastClose
- latestBarReadMessage — pick the latest bar-read from chat history

Pure JS. No side effects. Mirrors the PREP helpers pattern.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Helper unit tests

**Files:**
- Create: `tests/live-helpers.test.js`

- [ ] **Step 1: Write the test file**

```js
// Unit tests for app/renderer/src/Live.helpers.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  latestBarReadMessage,
} from "../app/renderer/src/Live.helpers.js";

describe("selectPillar3", () => {
  const pillars = [
    { name: "Draw & Bias", status: "pass", elements: [] },
    { name: "Price-Action Quality", status: "weak", elements: [] },
    { name: "Entry Model + Confirmation", status: "pending", elements: [] },
  ];

  it("finds Pillar 3 by 'entry' substring", () => {
    const p = selectPillar3(pillars);
    assert.equal(p.status, "pending");
  });

  it("finds Pillar 3 by 'confirmation' substring even if reordered", () => {
    const reordered = [pillars[2], pillars[0], pillars[1]];
    const p = selectPillar3(reordered);
    assert.equal(p.status, "pending");
  });

  it("returns null when no pillar matches", () => {
    assert.equal(selectPillar3([pillars[0]]), null);
  });

  it("returns null on non-array input", () => {
    assert.equal(selectPillar3(undefined), null);
    assert.equal(selectPillar3(null), null);
  });
});

describe("pillar3ToConfirmationRows", () => {
  it("maps four rows in fixed order, matched by name substring", () => {
    const pillar3 = {
      elements: [
        { name: "1m close past structure", status: "pass", detail: "21 322.50 close > 21 320" },
        { name: "PD-array tap", status: "pass", detail: "wick tapped 4H FVG" },
        { name: "Clean delivery", status: "pending", detail: "" },
        { name: "5m close past structure", status: "weak", detail: "wick only, no close" },
      ],
    };
    const rows = pillar3ToConfirmationRows(pillar3);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].label, "PD-array tap");
    assert.equal(rows[0].status, "pass");
    assert.match(rows[0].detail, /wick tapped/);
    assert.equal(rows[1].label, "1m close past structure");
    assert.equal(rows[1].status, "pass");
    assert.equal(rows[2].label, "5m close past structure");
    assert.equal(rows[2].status, "weak");
    assert.equal(rows[3].label, "Clean delivery");
    assert.equal(rows[3].status, "pending");
  });

  it("renders missing elements as 'missing' status with em-dash detail", () => {
    const rows = pillar3ToConfirmationRows({ elements: [] });
    assert.equal(rows.every((r) => r.status === "missing"), true);
    assert.equal(rows.every((r) => r.detail === "—"), true);
  });

  it("tolerates null pillar3 input", () => {
    const rows = pillar3ToConfirmationRows(null);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].status, "missing");
  });
});

describe("liveGridFromTrade", () => {
  const longTrade = {
    side: "long",
    entry: 21322.50,
    stop: 21285.00,
    tp1: 21385.00,
    tp2: 21420.00,
    tp1_hit: false,
  };

  it("computes the 4 cells for a long trade", () => {
    const grid = liveGridFromTrade(longTrade, 21358.25);
    assert.match(grid.price.v, /21 358\.25/);
    assert.match(grid.price.sub, /\+35\.75 from entry/);
    assert.equal(grid.pnl.tone, "green");
    assert.match(grid.toTp1.v, /^26\.75/);  // |21385 - 21358.25| = 26.75
    assert.equal(grid.toTp1.tone, "green");
    assert.match(grid.toStop.v, /^73\.25/); // 21358.25 - 21285 = 73.25
    assert.equal(grid.toStop.tone, "red");
  });

  it("flips P&L tone red when below entry on a long", () => {
    const grid = liveGridFromTrade(longTrade, 21300);
    assert.equal(grid.pnl.tone, "red");
  });

  it("annotates stop as BE when tp1_hit", () => {
    const grid = liveGridFromTrade({ ...longTrade, tp1_hit: true }, 21358.25);
    assert.match(grid.toStop.sub, /\(BE\)/);
  });

  it("computes correctly for a short trade", () => {
    const shortTrade = { side: "short", entry: 21400, stop: 21430, tp1: 21340, tp2: 21290 };
    const grid = liveGridFromTrade(shortTrade, 21380);
    // For a short: fromEntry = entry - lastClose = 20 (positive = winning)
    assert.match(grid.price.sub, /\+20 from entry/);
    assert.equal(grid.pnl.tone, "green");
    // toTp1 = lastClose - tp1 = 40 (still 40 pts to TP1)
    assert.match(grid.toTp1.v, /^40/);
  });

  it("returns em-dash placeholders when lastClose is missing", () => {
    const grid = liveGridFromTrade(longTrade, null);
    assert.equal(grid.price.v, "—");
    assert.equal(grid.pnl.v, "—");
  });

  it("returns em-dash placeholders when trade is missing", () => {
    const grid = liveGridFromTrade(null, 21358);
    assert.equal(grid.price.v, "—");
  });
});

describe("latestBarReadMessage", () => {
  it("finds the latest bar-read in a mixed message list", () => {
    const messages = [
      { type: "user", body: "hello", t: "09:30" },
      { type: "bar-read", body: "first read", t: "09:31" },
      { type: "reply", body: "answer", t: "09:32" },
      { type: "bar-read", body: "latest read", t: "09:33" },
      { type: "reply", body: "another answer", t: "09:34" },
    ];
    const m = latestBarReadMessage(messages);
    assert.equal(m.body, "latest read");
  });

  it("returns null when no bar-read exists", () => {
    const messages = [
      { type: "user", body: "hi" },
      { type: "reply", body: "hi" },
    ];
    assert.equal(latestBarReadMessage(messages), null);
  });

  it("returns null on empty array", () => {
    assert.equal(latestBarReadMessage([]), null);
  });

  it("returns null on non-array input", () => {
    assert.equal(latestBarReadMessage(undefined), null);
    assert.equal(latestBarReadMessage(null), null);
  });
});
```

- [ ] **Step 2: Run the helper tests**

Run: `node --test tests/live-helpers.test.js`
Expected: all tests pass (~17 cases).

- [ ] **Step 3: Run the full suite**

Run: `npm run test:unit`
Expected: all tests pass — baseline (267) + ~17 new = ~284.

- [ ] **Step 4: Commit**

```bash
git add tests/live-helpers.test.js
git commit -m "$(cat <<'EOF'
test(live): unit tests for Live.helpers

Covers all four exports — selectPillar3 (4), pillar3ToConfirmationRows
(3), liveGridFromTrade (6 incl. long/short/null safety), latestBarReadMessage (4).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: CSS additions

**Files:**
- Modify: `app/renderer/src/app.css` (append a new section at the end)

- [ ] **Step 1: Append the new classes**

Append this block at the bottom of `app/renderer/src/app.css`:

```css
/* ─────────── LIVE redesign (2026-05-27) ─────────── */

/* Session liquidity panel — used in OpenReaction sub-state. Compact list
   of brief key_levels with state pills. */
.session-liquidity .lvl {
  display: grid;
  grid-template-columns: 14px 64px 1fr 78px;
  align-items: center;
  gap: 8px;
  padding: 3px 14px;
  font-size: 11px;
  border-bottom: 1px dotted var(--border-dim, #1e2228);
}
.session-liquidity .lvl:last-child { border-bottom: 0; }
.session-liquidity .lvl .marker { color: var(--blue, #4f7eb3); }
.session-liquidity .lvl .name { color: var(--value); letter-spacing: 0.04em; }
.session-liquidity .lvl .price { color: var(--value); font-variant-numeric: tabular-nums; text-align: right; }
.session-liquidity .lvl .state {
  text-align: center; font-size: 8.5px; letter-spacing: 0.12em;
  color: var(--green); border: 1px solid var(--green); padding: 1px 5px;
}
.session-liquidity .lvl .state.taken,
.session-liquidity .lvl .state.swept {
  color: var(--label); border-color: var(--border);
}

/* STEP 5+6 confirmation panel — used in EntryHunt sub-state. */
.step5n6-panel .confirmation-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 14px;
  font-size: 11px;
  border-bottom: 1px dotted var(--border-dim, #1e2228);
}
.step5n6-panel .confirmation-row:last-child { border-bottom: 0; }
.step5n6-panel .confirmation-row .label {
  color: var(--label);
  display: flex; align-items: center; gap: 6px;
}
.step5n6-panel .confirmation-row .check {
  display: inline-block; width: 12px;
  font-size: 12px; color: var(--green);
}
.step5n6-panel .confirmation-row .check.pending,
.step5n6-panel .confirmation-row .check.missing { color: var(--label-dim, #4a5560); }
.step5n6-panel .confirmation-row .check.weak { color: var(--amber); }
.step5n6-panel .confirmation-row .check.fail { color: var(--red); }
.step5n6-panel .confirmation-row .detail {
  color: var(--value); font-variant-numeric: tabular-nums;
  font-size: 10.5px;
}
.step5n6-panel .confirmation-row .detail.green { color: var(--green); }
.step5n6-panel .confirmation-row .detail.amber { color: var(--amber); }
.step5n6-panel .confirmation-row .detail.red { color: var(--red); }
.step5n6-panel .confirmation-row .detail.dim { color: var(--label-dim, #4a5560); }
.step5n6-panel .sect-hd {
  color: var(--label); font-size: 9px; letter-spacing: 0.18em;
  padding: 6px 14px 3px;
  border-bottom: 1px dotted var(--border);
  background: var(--surface-1);
}

/* IN-TRADE dedicated panel — used in InTrade sub-state. */
.intrade-panel {
  border: 1px solid var(--green);
  background: rgba(111, 156, 91, 0.04);
}
.intrade-panel .panel-head .title { color: var(--green); }
.intrade-panel .trade-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-size: 10.5px;
  color: var(--value);
  border-bottom: 1px solid var(--border-dim, #1e2228);
}
.intrade-panel .trade-head .id { color: var(--amber); font-variant-numeric: tabular-nums; }
.intrade-panel .trade-head .side {
  padding: 1px 6px;
  border: 1px solid var(--green);
  color: var(--green);
  background: rgba(111, 156, 91, 0.12);
  font-size: 9px; letter-spacing: 0.12em;
}
.intrade-panel .trade-head .side.short {
  border-color: var(--red);
  color: var(--red);
  background: rgba(192, 71, 62, 0.12);
}
.intrade-panel .trade-head .status {
  margin-left: auto;
  color: var(--label);
  font-size: 9.5px;
  letter-spacing: 0.1em;
}

/* LIVE GRID 4-cell (2×2). Big readable numbers for at-a-glance scanning. */
.live-grid-2x2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 8px 14px;
}
.live-cell {
  border: 1px solid var(--border);
  background: var(--surface-1);
  padding: 7px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.live-cell .k {
  color: var(--label);
  font-size: 9px;
  letter-spacing: 0.16em;
}
.live-cell .v {
  color: var(--value);
  font-size: 15px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.live-cell .v.green { color: var(--green); }
.live-cell .v.red { color: var(--red); }
.live-cell .v.amber { color: var(--amber); }
.live-cell .sub {
  color: var(--label);
  font-size: 9.5px;
}

/* TV hand-off button row. Three buttons that focus the TradingView pane
   and fire a toast. No order execution. */
.tv-handoff {
  display: flex;
  gap: 6px;
  padding: 6px 14px 10px;
}
.tv-handoff button {
  flex: 1;
  background: transparent;
  border: 1px solid var(--blue, #4f7eb3);
  color: var(--blue, #4f7eb3);
  padding: 4px 8px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  cursor: pointer;
}
.tv-handoff button:hover {
  background: rgba(79, 126, 179, 0.08);
}
[data-theme="light"] .tv-handoff button { color: #2563a0; border-color: #2563a0; }

/* TV hand-off toast — transient banner pinned at the top of the LIVE
   pane when a TV button is clicked. Self-dismisses after 3s. */
.tv-toast {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface-1);
  border: 1px solid var(--blue, #4f7eb3);
  padding: 6px 14px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 10.5px;
  color: var(--value);
  letter-spacing: 0.06em;
  z-index: 40;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
.tv-toast b { color: var(--blue, #4f7eb3); font-weight: 600; }

/* BRAIN narration block — quoted message from the latest bar-read. */
.brain-narration {
  border-left: 3px solid var(--blue, #4f7eb3);
  padding: 6px 14px;
  margin: 6px 0;
  background: rgba(79, 126, 179, 0.04);
  color: var(--value);
  font-size: 11px;
  line-height: 1.5;
}
.brain-narration .head {
  color: var(--blue, #4f7eb3);
  font-size: 9px;
  letter-spacing: 0.15em;
  margin-bottom: 3px;
}
.brain-narration .body em {
  /* override the click-to-arm cursor on prices INSIDE BRAIN — bar-reads
     are read-only context, not interactive. */
  cursor: default;
  font-style: normal;
  color: var(--amber);
}
[data-theme="light"] .brain-narration { background: rgba(37, 99, 160, 0.05); }
[data-theme="light"] .brain-narration .head { color: #2563a0; }
```

- [ ] **Step 2: Verify CSS braces balance**

Run:
```bash
node -e "const fs = require('fs'); const css = fs.readFileSync('app/renderer/src/app.css', 'utf8'); const open = (css.match(/{/g) || []).length; const close = (css.match(/}/g) || []).length; if (open !== close) { console.error('CSS brace mismatch:', open, 'vs', close); process.exit(1); } else { console.log('css braces ok:', open); }"
```

Expected: `css braces ok: <number>` (number should be ~390-400, up from 369 after PREP).

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "$(cat <<'EOF'
feat(css): add classes for LIVE redesign

Additive only. New classes: .session-liquidity, .step5n6-panel,
.intrade-panel, .live-grid-2x2, .live-cell, .tv-handoff, .tv-toast,
.brain-narration. Includes [data-theme=light] overrides where needed.

No existing classes modified — PREP / REVIEW / shared components
unaffected.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: LiveCell export in Shared.jsx

**Files:**
- Modify: `app/renderer/src/Shared.jsx` (add a new exported component before the final `export { ... }` block).

- [ ] **Step 1: Add the LiveCell component**

Find the final `export { ... }` block (around line 639). Insert this component immediately above it:

```jsx
// ---------- LiveCell (LIVE redesign, 2026-05-27) ----------
// Single cell in the LIVE GRID 2×2 grid used by the InTrade panel.
// Props: { k, v, sub, tone } where tone is "green" | "red" | "amber" | "".
function LiveCell({ k, v, sub, tone }) {
  return (
    <div className="live-cell">
      <span className="k">{k}</span>
      <span className={"v " + (tone || "")}>{v}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Add LiveCell to the export block**

Update the `export { ... }` block at the bottom of the file:

```js
export {
  Panel, SectionHead, Row, Grade, PillarsPanel,
  SetupCard, TradeCard, ClaudeFeed, Btn, StatusLine, Snapshot,
  ScenarioCard, LiveCell,
};
```

- [ ] **Step 3: Verify brace balance**

```bash
node -e "const fs = require('fs'); const src = fs.readFileSync('app/renderer/src/Shared.jsx', 'utf8'); const open = (src.match(/{/g) || []).length; const close = (src.match(/}/g) || []).length; if (Math.abs(open - close) > 5) { console.error('brace mismatch:', open, close); process.exit(1); } else { console.log('braces close enough:', open, close); }"
```

(Brace counting in JSX is noisy; small differences are fine.)

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/Shared.jsx
git commit -m "$(cat <<'EOF'
feat(renderer): add LiveCell for LIVE 4-cell grid

A single cell in the IN-TRADE LIVE GRID — { k, v, sub, tone } props.
Exported alongside the existing components so REVIEW can reuse it.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full Live.jsx restructure

**Files:**
- Modify: `app/renderer/src/Live.jsx` (substantial rewrite — six new components added, EntryHunt renamed to EntryHuntView, LiveWorkstation router refactored to hoist activeTrade).

This is the biggest task. Take it in stages — write the new components first, then refactor the router last.

- [ ] **Step 1: Update the imports at the top**

Replace lines 1-12 with:

```jsx
// LIVE mode workstation — Claude conversation + setups/trades rail.
// Three sub-states routed by data: OpenReaction / EntryHunt / InTrade.

import React, { useState as useStateL, useEffect as useEffectL, useRef as useRefL } from "react";
import { Panel, Row, Grade, PillarsPanel, SetupCard, ClaudeFeed, SectionHead, LiveCell } from "./Shared.jsx";
import { useChat } from "./hooks/useChat.js";
import { useActiveSetup } from "./hooks/useActiveSetup.js";
import { useTrades } from "./hooks/useTrades.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";
import { useSetupsHistory } from "./hooks/useSetupsHistory.js";
import { useLastBar } from "./hooks/useLastBar.js";
import { useSessionBrief } from "./hooks/useSessionBrief.js";
import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  latestBarReadMessage,
} from "./Live.helpers.js";
```

Note: `TradeCard` is removed from the imports — LIVE no longer uses it directly. (Shared.jsx still exports it for REVIEW.)

- [ ] **Step 2: Add SessionLiquidityPanel after OpenReactionTracker**

Find the existing `PreviousReadsPanel` (around line 72). After its closing `}`, insert:

```jsx
// SESSION LIQUIDITY — used inside OpenReactionView. Reads brief key_levels
// and renders untaken / swept liquidity in a compact list.
function SessionLiquidityPanel() {
  const { brief } = useSessionBrief();
  const levels = brief?.key_levels || [];
  if (levels.length === 0) return null;
  // Sort high → low for at-a-glance scanning.
  const sorted = [...levels].sort((a, b) => {
    const an = typeof a.price === "number" ? a.price : -Infinity;
    const bn = typeof b.price === "number" ? b.price : -Infinity;
    return bn - an;
  });
  const fmtPx = (p) => {
    if (typeof p !== "number") return String(p ?? "");
    const [whole, dec = ""] = String(p).split(".");
    const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
  };
  return (
    <section className="panel session-liquidity">
      <header className="panel-head">
        <span className="title">SESSION LIQUIDITY</span>
        <span className="meta">{levels.length} level{levels.length === 1 ? "" : "s"}</span>
      </header>
      <div className="panel-body flush">
        {sorted.map((lv) => {
          const state = lv.state || "untaken";
          return (
            <div className="lvl" key={lv.name}>
              <span className="marker">{state === "untaken" ? "─" : "·"}</span>
              <span className="name">{lv.name}</span>
              <span className="price">{fmtPx(lv.price)}</span>
              <span className={"state " + state}>{state.toUpperCase()}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wrap OpenReaction in an OpenReactionView**

Find `OpenReactionTracker` (around line 31). Immediately after its closing `}` (before `function PreviousReadsPanel`), insert the existing function unchanged. Then after `SessionLiquidityPanel`, add this wrapper:

```jsx
// OpenReactionView — the OpenReaction sub-state. Wraps the existing
// OpenReactionTracker, inserts SESSION LIQUIDITY between latest + previous
// reads, preserves loop-down banner.
function OpenReactionView({ loopDown }) {
  return (
    <div className="work-scroll">
      {loopDown && (
        <div className="banner">
          <span className="glyph">● LOOP DOWN</span>
          <span className="txt">bar-close detector not reporting</span>
          <span className="sub">RESTART</span>
        </div>
      )}
      <OpenReactionTracker />
      <SessionLiquidityPanel />
    </div>
  );
}
```

Important: `OpenReactionTracker` is unchanged. Its existing title `OPEN REACTION · LATEST READ` should be updated. Find this line inside `OpenReactionTracker`:

```jsx
<Panel title="OPEN REACTION · LATEST READ"
       right={`+${minutesIn}m · ${left}m left`}>
```

Replace with:

```jsx
<Panel title="STEP 4 · NY OPEN LTF BIAS"
       right={`+${minutesIn}m · ${left}m left`}>
```

Also update the placeholder title (the no-latest case):

```jsx
<Panel title="STEP 4 · NY OPEN LTF BIAS · waiting for first read">
```

- [ ] **Step 4: Add the Step5n6Panel component**

Find `RejectedSetupsPanel` (around line 141). Before it, insert:

```jsx
// STEP 5+6 — explicit MODEL + CONFIRMATION checks for the active setup.
// Hides when no active setup. Source: activeSetup.pillar_breakdown[].
function Step5n6Panel({ activeSetup }) {
  if (!activeSetup) return null;
  const pillar3 = selectPillar3(activeSetup.pillar_breakdown);
  const rows = pillar3ToConfirmationRows(pillar3);
  const modelStatus = pillar3?.status === "pass" ? "valid"
                    : pillar3?.status === "pending" ? "pending"
                    : pillar3?.status === "weak" ? "weak"
                    : "—";
  const modelTone = pillar3?.status === "pass" ? "green"
                  : pillar3?.status === "pending" ? "amber"
                  : pillar3?.status === "weak" ? "amber"
                  : "dim";
  const check = (status) => {
    if (status === "pass") return "✓";
    if (status === "weak") return "~";
    if (status === "fail") return "✗";
    return "·";
  };
  return (
    <section className="panel step5n6-panel">
      <header className="panel-head">
        <span className="title">STEP 5+6 · ENTRY MODEL + CONFIRMATION</span>
        <span className="meta">claude-graded</span>
      </header>
      <div className="panel-body flush">
        <div className="sect-hd">MODEL</div>
        <div className="confirmation-row">
          <span className="label">Active</span>
          <span className={"detail " + modelTone}>
            {activeSetup.model || "—"} · {modelStatus}
          </span>
        </div>
        <div className="sect-hd">CONFIRMATION</div>
        {rows.map((r) => (
          <div className="confirmation-row" key={r.label}>
            <span className="label">
              <span className={"check " + r.status}>{check(r.status)}</span>
              {r.label}
            </span>
            <span className={"detail " + (
              r.status === "pass" ? "green"
              : r.status === "weak" || r.status === "fail" ? "amber"
              : "dim"
            )}>{r.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add the TvHandoffActions + TvToast components**

Before the existing `EntryHunt` function (around line 385), insert:

```jsx
// TV hand-off — three buttons that focus the TradingView pane and fire a
// toast. No broker integration; no order execution. The trader uses
// TradingView's own UI to act.
const TV_HANDOFF_TOASTS = {
  stop:  "Modify your stop in TradingView's right-side panel.",
  scale: "Scale your position in TradingView's order ticket.",
  close: "Close your position in TradingView's order ticket.",
};

function TvHandoffActions({ onAction }) {
  return (
    <div className="tv-handoff">
      <button onClick={() => onAction("stop")}>▸ TV STOP</button>
      <button onClick={() => onAction("scale")}>▸ TV SCALE</button>
      <button onClick={() => onAction("close")}>▸ TV CLOSE</button>
    </div>
  );
}

// Self-dismissing toast for TV hand-off feedback. Lives inside the LIVE
// pane; auto-hides after 3s.
function TvToast({ message, onClose }) {
  useEffectL(() => {
    const id = setTimeout(onClose, 3000);
    return () => clearTimeout(id);
  }, [onClose]);
  if (!message) return null;
  return (
    <div className="tv-toast">
      <b>TV HAND-OFF · </b>{message}
    </div>
  );
}
```

- [ ] **Step 6: Add the BrainNarrationBlock component**

Right after `TvToast`, insert:

```jsx
// Latest bar-read message rendered as a quoted brain narration. Source:
// useChat().messages filtered to type === "bar-read". Hides when no
// bar-read has been emitted yet.
function BrainNarrationBlock({ messages }) {
  const m = latestBarReadMessage(messages);
  if (!m) return null;
  return (
    <div className="brain-narration">
      <div className="head">BRAIN · LAST BAR · {m.t}</div>
      <div className="body" dangerouslySetInnerHTML={{ __html: m.body }} />
    </div>
  );
}
```

- [ ] **Step 7: Add the InTrade sub-state component**

Right after `BrainNarrationBlock`, insert:

```jsx
// Adapt the in-trade summary header — derives status pill from trade
// state/outcome. Mirrors the existing adaptTakenTrade for consistency
// but pares down to what InTrade displays in the header.
function tradeHeaderInfo(trade) {
  if (!trade) return null;
  const ageMin = trade.ts ? Math.floor((Date.now() - new Date(trade.ts).getTime()) / 60000) : null;
  let status;
  if (trade.outcome === "TP1_HIT" || (trade.state === "filled" && trade.tp1_hit)) status = "TP1 HIT · runner";
  else if (trade.outcome === "TP2_HIT") status = "TP2 HIT";
  else if (trade.outcome === "STOPPED") status = "STOPPED";
  else if (trade.outcome === "INVALIDATED") status = "INVALIDATED";
  else if (trade.state === "pending_entry") status = "PENDING ENTRY" + (ageMin ? ` · ${ageMin}m` : "");
  else if (trade.tp1_hit) status = "FILLED · BE stop";
  else if (trade.state === "filled") status = "FILLED";
  else status = "OPEN";
  return {
    id: trade.id || "—",
    model: trade.model || "—",
    side: trade.side || "long",
    grade: trade.grade || "—",
    status,
    ageMin,
  };
}

// IN-TRADE sub-state — hybrid layout: dedicated panel at top, chat + history
// continue below. Replaces the previous TradeCard embed for active trades.
function InTrade({ trade, chatMessages, loopDown, loopStale, alerts, onArmPrice, onTvHandoff }) {
  const { close: lastClose } = useLastBar();
  const grid = liveGridFromTrade(trade, lastClose);
  const head = tradeHeaderInfo(trade);
  const fmtPx = (n) => {
    if (typeof n !== "number") return String(n ?? "");
    const [whole, dec = ""] = String(n).split(".");
    const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
  };
  return (
    <>
      {loopDown && (
        <div className="banner">
          <span className="glyph">● LOOP DOWN</span>
          <span className="txt">bar-close detector not reporting</span>
          <span className="sub">RESTART</span>
        </div>
      )}
      {!loopDown && loopStale && (
        <div className="banner" style={{ borderColor: "var(--amber, #d4a657)", color: "var(--amber)" }}>
          <span className="glyph">● LOOP STALE</span>
          <span className="txt">detector heartbeat slow · trade ticking may lag</span>
        </div>
      )}

      <section className="panel intrade-panel">
        <header className="panel-head">
          <span className="title">IN-TRADE</span>
          <span className="meta">
            #{head?.id} · {head?.ageMin != null ? `${head.ageMin}m old` : ""}
          </span>
        </header>
        <div className="trade-head">
          <span className="id">{head?.model}</span>
          <span className={"side " + (head?.side === "short" ? "short" : "long")}>
            {String(head?.side || "").toUpperCase()}
          </span>
          <Grade value={head?.grade} />
          <span className="status">{head?.status}</span>
        </div>

        <div className="live-grid-2x2">
          <LiveCell k="PRICE"    v={grid.price.v}  sub={grid.price.sub}  tone={grid.price.tone} />
          <LiveCell k="P&L"      v={grid.pnl.v}    sub={grid.pnl.sub}    tone={grid.pnl.tone} />
          <LiveCell k="TO TP1"   v={grid.toTp1.v}  sub={grid.toTp1.sub}  tone={grid.toTp1.tone} />
          <LiveCell k="TO STOP"  v={grid.toStop.v} sub={grid.toStop.sub} tone={grid.toStop.tone} />
        </div>

        <div style={{ padding: "0 14px 6px" }}>
          <Row k="Entry / Stop" v={`${fmtPx(trade.entry)} / ${fmtPx(trade.stop)}${trade.tp1_hit ? " · BE" : ""}`} tone="num" />
          <Row k="TP1 / TP2"    v={`${fmtPx(trade.tp1)} / ${fmtPx(trade.tp2)}`} tone="num green" />
        </div>

        <TvHandoffActions onAction={onTvHandoff} />
      </section>

      <BrainNarrationBlock messages={chatMessages} />
    </>
  );
}
```

- [ ] **Step 8: Refactor EntryHunt → EntryHuntView with Step5n6Panel insertion**

The existing `EntryHunt` function (around line 385) does many things — chat + setup card + history + rejected + pillar alignment. Keep that flow, but:

1. Rename it to `EntryHuntView`
2. Insert `<Step5n6Panel activeSetup={activeSetup} />` between the SETUPS & TRADES section-head and the SetupCard render

Find the existing `function EntryHunt(...)`. Rename:

```jsx
function EntryHuntView({ loopDown, loopStale, noSetups, alerts, onArmPrice }) {
```

Then find this block inside the function (around line 511-516):

```jsx
      <SectionHead title="SETUPS & TRADES"
                   count={takenTrade ? "1 active"
                          : setup ? "1 candidate"
                          : noTradeReason ? "no-trade"
                          : "0 candidate"} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {takenTrade && (
          <TradeCard trade={takenTrade} showSnapshot={false} />
        )}
        {!takenTrade && setup && (
```

The active-trade branch (`takenTrade && <TradeCard …>`) is dead in this view now — InTrade owns active trades. Remove the TradeCard line and its conditional. Also remove the `activeTrade`-derived `takenTrade` adapter call inside this function (`const takenTrade = adaptTakenTrade(activeTrade, lastClose);`) — `activeTrade` is no longer needed inside EntryHuntView.

Replace the section above with:

```jsx
      <SectionHead title="SETUPS & TRADES"
                   count={setup ? "1 candidate"
                          : noTradeReason ? "no-trade"
                          : "0 candidate"} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Step5n6Panel activeSetup={activeSetup} />
        {setup && (
```

(Note the change: `{takenTrade && ... } {!takenTrade && setup && (` → `<Step5n6Panel ... /> {setup && (`.)

Also remove the `useLastBar` import inside EntryHuntView's body — it was only used for `lastClose` which is now in InTrade. The `const { close: lastClose } = useLastBar();` line and any related `adaptTakenTrade(activeTrade, lastClose)` reference can be removed. Keep `useActiveSetup` and `useTrades` for the accept/reject flow and rejected list.

Confirm the destructure now reads:

```jsx
  const { activeSetup, noTradeReason, noTradeReasonTs, clearSetup } = useActiveSetup();
  const { activeTrade, accept: acceptApi, reject: rejectApi, rejected, pnl } = useTrades();
```

`activeTrade` is still needed for the `pnl` and `rejected` reads, but it's no longer used to render TradeCard.

- [ ] **Step 9: Refactor LiveWorkstation router**

Find the existing `LiveWorkstation` (around line 578) and replace its body with:

```jsx
function LiveWorkstation({ subState, loopDown, loopStale, noSetups, alerts, onArmPrice }) {
  // Hoist data sources that the router needs to choose a sub-state.
  const { activeTrade } = useTrades();
  const { messages: chatMessages } = useChat();

  // TV hand-off toast — local state, self-dismisses after 3s.
  const [tvToast, setTvToast] = useStateL(null);
  const handleTvHandoff = (action) => {
    setTvToast(TV_HANDOFF_TOASTS[action] || "");
    // Focus the TradingView chart pane so the trader's eyes go there.
    const chartHost = document.querySelector(".chart-pane");
    if (chartHost) chartHost.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // InTrade takes priority over the open-reaction / entry-hunt subState.
  if (activeTrade) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", position: "relative" }}>
        {tvToast && <TvToast message={tvToast} onClose={() => setTvToast(null)} />}
        <InTrade
          trade={activeTrade}
          chatMessages={chatMessages}
          loopDown={loopDown}
          loopStale={loopStale}
          alerts={alerts}
          onArmPrice={onArmPrice}
          onTvHandoff={handleTvHandoff}
        />
        {/* Chat + setup history still live below the IN-TRADE panel so
            the trader can ask questions mid-trade. */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <SectionHead title="CLAUDE · CONVERSATION" count={sessionLabel()} />
          <EntryHuntChat alerts={alerts} onArmPrice={onArmPrice} />
        </div>
      </div>
    );
  }

  if (subState === "open-reaction") {
    return <OpenReactionView loopDown={loopDown} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <EntryHuntView
        loopDown={loopDown}
        loopStale={loopStale}
        noSetups={noSetups}
        alerts={alerts}
        onArmPrice={onArmPrice}
      />
    </div>
  );
}
```

- [ ] **Step 10: Add the EntryHuntChat sub-component**

The InTrade branch above renders an `EntryHuntChat` for the "chat below the InTrade panel" pattern. This is a slim wrapper around the existing chat code in EntryHuntView. Right before `LiveWorkstation`, add:

```jsx
// Chat-only view used INSIDE the InTrade branch — the full EntryHuntView
// would render setup-card + history which are noisy when you're in trade.
// This keeps just the chat feed accessible.
function EntryHuntChat({ alerts, onArmPrice }) {
  const { messages, typing, send: submit, cancel, reset, queuedBehind } = useChat();
  return (
    <>
      {queuedBehind && (
        <div style={{
          padding: "6px 14px",
          background: "var(--surface-1)",
          color: "var(--amber)",
          fontSize: 10,
          fontFamily: "ui-monospace, Menlo, monospace",
          letterSpacing: ".08em",
          borderBottom: "1px solid var(--border-dim, #1e2228)",
        }}>
          QUEUED · waiting on {queuedBehind} turn to finish
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ClaudeFeed messages={messages} typing={typing} onSubmit={submit}
                    onCancel={cancel} onReset={reset}
                    onArmPrice={onArmPrice}
                    armedPrices={alerts ? new Set(Object.values(alerts.armed || {})) : null}
                    firedPrices={alerts ? new Set((alerts.fired || []).map((f) => f.px)) : null} />
      </div>
    </>
  );
}
```

- [ ] **Step 11: Confirm the export at the bottom is unchanged**

The final export line should still read:

```jsx
export { LiveWorkstation };
```

- [ ] **Step 12: Smoke-check the file**

Run:
```bash
node -e "const fs = require('fs'); const src = fs.readFileSync('app/renderer/src/Live.jsx', 'utf8'); console.log('lines:', src.split('\\n').length); const open = (src.match(/{/g) || []).length; const close = (src.match(/}/g) || []).length; console.log('braces:', open, '/', close, '(diff', open - close, ')');"
```

Expected: line count around 700-800; brace diff small (≤ 5 due to JSX `{expression}` noise).

- [ ] **Step 13: Run full test suite**

Run: `npm run test:unit && npm run smoke:fixtures`
Expected: tests pass (~284), fixtures still 16/16.

- [ ] **Step 14: Commit**

```bash
git add app/renderer/src/Live.jsx
git commit -m "$(cat <<'EOF'
feat(live): restructure into three explicit sub-states

- LiveWorkstation router hoists useTrades + useChat; activeTrade
  branches into the new InTrade panel
- OpenReactionView wraps OpenReactionTracker + SessionLiquidityPanel
  (STEP 4 prefix on the existing tracker title)
- EntryHuntView (renamed from EntryHunt) keeps chat + SetupCard +
  history; gains a STEP 5+6 ENTRY MODEL + CONFIRMATION panel above
  the SetupCard (renders only when activeSetup exists)
- InTrade panel is new: trade header, LIVE GRID 4-cell (PRICE /
  P&L / TO TP1 / TO STOP), risk plan rows, TV hand-off buttons
  (▸ TV STOP / ▸ TV SCALE / ▸ TV CLOSE), BRAIN narration sourced
  from latest bar-read message. Chat + setup history persist
  below so trader can still ask questions mid-trade.
- TvToast is a transient banner that fires on TV-handoff click;
  the chart pane scrolls into view so the trader's eyes go there.

Same data wiring. No IPC changes. No schema changes. Stop-to-BE
automation is unchanged (already happens on TP1_HIT via the
trade-ticker pipeline).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full integration test + manual sanity

**Files:** none

- [ ] **Step 1: Run all tests one more time**

Run: `npm run test:unit`
Expected: all tests pass — baseline (267) + ~17 new helper = ~284.

- [ ] **Step 2: Run smoke fixtures**

Run: `npm run smoke:fixtures`
Expected: same count as baseline (16/16). No regression expected — LIVE redesign doesn't touch the analyze pipeline.

- [ ] **Step 3: Boot the renderer**

Run: `cd app && npm run dev`
Expected: Vite + Electron boot. Navigate to LIVE.

Verify each sub-state manually:

- **OpenReaction state**: trigger by switching to "open-reaction" sub-state (via the tweaks panel if available, or by waiting for the natural 09:30-09:45 window). Confirm:
  - Title reads `STEP 4 · NY OPEN LTF BIAS` (not `OPEN REACTION · LATEST READ`).
  - SESSION LIQUIDITY panel renders below the latest read with brief key_levels.

- **EntryHunt state, no active setup**: confirm `[ WATCHING ]` empty state, no STEP 5+6 panel.

- **EntryHunt state with active setup**: confirm STEP 5+6 panel renders above SetupCard with 4 confirmation rows. ✓ / · markers reflect element status. Accept/reject buttons on SetupCard still work.

- **InTrade state**: accept a setup to trigger. Confirm:
  - The whole pane switches to InTrade layout.
  - IN-TRADE panel renders with header, LIVE GRID 4-cell, risk plan rows.
  - TV hand-off buttons render below; clicking each one shows the toast and scrolls the chart pane into view.
  - BRAIN narration block renders if a bar-read message exists.
  - Chat feed still works at the bottom.

- **Light theme**: toggle and confirm all new classes are readable.

If anything is broken, fix and commit. Note: this is a renderer-only change with significant churn — be prepared to iterate.

- [ ] **Step 4: Commit any fix-up**

If you made small visual fixes:

```bash
git add app/renderer/src/Live.jsx app/renderer/src/app.css
git commit -m "fix(live): light-theme + sub-state polish

Co-Authored-By: Claude <noreply@anthropic.com>"
```

(Skip if nothing needed.)

---

### Task 8: CLAUDE.md decisions row

**Files:**
- Modify: `CLAUDE.md` (append row to "Architecture decisions" table after the PREP redesign row).

- [ ] **Step 1: Find the PREP redesign row**

Run: `grep -n "PREP panel redesign" CLAUDE.md`
Expected: one match. Insert after the PREP row, before the `## Repo` heading.

- [ ] **Step 2: Insert the LIVE decisions row**

Replace the line just before `## Repo` (which is the PREP row line):

Find:
```
| 2026-05-27 | PREP panel redesign — checklist-mirror layout | ... |

## Repo
```

Add a new row immediately after the PREP row (before `## Repo`):

```
| 2026-05-27 | LIVE panel redesign — three explicit sub-states | Restructure LIVE around three deliberate layouts routed by data (activeTrade → InTrade; subState=open-reaction → OpenReaction; else → EntryHunt). **OpenReaction** gains STEP 4 prefix on the existing tracker + a new SESSION LIQUIDITY panel that reads `useSessionBrief().brief.key_levels` (no new IPC). **EntryHunt** gains a STEP 5+6 ENTRY MODEL + CONFIRMATION panel above SetupCard with explicit PD-tap / 1m close / 5m close / clean-delivery checks (substring-matched against `activeSetup.pillar_breakdown[Pillar 3].elements`); SetupCard + accept/reject unchanged. **InTrade** is new and dedicated: trade header, LIVE GRID 4-cell (PRICE / P&L / TO TP1 / TO STOP), risk plan rows, three TV hand-off buttons (`▸ TV STOP` / `▸ TV SCALE` / `▸ TV CLOSE` — fire a toast + scroll the chart pane into view; no broker writes per CLAUDE.md constraint #2), and a BRAIN narration block sourced from the latest `useChat().messages` filtered to `type === "bar-read"`. Chat + setup history persist below the IN-TRADE panel (hybrid layout) so the trader can ask questions mid-trade. Stop-to-BE automation unchanged (already happens on TP1_HIT via `trade-ticker.js`). Pure helpers extracted to `app/renderer/src/Live.helpers.js` (4 exports — `selectPillar3`, `pillar3ToConfirmationRows`, `liveGridFromTrade`, `latestBarReadMessage`) for `node --test` coverage. **Tests:** +17 helper unit tests (~284 total). Spec: [docs/superpowers/specs/2026-05-27-live-panel-redesign.md](docs/superpowers/specs/2026-05-27-live-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-live-panel-redesign.md](docs/superpowers/plans/2026-05-27-live-panel-redesign.md). |
```

- [ ] **Step 3: Verify**

Run: `grep -n "LIVE panel redesign" CLAUDE.md`
Expected: one match.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude): log LIVE redesign in decisions table

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Push + PR

**Files:** none

- [ ] **Step 1: Final test pass**

Run: `npm run test:unit && npm run smoke:fixtures`
Expected: all green.

- [ ] **Step 2: Verify commits**

Run: `git log --oneline main..HEAD`
Expected: 7-9 commits, all scoped to one task each.

- [ ] **Step 3: Push**

Run: `git push -u origin feat/live-panel-redesign`
Expected: branch pushed.

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat(live): three-sub-state redesign — InTrade + STEP 5+6 + SESSION LIQUIDITY" --body "$(cat <<'EOF'
## Summary

- Restructure LIVE around three explicit sub-states (`OpenReaction` / `EntryHunt` / `InTrade`) routed by data — `activeTrade` takes priority and shows the new IN-TRADE panel; else the existing `subState` controls EntryHunt vs OpenReaction.
- **OpenReaction** gains STEP 4 prefix + SESSION LIQUIDITY panel from brief key_levels.
- **EntryHunt** gains a STEP 5+6 ENTRY MODEL + CONFIRMATION panel above SetupCard with PD-tap / 1m close / 5m close / clean-delivery checks (substring-matched against the active setup's pillar 3 elements). SetupCard + accept/reject unchanged.
- **InTrade** is new: dedicated panel with trade header, LIVE GRID 4-cell (PRICE / P&L / TO TP1 / TO STOP), risk plan, BRAIN narration from latest bar-read, and three TV hand-off buttons (`▸ TV STOP` / `▸ TV SCALE` / `▸ TV CLOSE`). Buttons fire a toast and scroll the chart pane into view; no broker writes.

Same data hooks. No IPC changes. No schema changes. Stop-to-BE automation unchanged (already happens on TP1_HIT via `trade-ticker.js`). Pure helpers extracted to `Live.helpers.js` for `node --test` coverage.

**Scope:** LIVE panel only. PREP shipped in [#65](https://github.com/ghxstofnq/claude-tradingview-analyser/pull/65). REVIEW + util pages are next (panel-by-panel scope agreed with user).

Spec: [docs/superpowers/specs/2026-05-27-live-panel-redesign.md](docs/superpowers/specs/2026-05-27-live-panel-redesign.md)
Plan: [docs/superpowers/plans/2026-05-27-live-panel-redesign.md](docs/superpowers/plans/2026-05-27-live-panel-redesign.md)

## Test plan

- [x] `npm run test:unit` — all green (~284 total: baseline 267 + 17 helper)
- [x] `npm run smoke:fixtures` — 16/16 fixtures unaffected
- [ ] Boot Electron and verify each sub-state renders (OpenReaction with SESSION LIQUIDITY, EntryHunt with STEP 5+6 above SetupCard, InTrade with LIVE GRID + TV buttons + BRAIN narration)
- [ ] Click each TV hand-off button — verify toast appears and chart pane scrolls into view
- [ ] Light theme — confirm all new classes are readable
- [ ] First real trade after merge — verify InTrade panel renders with live price / P&L / TP1 / stop distances

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Report back to the user.

- [ ] **Step 5: Done**

Report the PR URL + final test counts.

---

## Self-Review (run after writing the full plan)

### Spec coverage

- §2.1 OpenReaction (STEP 4 prefix + SESSION LIQUIDITY): covered in Task 6 Steps 2-3.
- §2.2 EntryHunt (STEP 5+6 panel above SetupCard): covered in Task 6 Steps 4, 8.
- §2.3 InTrade (hybrid layout, LIVE GRID, TV buttons, BRAIN, chat below): covered in Task 6 Steps 5-7, 9-10.
- §3 Architecture (router refactor): Task 6 Step 9.
- §4 Data wiring: every cell in the table maps to a hook call in Task 6.
- §5 New components: explicitly listed in Task 6.
- §6 TV hand-off implementation (toast + chart focus): Task 6 Steps 5, 9.
- §7 File-level inventory: every file listed appears in this plan.
- §8 Test plan: Task 3 (helper unit tests) + Task 7 (manual sanity).
- §9 Risks: addressed in code (R1 useSessionBrief reuse — already idempotent; R2 substring matching robust; R3 memoise — N is small so not yet needed; R4 button labels honest).

### Placeholder scan

- No TBDs, no TODOs.
- Every code block is complete and self-contained.
- Every git command is exact.

### Type consistency

- `selectPillar3(pillars)` returns the pillar object or null — consistent across helper, test, Step5n6Panel.
- `pillar3ToConfirmationRows(pillar3)` returns `[{ label, status, detail }]` — consistent across helper, test, Step5n6Panel render.
- `liveGridFromTrade(trade, lastClose)` returns `{ price, pnl, toTp1, toStop }` each `{ v, sub, tone }` — consistent across helper, test, InTrade render. Renders via `<LiveCell k=... v={grid.price.v} sub={grid.price.sub} tone={grid.price.tone} />`. ✅
- `latestBarReadMessage(messages)` returns the message or null — consistent across helper, test, BrainNarrationBlock.
- `LiveCell({ k, v, sub, tone })` — same prop names everywhere.
- `TvHandoffActions({ onAction })` calls `onAction("stop"|"scale"|"close")` — Router uses `handleTvHandoff(action)` which keys into `TV_HANDOFF_TOASTS[action]`. Consistent.

All clear.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-live-panel-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

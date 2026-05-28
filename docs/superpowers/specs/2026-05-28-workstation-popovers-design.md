# Workstation Popovers (PREP / LIVE / REVIEW) — Design Spec

**Date:** 2026-05-28
**Status:** Approved (brainstorm) — pending spec review and writing-plans handoff
**Driver:** make the TV chart the protagonist across every mode by converting the three workstation panels into topbar-anchored popovers (same pattern as CLAUDE / ALERTS / BACKTEST). Mode tabs are retired; the chart fills the entire main area.

## Goal

Replace the existing full-pane `01 PREP / 02 LIVE / 03 REVIEW` mode-switching with anchored dropdown popovers, one per workstation, opened from new topbar cells. The chart becomes the persistent main view. Each popover holds the existing panel's content (lightly restructured for the narrower surface) and conveys at-a-glance state through a badge in its topbar cell.

Success criterion: a trader running the live session sees the chart most of the time, opens PREP / LIVE / REVIEW only when they need to read the structured data, and never loses chart visibility. Topbar badges encode "what's happening" so the trader doesn't need to keep opening popovers to check state.

## Background — why this matters

The trade-off was raised and acknowledged: PREP/LIVE/REVIEW have historically been *stateful working contexts* the trader lives in for hours. Converting them to dismissable popovers regresses the "always-on context" pattern. The user wants this anyway because:

- The chart is the most information-dense surface and they want it bigger
- The topbar badge vocabulary can convey enough state that constant re-opening is rare
- Consistency with BACKTEST/CLAUDE/ALERTS reduces cognitive load (one interaction model, not three)
- The existing essentialist redesigns already reduced PREP/LIVE/REVIEW density, so the content fits

The cost is real and accepted: in-trade especially loses some persistent visibility. Mitigated by the LIVE cell's tri-state badge (dim IDLE / amber HUNT pulse / green-or-red live P&L) which shows trade state without opening the popover.

User-stated intent:
> "Convert PREP, LIVE and REVIEW into popovers like backtest. Make sure you get it right."

## Scope — what's in v1

In:
- Remove the `01 PREP / 02 LIVE / 03 REVIEW` mode tabs from App.jsx
- Add three new topbar cells (PREP, LIVE, REVIEW) sitting between BACKTEST and CLAUDE, each following the existing `.bt-popover` recipe
- Chart pane fills entire main area below topbar (no more split-pane work-pane)
- Per-popover badges that encode state
- Per-popover bodies built from the existing panel's content, restructured for popover-sized surfaces
- New `prose_summary` field added to `surface_session_brief` and `surface_session_summary` Zod schemas — the BRIEF / WRAP prose blocks
- Existing panel JSX files renamed/restructured into popover bodies; outer `*Workstation` wrappers removed; `.main.split-50` / `.main.split-70` CSS rules deleted
- Hotkeys 1/2/3 retargeted: open PREP / LIVE / REVIEW popovers; Esc closes; clicking another cell auto-closes the prior
- Exclusive-mode handling vs BACKTEST: PREP/LIVE popovers show the same "BACKTEST RUNNING · <session>" placeholder they show today as full-pane components

Out (deferred):
- Multi-popover at once (PREP + LIVE side-by-side) — one popover at a time matches the existing CLAUDE/ALERTS pattern
- Popover position memory across sessions
- Resizable / detachable popovers
- LIVE auto-pin during a trade — explicitly declined by user
- Restoring mode-tabs path as a setting — fresh start, no toggle

## Topbar shape — 7 cells, no mode tabs

Left-to-right after the `GOFNQ` id block:

| Cell | Width | Badge content |
|---|---|---|
| `NEWS` | auto | Existing (red count if high-impact event imminent) |
| `ALERTS` | auto | Existing (amber count if any armed) |
| `BACKTEST` | auto | Existing (count of past runs; pulsing during a run) |
| **`PREP`** *(new)* | auto | Grade pill: `A+` green / `B` amber / `NO` dim / `—` not graded yet |
| **`LIVE`** *(new)* | auto | Tri-state: dim dot + `IDLE`/`DONE`; amber pulse + `HUNT`; green-or-red pulse + live P&L (`+1.2R` / `−0.5R`) |
| **`REVIEW`** *(new)* | auto | Count of confirmed trades pre-session; day P&L color-coded post-session (`+1.7R` green / `−0.5R` red) |
| `CLAUDE` | auto | Existing (count with active green dot when responding) |
| Clock | auto | Existing |

Mode tabs (`01 PREP / 02 LIVE / 03 REVIEW`) are deleted from the JSX. The `mode` React state goes away. `mode:switch` IPC and the corresponding preload exposure (`window.api.mode.switch`) are removed if they're not used elsewhere; otherwise left as no-ops with a deprecation comment for follow-up cleanup.

## Popover widths

- **PREP: 660px**
- **LIVE: 420px always** (HUNT *and* IN-TRADE — narrow surface forces 2×2 LIVE GRID and stacked TV handoffs)
- **REVIEW: 660px**

All use `max-width: calc(100vw - 40px)` for narrow viewports. Same `top: 100%; right: 0; border-top: 0; box-shadow: 0 6px 20px rgba(0,0,0,0.6); z-index: 60` recipe as CLAUDE / ALERTS / BACKTEST.

## PREP popover (660px)

Order top-to-bottom:

### 1. STATUS STRIP (one line)
- `<date>` `<session-label>` `· chain clean|degraded|backfilled` on the left
- `⟳ refresh` mini-button on the right (re-runs the brief turn; ~$1-2 cost; disabled while a turn is in flight)

### 2. HTF BIAS section
- Three rows (`D / 4H / 1H`), each: TF · `BEAR|BULL|MIXED` bias · 1-line note · draw price (right-aligned)
- No per-row dividers
- Immediately below the three rows, a single emphasized line: `PRIMARY <price> <PDL|PDH|..> · daily draw` (amber + label color)
- No `STEP 1` prefix — section header is just `HTF BIAS`

### 3. LEVELS section
- Section header: `LEVELS`
- Two label-grouped subsections: `ABOVE` then `BELOW`
- Each level row: `60px` name (`PDH`, `AS.L`, etc.) · `1fr` price (right-aligned, tabular-nums) · `18px` bell icon
- **Interactive bells** — click toggles armed/unarmed via existing `window.api.alert.arm({ price, label })` / `window.api.alert.disarm({ id })` IPC. No new IPC, no new server logic — same pipeline today's PREP page uses.
- Armed bell = amber; unarmed bell = label-dim
- No per-row dividers

### 4. PRICE QUALITY section
- Section header: `PRICE QUALITY · <verdict>` (verdict inline: `clean` / `acceptable` / `weak`)
- Single horizontal line: `<range>pt 3h range · <body-ratio> body · <verdict> 15m`
- Color-coded (green for clean, amber for acceptable, red for weak)

### 5. BRIEF · CLAUDE section (NEW — schema extension)
- Section header: `BRIEF · CLAUDE`
- Prose paragraph in narration style: blue left-border (`border-left: 2px solid var(--blue)`), `surface-2` background, `var(--prose)` color text, line-height 1.65
- Timestamp at top: `<HH:MM> ET · <grade> pre-session`
- 2-4 sentences of Claude's own-words synthesis of the brief. Color-coded emphasis: `var(--red)` for bearish, `var(--amber)` for primary draw, `var(--green)` for clean signals, `var(--value)` bold for key numbers
- **Schema change**: `surface_session_brief` Zod schema gains `prose_summary: z.string().min(50).max(1000)` field. The brief prompt is updated to ask Claude to write this prose summary as part of its output. Stored in `brief.json` alongside structured fields. If absent (legacy briefs), the section shows "No prose summary in this brief" placeholder.

### 6. SCENARIOS section
- Section header: `SCENARIOS · <count>`
- Each scenario is a bordered card (`.scn`):
  - Header line: title text + grade pill (`A+` / `B` / `NO`)
  - Body: prose description with bold-highlighted key elements (`sweep PDH 29105 + 1m back inside → target 29050 PDL, RR 1:1.2`)
  - `no-trade` scenarios use `dim` body color

### PREP empty state (no brief yet)
- Single section with the STATUS STRIP (showing today's date + session, `no brief yet` substring)
- Below: centered prose `No brief for today's <session> yet.`
- Big amber button: `▶ RUN BRIEF NOW` — fires the same brief turn the scheduled `session-brief.js` runs. Same backend path; just manual trigger.

## LIVE popover (420px always)

Driven by `sub-state` derived from `useLive()` hook:
- `subState === "in-trade"` → IN-TRADE body
- `subState === "open-reaction"` → OPEN REACTION body
- `subState === "entry-hunt"` → ENTRY HUNT body
- `subState === "idle"` → IDLE body (no session active)
- `subState === "done"` → DONE body (session ended)

### IN-TRADE body
- **Trade header** (one line, wraps if needed): trade id · `SHORT|LONG · MODEL` · grade pill · age
- **LIVE GRID** — 2×2 grid (not 4-wide; 420px forces this):
  - `PRICE` (last bar)
  - `P&L` (live R, color-coded)
  - `→ TP1` (distance, green)
  - `→ STOP` (distance, default color)
  - Each cell: 9px uppercase k-label, 16px bold tabular value, optional 10px sub
- **Risk plan** — 4 rows (90px label / 1fr value): ENTRY · STOP · TP1 · TP2
- **TV handoffs** — 3 buttons in one row: `▸ TV STOP` (amber) / `▸ TV SCALE` (amber) / `▸ TV CLOSE` (red)
  - **No broker writes** (per CLAUDE.md #2). Each button: scrolls TV chart pane into view + fires a transient toast (`drag your stop to 29105 in the chart` / `scale 50% off here` / `close at market`). Trader executes the actual TV action manually.
- **BRAIN** section — narration block (existing `.trade-narration` style): last 3 bar-read messages from `useChat()` filtered to `type === "bar-read"`
- **SETUP HISTORY · TODAY** — compact setup-card list of today's confirmed entries (read-only)

### HUNT body (OPEN REACTION or ENTRY HUNT)
- Section header dynamically reflects sub-state: `STEP 4 · OPEN REACTION` or `STEP 5+6 · ENTRY MODEL + CONFIRMATION`
- **Pillar 3 confirmation rows** (compact 90px / 1fr): MODEL · PD TAP · 1m CLOSE · 5m CLOSE · DELIVERY — each value is `✓` (green) or `✗` (red) or pending text
- **SURFACED SETUP** section (only when a setup is live):
  - Setup card: grade pill, side, model, timestamp + 3-column ENTRY/STOP/TP1 grid
  - Two big decision buttons: ✓ ACCEPT (green) / ✗ REJECT (red) — same pattern as backtest pause-on-setup
- On ACCEPT, body swaps in-place to IN-TRADE (popover stays open, state hook re-reduces)

### IDLE body (no session active)
- Empty state: `No session active — next session opens at <HH:MM> ET (<session-name>)`
- Compact rows showing today's date + the next session window

### DONE body (session ended)
- Read-only snapshot of the last session's wrap output (mirror of the WRAP · CLAUDE prose from REVIEW)
- Link to open REVIEW popover with the full content

## REVIEW popover (660px)

Order top-to-bottom:

### 1. STATUS STRIP (one line)
- `<date>` `<session>` `· <pre-session-grade>` `· chain clean|degraded` on the left
- `↗ export json` and `📓 journal` mini-buttons on the right

### 2. WRAP · CLAUDE section (NEW — schema extension)
- Section header: `WRAP · CLAUDE`
- Same prose style as PREP's BRIEF · CLAUDE block (blue left-border, surface-2 bg, prose color)
- Timestamp: `<HH:MM> ET · session closed`
- 2-4 sentences from Claude on what happened, calling out lessons for next session
- **Schema change**: `surface_session_summary` Zod schema gains `prose_summary: z.string().min(50).max(1000)` field. Written to `summary.json` alongside structured fields.

### 3. CANDIDATE LEDGER section
- Existing `lib-table` style — `width: 100%; border-collapse: collapse`
- Columns: `TS` · `GRADE` (pill) · `SIDE` · `MODEL` · `STATE` (pill) · `REASON / R` · `▾` (expand)
- First/last `td` and `th` cells use `padding-left: 0` / `padding-right: 0` so the TS column aligns with the section's 14px left edge (matches `cross-day lessons`, `05-27` library dates, etc.)
- Click `▾` to expand a confirmed row inline into a full TradeCard (reuses `app/renderer/src/Shared.jsx` `<TradeCard>`)

### 4. AGENT STATE section
- 3 generic `.row` (`150px / 1fr`):
  - `cross-day lessons` — count + char usage
  - `trader profile` — count + char usage
  - `last memory write` — timestamp + first line

### 5. SESSION LIBRARY · LAST 5 section
- Compact `.lib-row` grid (5-column: `55px date / 70px session / 1fr spacer / 65px pnl right-aligned / 80px wl right-aligned`)
- Each row is clickable — loads that session's REVIEW (replaces the popover body with the selected session)
- 5 rows shown by default; "VIEW ALL N RUNS →" at the bottom if more

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                                    │
│                                                                      │
│  App.jsx (topbar shell)                                              │
│   ├─ BacktestCell (existing)                                         │
│   ├─ <PrepCell />     ◄── NEW                                        │
│   ├─ <LiveCell />     ◄── NEW                                        │
│   └─ <ReviewCell />   ◄── NEW                                        │
│                                                                      │
│  PrepPopover.jsx   ◄── renamed from Prep.jsx; outer Workstation gone │
│  LivePopover.jsx   ◄── renamed from Live.jsx                         │
│  ReviewPopover.jsx ◄── renamed from Review.jsx                       │
│                                                                      │
│  hooks/usePrep.js     ◄── NEW (parallel to useBacktest)              │
│  hooks/useLive.js     ◄── NEW                                        │
│  hooks/useReview.js   ◄── NEW                                        │
│  (existing useSessionBrief / useSetups / useTrades stay underneath)  │
│                                                                      │
│  Backtest.helpers.js                          (existing)             │
│  Prep.helpers.js     (existing — unchanged; reused by PrepPopover)   │
│  Live.helpers.js     (existing — unchanged)                          │
│  Review.helpers.js   (existing — unchanged)                          │
│                                                                      │
│  Removed: <PrepWorkstation />, <LiveWorkstation />, <ReviewWorkstation /> │
│  Removed: .main.split-50, .main.split-70 CSS rules                   │
│  Removed: `mode` React state + mode:switch IPC plumbing              │
│                                                                      │
│  Each *Cell component: thin wrapper that owns open/close state,      │
│  reads from its *Popover hook, mounts the *Popover body when open.   │
│  Same recipe as BacktestCell from BacktestPopover.jsx.               │
└──────────────────────────────────────────────────────────────────────┘
```

### Hooks shape

`usePrep()`, `useLive()`, `useReview()` each return `{ state, actions }`, modeled on `useBacktest()`. They consume the existing data hooks (`useSessionBrief`, `useSetups`, `useTrades`, `useChat`) and expose just what the popover body needs.

- **usePrep**: `state = { brief, recap, isLoading, hasError }`; `actions = { runBrief, refresh, armLevel(price, label), disarmLevel(id) }`
- **useLive**: `state = { subState, activeTrade, surfacedSetup, lastBarReadMessage, ltfBias }`; `actions = { acceptSetup(setup), rejectSetup(id, reason), tvHandoff(kind) }`
  - `subState` is derived: `if activeTrade → "in-trade"; else if surfacedSetup → "entry-hunt"; else if openReaction → "open-reaction"; else if sessionDone → "done"; else "idle"`
- **useReview**: `state = { ledger, summary, agentState, library }`; `actions = { exportJson, openJournal, selectSession(date, session) }`

### Schema extensions

Two Zod schemas grow one field each:

```ts
// app/main/tools/surface.js
const SurfaceSessionBriefSchema = z.object({
  // ...existing fields...
  prose_summary: z.string().min(50).max(1000),  // ← NEW
});

const SurfaceSessionSummarySchema = z.object({
  // ...existing fields...
  prose_summary: z.string().min(50).max(1000),  // ← NEW
});
```

Two prompts updated (`app/main/prompts/phase-brief.md`, `app/main/prompts/phase-wrap.md`) to instruct Claude to write the prose summary in the trader's voice. Existing structured fields stay unchanged.

Backwards compat: existing brief/summary files on disk that lack `prose_summary` render with placeholder text ("No prose summary in this brief / summary") — the popover doesn't crash.

## File reorganization

**Renamed (existing content ported into popover body shape):**
- `app/renderer/src/Prep.jsx` → `PrepPopover.jsx` (exports `<PrepCell />`)
- `app/renderer/src/Live.jsx` → `LivePopover.jsx` (exports `<LiveCell />`)
- `app/renderer/src/Review.jsx` → `ReviewPopover.jsx` (exports `<ReviewCell />`)

**New:**
- `app/renderer/src/hooks/usePrep.js`
- `app/renderer/src/hooks/useLive.js`
- `app/renderer/src/hooks/useReview.js`

**Unchanged (kept):**
- `Prep.helpers.js`, `Live.helpers.js`, `Review.helpers.js` — pure helpers reused by the popovers
- `Shared.jsx` — `<TradeCard>` and other shared components reused in popover bodies
- `BacktestPopover.jsx` + `useBacktest.js` — backtest popover is unaffected by this change

**Removed:**
- `<PrepWorkstation />`, `<LiveWorkstation />`, `<ReviewWorkstation />` (outer full-pane wrappers)
- `<PageShell />` or whatever currently wraps full-pane content
- `.main.split-50`, `.main.split-70`, `.work-pane`, `.chart-host.split-50`, `.chart-host.split-70` CSS rules in `app.css`
- `mode` state in `App.jsx`
- `mode:switch` IPC handler + `window.api.mode.*` preload exposure (if not used elsewhere)

## CSS additions

A new block in `app.css` parallel to the existing `BACKTEST POPOVER` block, scoped to the new popover types. Reuses many existing classes (`.cell.pop-cell`, `.popover .head`, etc.) — only popover-content-specific rules are new (`.lvl-grp`, `.brief-prose`, `.lib-row`, etc.).

## Hotkeys

- `1` / `2` / `3` — open PREP / LIVE / REVIEW popover (toggles open/closed)
- `Esc` — closes any open popover
- Letter keys for other cells inherit existing behavior (CLAUDE, ALERTS, BACKTEST — no change)

If the existing hotkey listener lives in `App.jsx` (`useEffect` with `keydown` listener), retarget the handler functions. If it's elsewhere, find and rewire.

## Exclusive mode with BACKTEST

When a backtest is running (per `useBacktestRunning().running`):
- PREP popover body shows the existing `BACKTEST RUNNING · <session> — LIVE DATA UNAVAILABLE` placeholder
- LIVE popover body shows the same placeholder
- REVIEW popover body **stays usable** (it reads historical state, unaffected by chart being in replay)
- Topbar cells stay clickable (popovers can still open, just show the placeholder body)

This carries the same logic that already exists in `Prep.jsx` / `Live.jsx` today — the check moves from the outer Workstation wrapper into the popover body.

## Testing strategy

Unit (`node --test`):
- `Prep.helpers.js` tests unchanged (already 16+ tests)
- `Live.helpers.js` tests unchanged (already 17+ tests)
- `Review.helpers.js` tests unchanged (already 25+ tests)
- New: `usePrep.test.js` — reducer + state derivation
- New: `useLive.test.js` — `subState` derivation under all 5 sub-state conditions
- New: `useReview.test.js` — library load + session-selection reducer
- New: extend `tests/brief-flow.test.js` to cover the `prose_summary` field in `surface_session_brief`
- New: extend `tests/wrap-flow.test.js` (or equivalent) for `prose_summary` in `surface_session_summary`

Integration:
- Existing `tests/fixtures/*` should still pass — backend behavior is unchanged
- `npm run smoke:fixtures` — should stay 16/16

Manual smoke:
- Open the app, see new topbar cells beside CLAUDE/ALERTS/BACKTEST
- No mode tabs visible
- Click each: PREP/LIVE/REVIEW popovers drop down anchored to their cells
- Click a bell in PREP LEVELS → alert arms (verify via existing ALERTS popover)
- Start a backtest → PREP and LIVE popovers show the placeholder; REVIEW unaffected
- Trigger a brief turn → BRIEF · CLAUDE prose appears in PREP popover
- Enter HUNT → see HUNT body; surface a setup → ACCEPT → body swaps to IN-TRADE without popover closing

## Failure modes

| Failure | Detection | Behavior |
|---|---|---|
| `prose_summary` missing in brief.json (legacy) | absent field after Zod parse | Render "No prose summary in this brief" placeholder; rest of PREP popover renders normally |
| Brief turn fails | `usePrep().state.hasError` | PREP shows error chip + "▶ RUN BRIEF" button to retry |
| Bell click but `alert.arm` IPC rejects | Promise rejects | Toast "alert failed: <reason>"; bell stays unarmed |
| User clicks ACCEPT in HUNT, `acceptSetup` IPC fails | Promise rejects | Toast "couldn't open trade: <reason>"; popover stays in HUNT |
| Session library row click loads new session | async fetch | Popover body shows loading; on response, replaces content; on error, toast + back to current session |

## Out of scope (deferred)

- Multi-popover at once (e.g., PREP + REVIEW side-by-side) — one at a time matches CLAUDE/ALERTS pattern
- Resizable popovers
- Detachable popovers (pop out into separate window)
- LIVE auto-pin during a trade — explicitly declined
- Position memory across app restarts
- "Pin to chart" overlay mode (e.g., persistent risk plan on top of the chart)
- Mode-tabs as an optional setting

## References

- [docs/superpowers/specs/2026-05-28-backtest-popover-design.md](2026-05-28-backtest-popover-design.md) — the BACKTEST popover spec this design mirrors
- [docs/strategy/trading-strategy-2026.md](../../strategy/trading-strategy-2026.md) — the 3-pillar framework these panels surface
- Existing panels: [Prep.jsx](../../../app/renderer/src/Prep.jsx), [Live.jsx](../../../app/renderer/src/Live.jsx), [Review.jsx](../../../app/renderer/src/Review.jsx) — full content ported into popover bodies
- BACKTEST popover: [BacktestPopover.jsx](../../../app/renderer/src/BacktestPopover.jsx) — same recipe applied here
- Mockups (gitignored): `.superpowers/brainstorm/95688-1779939262/content/` — `topbar-cells.html`, `all-popovers.html`, `prep-420-v2.html`, `live-in-trade-420.html`, `review-660.html`

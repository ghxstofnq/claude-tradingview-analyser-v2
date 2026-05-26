# LIVE panel redesign — spec

**Status:** approved (design signed off in brainstorm session 2026-05-27)
**Scope:** `app/renderer/src/Live.jsx` and friends — LIVE mode workstation only.
**Out of scope:** PREP (shipped, PR #65), REVIEW, util pages (System / Risk / Fixtures / Health / Settings), broker integration, real trade-action execution.

---

## 1. Goal

Restructure LIVE so each sub-state (`OpenReaction` / `EntryHunt` / `InTrade`) has a deliberate, focused layout. Promote in-trade state to its own dedicated panel with big readable numbers (LIVE GRID 4-cell), explicit TV hand-off buttons, and a brain narration block sourced from the latest bar-close message. Surface the explicit Pillar 3 confirmation checks during entry hunt (PD tap / 1m close / 5m close / clean delivery) so the trader sees what's pending vs done at a glance. Keep every existing hook and IPC path — additive componentry only.

---

## 2. Locked design (signed off in browser mockups)

Final layout, per sub-state. Sub-state routing in `LiveWorkstation`:

```
if (activeTrade)                    → InTrade
else if (subState === "open-reaction") → OpenReaction
else                                → EntryHunt
```

(Same router shape as today — only the rendered components change.)

### 2.1 OpenReaction (first ~15 min of NY)

1. **STEP 4 · NY OPEN LTF BIAS** — same `OpenReactionTracker` content, with the panel title prefixed `STEP 4 ·`. Latest read paragraph + Bias direction row + Watching row + `+Nm · Mm left` meta.
2. **SESSION LIQUIDITY** (new) — untaken / swept levels from the session brief, rendered as a compact list with state pills (UNTAKEN / SWEPT / TAKEN). Sourced from `useSessionBrief().brief.key_levels` (already in memory, no new IPC).
3. **PREVIOUS READS** — unchanged. Expand/collapse + chronological toggle stays.

### 2.2 EntryHunt (no active trade, hunting)

1. **CLAUDE · CONVERSATION** — unchanged. ClaudeFeed + composer + queued-behind hint + loop banners.
2. **STEP 5+6 · ENTRY MODEL + CONFIRMATION** (new) — renders ONLY when `activeSetup` exists. Sub-sections:
   - **MODEL** — one row: `Active: {model} · {pending|valid}` (derived from `activeSetup.confirmation_status` and `pillar_breakdown[2].status`).
   - **CONFIRMATION** — four rows with ✓ / · markers, matched by name substring against `pillar_breakdown[2].elements`:
     - "PD-array tap" → `/pd|tap/i`
     - "1m close past structure" → `/1m/i`
     - "5m close past structure" → `/5m/i`
     - "Clean delivery" → `/delivery|clean/i`
3. **ACTIVE SETUP** — SetupCard unchanged. Accept/Reject buttons stay. The full card sits BELOW the new STEP 5+6 panel so the trader sees confirmation status, then the setup, then can act.
4. **SETUP HISTORY** — unchanged.
5. **REJECTED · THIS SESSION** — unchanged.
6. **PILLAR ALIGNMENT** — unchanged (still shows full pillar drilldown when `activeSetup.pillar_breakdown` exists).
7. **No-setup empty states** — `[ WATCHING ]` and `[ NO-TRADE ]` unchanged. The new STEP 5+6 panel hides when no `activeSetup`.

### 2.3 InTrade (hybrid layout — active trade present)

1. **SESSION P&L line** — unchanged (compact bar above the IN-TRADE panel).
2. **IN-TRADE** (new dedicated panel) — replaces the embedded `TradeCard` for active trades. Contents top to bottom:
   - **Header row**: id · model · side pill · grade pill · status pill ("FILLED · BE stop" / "PENDING ENTRY · 2m" / "TP1 HIT · runner") · age.
   - **LIVE GRID** (4 cells, 2×2): `PRICE` (live close + `+/-N from entry` subtitle), `P&L` (` $ X` + `N R` subtitle, green/red), `TO TP1` (pts + `pts` subtitle, green), `TO STOP` (pts + `pts (BE)` or `pts` subtitle, red).
   - **Risk plan rows**: `Entry / Stop · BE` (one row), `TP1 / TP2` (one row).
   - **ACTIONS row** (TV hand-off): three buttons — `▸ TV STOP`, `▸ TV SCALE`, `▸ TV CLOSE`. Each click fires a toast ("Modify your stop in TradingView") and focuses the TradingView chart pane. No broker integration; no order execution.
3. **BRAIN narration block** (new) — sources the latest `m.type === "bar-read"` message from `useChat().messages` and renders its body in a blue-accent block: `BRAIN · LAST BAR · {timestamp}` header + body. Hides when no bar-read message exists.
4. **CLAUDE · CONVERSATION** — unchanged. Stays below the IN-TRADE panel so the trader can still ask questions mid-trade.
5. **SETUP HISTORY** — unchanged.

The hybrid pattern: trade info dense at the top, chat + history persist below as scrollable secondary content. Trader is never locked out of asking Claude a question mid-trade.

---

## 3. Architecture — sub-state routing

The existing `LiveWorkstation` router is shape-compatible. The only change is the conditional that picks `InTrade`:

```jsx
function LiveWorkstation({ subState, loopDown, loopStale, noSetups, alerts, onArmPrice }) {
  const { activeTrade } = useTrades();   // ← new: hoist this hook
  if (activeTrade) {
    return <InTrade trade={activeTrade}
                    loopDown={loopDown} loopStale={loopStale}
                    alerts={alerts} onArmPrice={onArmPrice} />;
  }
  if (subState === "open-reaction") {
    return <OpenReactionView loopDown={loopDown} />;
  }
  return <EntryHuntView loopDown={loopDown} loopStale={loopStale}
                        noSetups={noSetups} alerts={alerts}
                        onArmPrice={onArmPrice} />;
}
```

**Reuse note:** the existing `EntryHunt` function is renamed to `EntryHuntView` for clarity (the original holds both EntryHunt-state AND in-trade rendering today — they're split here). `OpenReactionView` wraps `OpenReactionTracker` plus the new `SessionLiquidityPanel`. `InTrade` is new.

---

## 4. Data wiring — no new IPC

Every data source already exists. No new hooks. No new IPC handlers.

| Sub-state | Component | Data source |
|-----------|-----------|-------------|
| OpenReaction | OpenReactionTracker | `useOpenReaction()` (unchanged) |
| OpenReaction | SessionLiquidityPanel (new) | `useSessionBrief().brief.key_levels` |
| EntryHunt | ClaudeFeed | `useChat()` (unchanged) |
| EntryHunt | Step5n6Panel (new) | `useActiveSetup().activeSetup.pillar_breakdown` |
| EntryHunt | SetupCard | `useActiveSetup()` (unchanged) |
| EntryHunt | SetupHistoryList, RejectedSetupsPanel | unchanged |
| InTrade | IN-TRADE header | `useTrades().activeTrade` |
| InTrade | LIVE GRID | `useTrades().activeTrade` + `useLastBar().close` |
| InTrade | Risk plan rows | `useTrades().activeTrade` |
| InTrade | ACTIONS buttons | no data — fire toast + focus chart |
| InTrade | BRAIN narration | `useChat().messages` filtered to `type === "bar-read"`, latest by index |

**`useSessionBrief` in LIVE:** today's LIVE doesn't call this hook. The redesign calls it inside the new `SessionLiquidityPanel`. The hook is idempotent (memoised) so calling it from PREP and LIVE simultaneously is fine; cost is one IPC subscription per mount.

---

## 5. New components

### 5.1 In `app/renderer/src/Live.jsx`

- **`OpenReactionView`** — wraps `OpenReactionTracker` and renders `SessionLiquidityPanel` between the latest read and the previous-reads panel.
- **`SessionLiquidityPanel`** — reads `useSessionBrief().brief.key_levels`, renders them as compact rows (name · price · UNTAKEN/SWEPT pill). Hides when no brief OR no key_levels.
- **`Step5n6Panel({ activeSetup })`** — renders the new STEP 5+6 panel. Returns `null` when `activeSetup` is null. Substring-matches pillar 3 elements via the same pattern as PREP's `selectPillar`. New row component `<ConfirmationRow check={true|false|pending} label="..." detail="..." />` for the ✓/· bullets.
- **`InTrade({ trade, ...passthrough })`** — replaces the embedded `<TradeCard>` for active trades. Internally uses `useLastBar()` to drive the LIVE GRID. New row component for the LIVE GRID `lcell` boxes — moved from a one-off inline render to a named `LiveCell` for clarity.
- **`BrainNarrationBlock({ chatMessages })`** — pure projection: finds the latest `m.type === "bar-read"`, renders its body inside a `.brain` block. Returns `null` when no bar-read exists.
- **`TvHandoffActions({ onAction })`** — three buttons; `onAction(label)` fires the toast and focuses the chart pane.

### 5.2 In `app/renderer/src/Shared.jsx`

- **`LiveCell({ k, v, sub, tone })`** — the 4-cell grid item. `tone` is `"green"|"red"|"amber"|""`. Exported so REVIEW can reuse it (future spec).
- **`SectionHead`** — unchanged but used more (each STEP sub-section in InTrade and Step5n6Panel).

### 5.3 In `app/renderer/src/Live.helpers.js` (new file)

Pure helpers for testability under `node --test`:

```js
// Find Pillar 3 in pillar_breakdown[].
export function selectPillar3(pillars) { ... }

// Map pillar 3 elements to 4 confirmation rows in fixed order.
export function pillar3ToConfirmationRows(pillar3) { ... }

// Compute LIVE GRID data from trade + lastClose.
export function liveGridFromTrade(trade, lastClose) { ... }

// Pick the latest bar-read message from a chat messages array.
export function latestBarReadMessage(messages) { ... }
```

All four are pure functions (input → output, no side effects).

---

## 6. TV hand-off — implementation

The reference shows `MOVE STOP TO BE / TRAIL / SCALE 50% AT TP1 / CLOSE ALL`. Our backend doesn't support any of these. We chose "TV hand-off" — the buttons surface the intent and direct the trader to TradingView's own UI.

**First-ship behaviour:**

- Three buttons labelled `▸ TV STOP`, `▸ TV SCALE`, `▸ TV CLOSE` (the `▸` glyph reads as "go to").
- On click:
  1. Fire a transient toast with action-specific text:
     - `▸ TV STOP` → "Modify your stop in TradingView's right-side panel."
     - `▸ TV SCALE` → "Scale your position in TradingView's order ticket."
     - `▸ TV CLOSE` → "Close your position in TradingView's order ticket."
  2. Focus the TradingView chart pane (the existing left-side webview). Approach: scroll the `.chart-host` element into view + `webview.focus()` if available. If neither works, the toast alone is the affordance.
- **No** CDP-driven clicks, no deep-link URLs, no broker writes. The button is "honest about being a label that points you somewhere."

**Why not the existing CLI's `ui_click`/`ui_evaluate`?** CLAUDE.md hard constraint #2 — "CLI only — no MCP tools." Using CLI helpers from the renderer would mean spawning `./bin/tv` subprocesses on every button click. Out of scope; gnarly for first ship. The toast-and-focus path keeps us inside the renderer.

**Stop-to-BE automation is unchanged.** Today the trade-ticker sets `stop_moved_to_be: true` on TP1_HIT. The IN-TRADE panel reflects this — the `Stop · BE` label rendering is driven by `trade.tp1_hit`. No button needed.

---

## 7. File-level inventory

**Created:**
- `app/renderer/src/Live.helpers.js` — four pure helpers (selectPillar3, pillar3ToConfirmationRows, liveGridFromTrade, latestBarReadMessage).
- `tests/live-helpers.test.js` — node test for all four helpers.

**Modified:**
- `app/renderer/src/Live.jsx` — substantial restructure (new `OpenReactionView`, `SessionLiquidityPanel`, `Step5n6Panel`, `InTrade`, `BrainNarrationBlock`, `TvHandoffActions`; existing `EntryHunt` renamed `EntryHuntView`).
- `app/renderer/src/Shared.jsx` — add `LiveCell` export. No changes to existing exports.
- `app/renderer/src/app.css` — additive (`.intrade-panel`, `.live-grid-2x2`, `.live-cell`, `.brain-narration`, `.tv-handoff`, `.step5n6-panel`, `.session-liquidity`). Existing classes untouched.
- `CLAUDE.md` — append a decisions-table row for the LIVE redesign.

**Untouched (explicit non-scope):**
- `app/renderer/src/Prep.jsx` (shipped in PR #65)
- `app/renderer/src/Review.jsx`
- `app/renderer/src/TvChart.jsx`
- All hooks in `app/renderer/src/hooks/`
- `app/main/sdk.js` (no schema change in LIVE redesign — `surface_setup` schema already carries everything we need)
- `app/main/tools/surface.js` and `app/main/trades.js` (no IPC changes)
- `app/main/prompts/analyze.md` (no prompt changes — the model already emits `pillar_breakdown` with 3 pillars on every A+ setup)

---

## 8. Test plan

### Unit (`node --test`)

- `tests/live-helpers.test.js` (new):
  - `selectPillar3` finds Pillar 3 by name substring; returns null when missing.
  - `pillar3ToConfirmationRows` maps elements in fixed order (PD tap / 1m / 5m / delivery), renders missing as "—".
  - `liveGridFromTrade` returns the 4-cell data for a long; tone flips for short; null safety when lastClose is missing.
  - `latestBarReadMessage` finds the latest "bar-read"; returns null when none exists; handles empty arrays.

### Integration (existing harness)

- `npm run smoke:fixtures` — no schema change so the fixture corpus is unaffected. Run as a regression check.
- No new fixtures required (LIVE redesign is renderer-only).

### Manual

- Boot Electron with a recent session in `state/session/`. Navigate LIVE.
- **OpenReaction state**: confirm STEP 4 prefix in title, SESSION LIQUIDITY panel renders with brief key_levels.
- **EntryHunt state with no setup**: confirm `[ WATCHING ]` empty state.
- **EntryHunt state with setup**: confirm STEP 5+6 panel renders above SetupCard with the 4 confirmation checks; ✓/· markers reflect element status.
- **InTrade state**: trigger by accepting a setup. Confirm IN-TRADE panel renders with LIVE GRID, risk rows, ACTIONS buttons, BRAIN narration (if a bar-read exists).
- **TV hand-off**: click each button; confirm toast + chart-pane focus.
- **Light theme**: toggle to light; confirm all new classes have readable colours.

---

## 9. Risks and rollback

### Risks

- **R1 — useSessionBrief from LIVE.** Currently only PREP uses it. Adding LIVE as a second consumer means two simultaneous IPC subscriptions. **Mitigation:** the hook is idempotent (multiple subscribers fan out from one shared poll). Same pattern as `useLastBar` which is already consumed by multiple components.
- **R2 — pillar 3 element naming drift.** The model writes element names freely (`"PD-array tap"` vs `"PD tap"` vs `"PD array tapped"`). Substring matching is robust to most variation, but if a model run produces `"Order block delivery"` for the delivery row, the substring `/delivery|clean/i` still matches via `"delivery"`. If naming changes wholesale, missing rows render as "—" (visible, not silently dropped).
- **R3 — useChat history grows large.** Filtering 2000 messages for bar-reads on every render is O(N) but N=2000 is trivial — measured negligible. **Mitigation:** memoise `latestBarReadMessage` on `messages.length`.
- **R4 — TV hand-off buttons feel hollow.** They don't execute trades. Trader might click expecting an order to fire. **Mitigation:** the `▸` glyph + label ("TV STOP" not "MOVE STOP TO BE") + toast text ("Modify your stop in TradingView") all signal "this directs you somewhere else." Acceptable for first ship — broker integration is a separate, future spec.

### Rollback

- Revert `Live.jsx`, `Shared.jsx` (remove LiveCell), `app.css` (remove new classes), `CLAUDE.md`.
- Delete `Live.helpers.js` + `tests/live-helpers.test.js`.
- Backend untouched — no migration needed.

---

## 10. Decisions log

| # | Decision | Reason |
|---|----------|--------|
| 1 | In-trade layout = HYBRID (top panel + chat/history below) | Trader needs to focus on the trade but also keep chat available for mid-trade questions. REPLACE was too aggressive; OVERLAY was too small. |
| 2 | ACTIONS = TV hand-off (toast + focus chart) | No broker integration today. Buttons surface intent and direct trader to TradingView's own UI. Honest about scope. |
| 3 | EntryHunt restructure = STEP PANEL (add above SetupCard, not replace) | Keep accept/reject flow (regression-risky to rebuild). Add explicit confirmation checks as a sibling. |
| 4 | OpenReaction adds SESSION LIQUIDITY panel from brief key_levels | Trader needs to know what's still in play at the open. Reusing the brief's snapshot avoids new IPC. |
| 5 | BRAIN narration source = latest bar-read chat message | Single source of truth for "what does the brain think right now." No new field needed in `useTrades`. |
| 6 | LIVE GRID = 4 cells (PRICE / P&L / TO TP1 / TO STOP) | Matches reference exactly; covers the four numbers the trader scans every few seconds. |
| 7 | Pillar 3 element matching = by name substring, not index | Same as PREP. Robust to ordering drift in the prompt. |
| 8 | Helpers extracted to `Live.helpers.js` for `node --test` coverage | Same pattern as PREP. Renderer has no Vitest. |
| 9 | `useSessionBrief` callable from LIVE | Already idempotent. No new infrastructure. |

---

## 11. Next step

Hand off to `superpowers:writing-plans` to break this spec into ordered, runnable implementation tasks.

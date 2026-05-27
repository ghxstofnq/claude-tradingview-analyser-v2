# Functionality re-add on top of reference 1:1 port — essentialist spec

**Status:** approved (design signed off in brainstorm session 2026-05-27, final mockup at `.superpowers/brainstorm/82664-1779880567/content/05-essentialist.html`)
**Scope:** `app/renderer/src/` PREP / LIVE / REVIEW panels + new global Claude popover + new NEWS calendar feature.
**Base:** branch `feat/reference-1to1-port` at commit `e23164a` (reference 1:1 port).
**Out of scope:** util pages (System / Risk / Fixtures / Health / Settings) stay on stub data; broker integration; chart redesign.

---

## 1. Goal

Make the dashboard essentialist while staying true to the strategy doc. Each piece of information appears in exactly one place. Reference shape and chrome are preserved. The trader's daily workflow is: see the picture in PREP, act in LIVE, reflect in REVIEW. Claude conversation is global (top-bar popover), not page-bound.

Single big PR.

---

## 2. Design decisions (locked from brainstorm)

### 2.1 Color palette — neutral black (replaces navy blue)

Update `:root` in `app/renderer/src/app.css`:

```css
:root {
  --surface-0: #000000;   /* was #06090f */
  --surface-1: #0a0a0a;   /* was #0a0f18 */
  --surface-2: #131313;   /* was #0d1420 */
  --border:    #1f1f1f;   /* was #1c2333 */
  --border-d:  #2e2e2e;   /* was #3a4456 */
  --label:     #6e6e6e;   /* was #6a7689 */
  --label-dim: #3a3a3a;   /* was #3a4456 */
  /* value / green / amber / red / blue / prose unchanged */
}
```

Accent colors (green / amber / red / blue) stay — they pop more against pure black.

### 2.2 Unified pill / chip / tab / button system

All small interactive or status elements share one size:

```css
.pill {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 10px; height: 22px; min-width: 44px;
  border: 1px solid var(--border-d);
  font-size: 10px; letter-spacing: 0.14em;
  cursor: default;
}
.pill.interactive { cursor: pointer; }
.pill.green { color: var(--green); border-color: var(--green); }
.pill.amber { color: var(--amber); border-color: var(--amber); }
.pill.red   { color: var(--red);   border-color: var(--red); }
.pill.dim   { color: var(--label); border-color: var(--label-dim); }
.pill.active {
  color: var(--amber); border-color: var(--amber);
  background: rgba(235,187,61,0.05);
}
/* Legacy alias — same dimensions */
.grade-pill { /* inherits .pill geometry, same min-width: 44px */ }
```

Apply to every grade pill, chip, tab, header button, and small action button (CLEAN, B, A+, MNQ, MES, REFRESH, EXPORT JSON, ACCEPT, REJECT, TV STOP, etc.). The larger `.btn` class is retired wherever it sat next to a pill.

### 2.3 Top bar — adds CLAUDE popover next to ALERTS

Chip order after the modes:

```
SYM · ET · PH · NEWS · ALERTS · CLAUDE · LOOP · ◐/◑
```

Each chip uses the same `.cell` shell from `app.css`.

**CLAUDE chip:**
- Label `CLAUDE` + a 7px green pulsing dot when chat is active (typing or recent message within 5 min). No count badge.
- Click → opens 420px popover anchored under the chip (same pattern as NewsPopover / AlertsPopover).
- Popover contents: chat header, scrollable feed (reads `useChat().messages`), composer row at the bottom with the existing `> ask claude...` input + `[ STOP ]` / `[ RESET ]` actions.
- Closes on outside click or × button.
- Available from any page (PREP / LIVE / REVIEW / util pages).

Removes inline ClaudeFeed from LIVE entirely — the conversation is now global.

### 2.4 PREP — 5 panels, top to bottom

1. **SESSION BRIEF · &lt;session&gt;** — prose blob from `brief.brief`. Header right side: `<age> old` text · `CLEAN` chain chip (only when non-clean state) · `B` grade pill (rolled-up `brief.pillar_grade`). Bottom of panel, right-aligned row: `[ MNQ ]` · `[ MES ]` (active tab amber-tinted) · `[ REFRESH ]` (all using `.pill.interactive`).
2. **STEP 1 · HTF BIAS** — meta `D / 4H / 1H`. Four rows, all single-line labels (full strategy doc-bullet text in `title=""` tooltip):
   - `Structure` → bias trio (e.g. `BULL / BULL / BULL`)
   - `Best imbalances` → primary draw summary
   - `Main draw` → htf_destination
   - `PD reaction` → reaction quality (e.g. `rejected`)
3. **STEP 2 · OVERNIGHT + LEVELS** — meta `Asia + London`. Rows: `Asia H / L`, `London H / L`, `Overnight`. Sub-sections:
   - `UNTAKEN ABOVE` — untaken levels with `currentPrice > level` (single block per level: marker · name · price · UNTAKEN pill · ○ alert bell). Bell toggles arm/disarm against TV alerts.
   - `UNTAKEN BELOW` — same shape for levels below currentPrice.
4. **STEP 3 · PRICE QUALITY** — three concise rows: `3h range`, `4H/1H displacement`, `15m/5m candles`. Mapped from `brief.pillars[1].elements` via substring matching.
5. **SCENARIOS · IF / THEN** — meta `claude proposed · sizing 2c if A+`. Reference's `.scn` cards: header with id + grade pill, then TRIGGER / ACTION / TARGET rows. Sizing note moves to the panel meta (top-right) since each scenario already has its own target.

Cut entirely:
- `STATUS STRIP` (age/chain/refresh moved into SESSION BRIEF header)
- `PRE-SESSION GRADE` panel (grade in SESSION BRIEF header)
- `CLAUDE PLAN` panel (anchored target lives in scenario `TARGET`; sizing in panel meta)
- `PRIMARY HTF DRAW` panel (already a row in STEP 1)
- `PRICE ALERTS` panel (alert bells in STEP 2)
- `RECAP` panel (load it via SESSION LIBRARY in REVIEW when needed)

### 2.5 LIVE — sub-state routed, no inline chat

**Above the sub-state (conditional):**
- Loop banner — renders only when `health.loop !== "healthy"`. Inline single-line banner above the sub-state panel.
- (No P&L line — visible from trade state itself.)

**Sub-state routing (no change from existing pattern):**

```
if (activeTrade)             → <InTrade />
else if (subState === "open-reaction") → <OpenReactionView />
else                         → <EntryHunt />
```

**OpenReaction (1 panel):**
- `STEP 4 · NY OPEN LTF BIAS` — meta `+<N>m · <M>m left`. Rows: `Window`, `Reaction`, `Outcome`. Sub-section `SESSION LIQUIDITY` inline (rows of key levels with state).

**EntryHunt (1 panel + ChatPopover global):**
- `ENTRY CANDIDATE` — meta `<grade pill> <model> · <SIDE>`. Sections:
  - `CONFIRMATION` — short labels with tooltip: `PD tap` / `1m close` / `5m close` / `Delivery`. Values are `yes` / `—`.
  - `RISK` — broken into separate rows for visual clarity and color coding:
    - `Entry` → default color
    - `Stop` → red
    - `TP1` → green
    - `TP2` → green
    - `R : R` → default
  - Bottom: `[ ACCEPT ]` (green) and `[ REJECT ]` (red) buttons (same `.pill.interactive` dimensions).

**InTrade (1 panel + ChatPopover global):**
- `IN-TRADE` — meta `#<id> · <age> old`. Header row: model · side pill · grade pill · status (`filled · BE stop`). Sections:
  - `Entry` / `Stop · BE` (red) / `TP1` (green) / `TP2` (green) / `Size` — same restructured layout as ENTRY CANDIDATE RISK section.
  - LIVE GRID 4-cell: `PRICE · P&L · TO TP1 · TO STOP` (`.live-grid` class from reference). Wired to `useLastBar.close` + `useTrades.activeTrade`.
  - Action row: `▸ TV STOP` (amber) · `▸ TV SCALE` (amber) · `▸ TV CLOSE` (red). All three are toast + chart focus. No broker writes.
  - Brain narration block inline at the bottom (`.trade-narration` from reference). Reads latest `m.type === "bar-read"` from `useChat.messages`.

Cut from LIVE entirely:
- Inline Claude conversation panels (moved to top-bar popover)
- Setup history list (REVIEW handles past)
- Rejected setups list (REVIEW handles past)
- Pillar alignment panel (covered by ENTRY CANDIDATE's CONFIRMATION)
- Session P&L line (visible from trade state)
- Queued-behind hint (not essential UI; main process logs)

### 2.6 REVIEW — 3 panels

1. **SESSION JOURNAL · &lt;session&gt; · &lt;date&gt;** — header right: `<grade pill>` · `[ EXPORT JSON ]` (using `.pill.interactive`). Body: `summary.bias_picture` prose. No stats grid — counts are visible from the CANDIDATE LEDGER's pill colors.
2. **CANDIDATE LEDGER** — meta `<N> candidates · click confirmed rows to expand`. Chronological rows: `ts · grade (NO/B/A+) · side · model · state pill · reason`. Confirmed/accepted rows expandable — clicking shows an inline TradeCard expansion that uses the same horizontal width as the row above (no negative margin / no widening). State pill at the right side. Reason is one short phrase.
3. **SESSION LIBRARY** — meta `recent · click to load`. Reference's table (`DATE · SESSION · GRADE · CANDS · CONFIRMED`). Clickable rows. Current session row highlighted via `.cur` class.

Cut from REVIEW:
- Stats grid panel section (counts derived from ledger pill distribution)
- BLOCKED MOMENTS placeholder (no data → no panel)
- WATCH NEXT SESSION (will live in SESSION JOURNAL prose if important)
- AGENT STATE panel (moves to System util page, future work)

### 2.7 Concise labels (across all pages)

Long strategy doc-bullet text in `title=""` tooltips on row labels. Visible labels:

| Page | Old label | New label |
|------|-----------|-----------|
| PREP STEP 1 | Structure on D / 4H / 1H — bos / mss direction of each | `Structure` |
| PREP STEP 1 | Best imbalances in that direction (large FVGs / BPRs that took liquidity) | `Best imbalances` |
| PREP STEP 1 | Main HTF draw (next major buy-side / sell-side pool) | `Main draw` |
| PREP STEP 1 | Recent reaction off HTF PD array | `PD reaction` |
| PREP STEP 2 | Asia high / low | `Asia H / L` |
| PREP STEP 2 | London high / low | `London H / L` |
| PREP STEP 2 | Overnight: extending HTF or consolidating | `Overnight` |
| PREP STEP 3 | 3-hour range acceptable (not tiny / choppy) | `3h range` |
| PREP STEP 3 | 4H / 1H candles show real displacement and decent PD array size | `4H/1H displacement` |
| PREP STEP 3 | 15m / 5m candles mainly engulfing, not doji / wick dominated | `15m/5m candles` |
| LIVE ENTRY CONFIRMATION | PD-array tap | `PD tap` |
| LIVE ENTRY CONFIRMATION | 1m close past structure | `1m close` |
| LIVE ENTRY CONFIRMATION | 5m close past structure | `5m close` |
| LIVE ENTRY CONFIRMATION | Clean delivery (no wick rejection) | `Delivery` |

The `.row` label column shrinks from `230px` to `160px`.

---

## 3. New feature — weekly NEWS calendar

### 3.1 Backend (new)

Create `app/main/calendar.js`:

- Fetcher: pulls `https://nfs.faireconomy.media/ff_calendar_thisweek.json` (ForexFactory weekly economic calendar feed).
- Filter: USD events with `impact === "high"` OR `impact === "medium"` only. Drop low-impact and non-USD.
- Cache: `state/calendar/this-week.json`. Refreshed:
  - On boot if file missing or older than 24h
  - Every Monday at 06:00 ET via scheduled-turn cron-style trigger (mirrors existing brief/wrap schedulers)
- Returns the cached payload synchronously to IPC handlers.

### 3.2 IPC

- `window.api.calendar.thisWeek()` → `{ events: [{ ts, currency, event, impact, forecast, previous, released }], fetched_at }`
- `window.api.calendar.onUpdate(callback)` → subscribe to weekly refresh broadcasts.

### 3.3 Renderer

NewsPopover updated:

- Header: `NEWS · THIS WEEK` (left) · `High + medium · ET · refreshed Mon 06:00` (right)
- Grouped by weekday: `MON · MAY 25`, `TUE · MAY 26 · TODAY`, etc. — day dividers use `--surface-2` background.
- Each row: time (ET, tabular-nums) · currency (USD bold) · event name + forecast/previous · impact pill
- Impact pills: red `HIGH` (border + text red), amber `MED` (border + text amber)
- Past events: opacity 0.45
- Today highlighted: day divider includes `· TODAY`
- Imminent event (next non-past within 2 hours): amber background tint, amber left border, label changes to `IN <countdown>` (e.g. `IN 1h 23m`)
- All times in ET, formatted as `HH:MM ET`

NEWS chip in top bar:
- Count badge `N` colored red (high-impact remaining) — total count of high+medium events left this week
- When an event is "imminent" (within 2h): inline countdown text appears after the count — `USD CPI in 1h 23m`
- Countdown ticks every 60s in the renderer

---

## 4. File-level inventory

**Created:**
- `app/main/calendar.js` — ForexFactory fetcher + cache + scheduler hookup.

**Modified:**
- `app/renderer/src/app.css` — palette swap (black) + `.pill` unified class + `.row` label column shrunk to 160px.
- `app/renderer/src/App.jsx` — drop the legacy `useDataAdapter` writes to `window.GOFNQ_DATA` (panels read hooks directly now). Add CLAUDE chip + popover in TopBar. Add NEWS popover wiring to `window.api.calendar.thisWeek()`. Drill `currentPrice` from `useSymbolCache` into PrepWorkstation.
- `app/renderer/src/Prep.jsx` — replace the reference-1:1 body with the essentialist 5-panel layout. Wire to `useSessionBrief`. Add MNQ/MES tabs in SESSION BRIEF panel footer.
- `app/renderer/src/Live.jsx` — replace with essentialist sub-state layout (1 panel per state + global ChatPopover at top bar). No inline Claude conversation, no setup history, no rejected, no pillar alignment.
- `app/renderer/src/Review.jsx` — replace with essentialist 3-panel layout (SESSION JOURNAL + CANDIDATE LEDGER + SESSION LIBRARY). Drop BLOCKED MOMENTS, stats grid, AGENT STATE.
- `app/main/preload.cjs` — add `calendar.thisWeek()` + `calendar.onUpdate(cb)` IPC bindings.
- `app/main/ipc.js` — register `calendar:this-week` handler + push update broadcasts on refresh.
- `app/main/scheduled-turn.js` (or new file) — Monday 06:00 ET refresh schedule.
- `state/` (gitignored) — `calendar/this-week.json` cache file. No commit.
- `CLAUDE.md` — append decisions-table row for the essentialist re-add + NEWS calendar.

**Untouched (explicit non-scope):**
- All util pages (System / Risk / Fixtures / Health / Settings) — stay on window.GOFNQ_DATA stubs
- All hooks in `app/renderer/src/hooks/` — used as-is
- `app/main/sdk.js`, `app/main/tools/surface.js`, `app/main/prompts/analyze.md` — no backend changes
- `app/renderer/src/TvChart.jsx`, persistent chart-host — unchanged
- `app/renderer/src/Shared.jsx` — keep existing exports (TradeCard, ClaudeFeed, etc.) since the popover uses them; no API changes

---

## 5. Component reuse from PR #65 / #66 / #67 (via git history)

Most components are recoverable from main's history — those PRs are landed:

- `useSessionBrief` hook → unchanged, available
- `useSessionRecap` hook → unchanged, available (not used in essentialist; revivable if RECAP returns)
- `useChat` hook → unchanged, used by CLAUDE popover
- `ClaudeFeed` component → in `Shared.jsx` already, used inside CLAUDE popover
- `useTrades` / `useActiveSetup` / `useOpenReaction` / `useReview` / `useLastBar` / `useHealth` / `useSymbolCache` → all available
- Alert wiring (`useAlertStateListener` / `useAlertFiredListener` / `armAlertReal`) → in App.jsx already
- TradeCard → in Shared.jsx, used by inline ledger expand
- buildLedger / deriveLedgerState / etc. (from Review.helpers.js) → already in branch
- PR #65 Prep.jsx layout details (StatusStrip / Step1Panel / etc.) → can `git show 0ea50fe:app/renderer/src/Prep.jsx` for reference, but essentialist version is leaner

Source references (for the implementer):
- PR #65 (Prep) merge: `0ea50fe`
- PR #66 (Live) merge: `3898e29`
- PR #67 (Review) merge: `7359110`

---

## 6. Test plan

### Unit (existing runner)

- `tests/prep-helpers.test.js` — keep.
- `tests/live-helpers.test.js` — keep.
- `tests/review-helpers.test.js` — keep.
- New: `tests/calendar.test.js` — calendar fetcher + filter (HIGH + MEDIUM USD only) + cache write/read + the "is event imminent?" helper.

### Smoke

- `npm run smoke:fixtures` — unaffected.
- `npm run test:unit` — must remain ≥ 309 passing.

### Manual

- **PREP** with real brief: 5 panels render in essentialist order; MNQ/MES tabs switch the brief; alert bells in STEP 2 fire TV alerts; SCENARIOS show grade pills.
- **PREP** with no brief: SESSION BRIEF shows empty state; other panels show "—" gracefully.
- **LIVE** in OpenReaction state: STEP 4 panel only.
- **LIVE** in EntryHunt with active setup: ENTRY CANDIDATE with restructured RISK rows (Entry default, Stop red, TP1/TP2 green) and ACCEPT/REJECT buttons.
- **LIVE** in InTrade: IN-TRADE panel with LIVE GRID + action buttons + brain narration.
- **CLAUDE popover (any page)**: chip clickable; popover opens 420px under chip; chat feed loads from useChat; composer works; STOP/RESET buttons present.
- **NEWS popover (any page)**: chip count = remaining events this week; popover shows weekday-grouped events; past dimmed; imminent highlighted amber; countdown ticks.
- **REVIEW** with session data: SESSION JOURNAL with bias_picture + EXPORT JSON; LEDGER chronological + expand to TradeCard at same width as row; SESSION LIBRARY clickable.
- **Light theme toggle**: all panels readable.
- **Pill uniformity**: all chips/tabs/buttons appear same height (~22px) across the whole app.

---

## 7. Risks and rollback

### Risks

- **R1 — ForexFactory feed availability/format.** The JSON endpoint may break or change. **Mitigation:** wrap fetch in try/catch; if fetch fails, NewsPopover renders cached file; if cache also missing, popover shows empty state with "calendar unavailable" message.
- **R2 — Time zone parsing.** ForexFactory events include UTC timestamps. **Mitigation:** parse strictly to Date, format display via `toLocaleString("en-US", { timeZone: "America/New_York" })`. Test in calendar.test.js with fixtures.
- **R3 — Pill width regression.** Setting `min-width: 44px` on `.pill` may force ugly wrapping if used in a tight grid. **Mitigation:** verify in all use sites (top bar, candidate ledger, scenario cards); fall back to `min-width: 0` for in-table pills if needed.
- **R4 — Black palette legibility.** True black may feel too stark in some monitors. **Mitigation:** keep `--surface-1: #0a0a0a` (panels) slightly lighter so panel boundaries stay visible; user can toggle to light theme if needed.
- **R5 — CLAUDE popover height in small windows.** 500px max-height may overflow on a 720p screen. **Mitigation:** popover uses `max-height: 80vh` if window is < 800px tall.

### Rollback

- Revert this commit. Branch returns to commit `e23164a` (1:1 reference port).
- ForexFactory cache file in `state/calendar/` can be deleted.
- No backend-shape changes that require migration.

---

## 8. Decisions log

| # | Decision | Reason |
|---|----------|--------|
| 1 | Essentialist cuts (10→5 PREP, 6→3 REVIEW) | Each piece of info appears in exactly one place. Redundancy eliminated. |
| 2 | Neutral black palette (no navy tint) | User preference — pops more, no color bias. |
| 3 | Unified `.pill` class (22px height, 44px min-width) | All chips/tabs/buttons must match visually. |
| 4 | CLAUDE conversation as top-bar popover (not inline) | Chat is global, not page-bound. Removes redundancy across LIVE sub-states. |
| 5 | NEWS calendar = high + medium USD events (not just red folder) | Medium-impact events also move price; trader wants the full week view. |
| 6 | Grouped by weekday with "today" highlighted | Trader scans by day, not flat list. |
| 7 | Imminent event highlighted + inline countdown in NEWS chip | Trader needs to know what's next without opening the popover. |
| 8 | RISK rows split into separate Entry/Stop/TP1/TP2 with color coding | Stop in red, TP1/TP2 in green. Eyes hit the numbers faster. |
| 9 | Short labels with `title=""` tooltips for full strategy doc text | Density without losing source-of-truth provenance. |
| 10 | MNQ/MES tabs in SESSION BRIEF panel footer (left of REFRESH) | User-placed; visually grouped with action controls. |
| 11 | Window.GOFNQ_DATA adapter dropped (panels read hooks directly) | Single source of truth per panel. Adapter was bridge code for 1:1 port. |

---

## 9. Next step

Hand off to `superpowers:writing-plans` to break this spec into ordered, runnable implementation tasks.

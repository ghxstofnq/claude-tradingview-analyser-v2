# REVIEW panel redesign — spec

**Status:** approved (design signed off in brainstorm session 2026-05-27)
**Scope:** `app/renderer/src/Review.jsx` and friends — REVIEW mode workstation only.
**Out of scope:** PREP (shipped PR #65), LIVE (shipped PR #66), util pages (Settings / Health / Fixtures / System / Risk), agent state internals (USER.md / MEMORY.md content — just the rendering).

---

## 1. Goal

Restructure REVIEW so the session reads as a chronological narrative. Merge today's separate `ACCEPTED TRADES` (full cards) and `REJECTED / NO-TRADE` (compact rows) sections into a single `CANDIDATE LEDGER` with state pills, sorted by timestamp. Clicking a confirmed/accepted row expands inline to the full TradeCard. The session journal header, watch-next-session, agent state, and library all stay — only the middle changes.

---

## 2. Locked design (signed off in browser mockups)

Final layout, top to bottom:

1. **SESSION JOURNAL** — unchanged header. Brief grade pill + bias_picture + what_happened + stats grid + EXPORT JSON button.
2. **CANDIDATE LEDGER** (new) — chronological list, one row per setup, sorted by `ts` ascending. Each row: `ts · grade · side · model · state pill · reason`. Confirmed/accepted rows are expandable (caret `▾` in the reason column); clicking the row toggles an inline `TradeCard` expansion below it. Non-confirmed rows are read-only — the reason column tells the story.
3. **WATCH NEXT SESSION** — unchanged (when `summary.watch_next_session` is set).
4. **AGENT STATE** — unchanged placement (USER profile card + MEMORY card + TODAY'S SPEND with by-purpose breakdown).
5. **SESSION LIBRARY** — unchanged table (date · session · grade · setups · accepted · net R; current session row highlighted; click to load).

The `ACCEPTED TRADES` and `REJECTED / NO-TRADE` sections in today's code are **removed** — their content is folded into the CANDIDATE LEDGER.

---

## 3. Ledger row format

### 3.1 Columns

| Column | Width | Source | Notes |
|--------|-------|--------|-------|
| `ts`   | 56px  | `setup.ts` (formatted `HH:MM ET`) | Tabular numerals. |
| `grade` | 36px | `setup.grade` mapped — `A+` / `B` / `NO` (was `no-trade`, shortened for narrow column) | Bordered pill. Tones: A+ green, B amber, NO dim grey. |
| `side`  | 44px | `setup.direction` or `setup.side` → `LONG` / `SHORT` | Green for long, red for short. No border. |
| `model` | 64px | `setup.model` (`MSS` / `Trend` / `Inversion` / `—`) | Plain text. |
| `state` | 88px | Derived (see §3.2) — `CONFIRMED` / `STOPPED` / `INVALIDATED` / `REJECTED` / `NO-TRADE` / `OPEN` | Bordered pill, tone matches state. |
| `reason` | 1fr | Derived (see §3.3) | Truncated to fit; full text on hover via `title`. |

The full grid template is `56px 36px 44px 64px 88px 1fr` with `10px` gap. Confirmed/accepted rows get a 2px green left-border + light green background tint, and a `▾` caret appended to the reason column.

### 3.2 State derivation

For each setup row, derive `state` from the setup's `_disposition` + (if accepted) the matching folded trade's `outcome`:

```
_disposition === "no-trade"  → state = "NO-TRADE" (amber)
_disposition === "rejected"  → state = "REJECTED" (red)
_disposition === "accepted":
    Find matching trade by setup.id (trades[].setup_id === setup.id)
    trade.outcome === "TP1_HIT"      → "CONFIRMED · TP1" (green)
    trade.outcome === "TP2_HIT"      → "CONFIRMED · TP2" (green)
    trade.outcome === "STOPPED"      → "STOPPED" (red)
    trade.outcome === "INVALIDATED"  → "INVALIDATED" (red)
    trade.state === "pending_entry"  → "PENDING" (blue)
    no outcome, state === "filled"   → "OPEN" (blue)
_disposition === "ignored"   → row is suppressed (no longer surfaced)
```

`_disposition === "ignored"` is the catch-all bucket for setups that produced neither an accept nor a reject event AND aren't no-trade markers. These are rare and don't belong in the ledger — they get hidden, with the count surfaced in the panel meta (`5 candidates · 2 ignored`).

### 3.3 Reason derivation

The reason column carries the short narrative for the row:

```
NO-TRADE      → setup.no_trade_reason (e.g. "pillar2 poor · range 14pt vs 40pt min")
REJECTED      → setup._rejection_reason (NEW field, see §4)
CONFIRMED·*   → "<model> · expand for details" with ▾ caret
STOPPED       → "stopped at ${formatPx(trade.stop)}"
INVALIDATED   → "invalidated at ${formatPx(trade.invalidation)}"
OPEN / PENDING → "in flight — see LIVE for live state"
```

Rejected rows need a rejection reason field that isn't currently exposed on the setup. The reject event has the trader's prompt response (the `reason` arg passed to `rejectSetup`). The journal builder (`app/main/review.js` `getJournalFor`) is extended additively to attach `_rejection_reason` to setups with `_disposition === "rejected"`.

### 3.4 Inline expansion

Clicking a confirmed/accepted row toggles an inline `TradeCard` rendered below the row (margin-left: 30px, green left-border, light green background to visually associate it with the parent ledger row). The TradeCard is the existing `Shared.jsx` component, used unchanged. State management is local to a new `CandidateLedger` component — a `Set<setupId>` of expanded rows.

Other states (NO-TRADE, REJECTED, INVALIDATED, STOPPED, OPEN) are not expandable. The reason column already carries the relevant detail.

---

## 4. Data wiring — one small extension

### 4.1 `app/main/review.js` — add `_rejection_reason` to setup annotation

Today's `getJournalFor` already annotates each setup with `_disposition`. Extend the same map step to also attach `_rejection_reason` for rejected setups, sourced from the matching reject event's `reason`:

```js
// Before
const setupsAnnotated = setups.map((s) => ({
  ...s,
  _disposition: acceptedSetupIds.has(s.id) ? "accepted"
              : rejectedSetupIds.has(s.id) ? "rejected"
              : s.grade === "no-trade"     ? "no-trade"
              : "ignored",
}));

// After
const rejectionReasonBySetupId = new Map(
  tradeEvents
    .filter((e) => e.type === "reject" && e.setup_id)
    .map((e) => [e.setup_id, e.reason || ""])
);
const setupsAnnotated = setups.map((s) => {
  const disposition = acceptedSetupIds.has(s.id) ? "accepted"
                    : rejectedSetupIds.has(s.id) ? "rejected"
                    : s.grade === "no-trade"     ? "no-trade"
                    : "ignored";
  return {
    ...s,
    _disposition: disposition,
    _rejection_reason: disposition === "rejected" ? (rejectionReasonBySetupId.get(s.id) || "") : null,
  };
});
```

No new IPC. No new hooks. The existing `useReview` already returns the annotated setups — adding `_rejection_reason` is transparent.

### 4.2 All other hooks unchanged

- `useReview` — already returns `{ journal, sessions, library, loading }`. The journal carries `setups` + `trades` + `stats` — all still consumed.
- `useAgentState` — unchanged. The AGENT STATE panel still renders memory + spend.

---

## 5. New components

### 5.1 In `app/renderer/src/Review.jsx`

- **`CandidateLedger({ setups, trades })`** — the new panel. Builds the chronological list, partitions confirmed-accepted setups so they can expand, renders each row via `<LedgerRow />`. Internal state: `expanded: Set<string>` of toggled setup IDs.
- **`LedgerRow({ setup, trade, expanded, onToggle })`** — single grid row. Renders state pill, grade chip, side, model, reason. Calls `onToggle(setupId)` if the row is expandable.
- **`LedgerTradeExpand({ trade })`** — wraps a `<TradeCard>` in a green-tinted container; only mounted when its row is expanded.

The existing `ACCEPTED TRADES` block (`accepted.map((t) => <TradeCard ... />)`) is removed. The `REJECTED / NO-TRADE` block is removed. The `adaptTrade(t)` function stays — it's reused by `LedgerTradeExpand`.

### 5.2 In `app/renderer/src/Review.helpers.js` (new file)

Pure helpers for testability under `node --test`:

```js
// Build the chronological ledger rows from annotated setups + folded trades.
// Returns: [{ setup, trade, state, reason, expandable }] — sorted by setup.ts ascending.
// Suppresses _disposition === "ignored" rows.
export function buildLedger(setups, trades) { ... }

// Map a single setup → state string + tone class.
// state: "NO-TRADE" | "REJECTED" | "CONFIRMED · TP1" | "CONFIRMED · TP2" | "STOPPED" | "INVALIDATED" | "OPEN" | "PENDING"
export function deriveLedgerState(setup, trade) { ... }

// Map a single setup → reason string.
export function deriveLedgerReason(setup, trade) { ... }

// Format grade for the narrow column — "no-trade" → "NO", everything else passes through.
export function formatGradeShort(grade) { ... }
```

### 5.3 In `app/renderer/src/Shared.jsx`

No new exports. `TradeCard` reused unchanged.

### 5.4 In `app/renderer/src/app.css`

Additive only (`.ledger-row`, `.ledger-row.accepted`, `.ledger-row .grade`, `.ledger-row .grade.nt`, `.ledger-row .side`, `.ledger-row .model`, `.ledger-row .state`, `.ledger-row .reason`, `.ledger-row .caret`, `.ledger-trade-expand`). Existing classes untouched.

---

## 6. File-level inventory

**Created:**
- `app/renderer/src/Review.helpers.js` — four pure helpers (`buildLedger`, `deriveLedgerState`, `deriveLedgerReason`, `formatGradeShort`).
- `tests/review-helpers.test.js` — node test for all four helpers.

**Modified:**
- `app/main/review.js` — extend `getJournalFor` to attach `_rejection_reason` to rejected setups (additive, see §4.1).
- `app/renderer/src/Review.jsx` — remove `ACCEPTED TRADES` and `REJECTED / NO-TRADE` blocks; insert new `<CandidateLedger>` + `<LedgerRow>` + `<LedgerTradeExpand>` components in their place. `adaptTrade` stays. Everything else (`SESSION JOURNAL` header, `WATCH NEXT SESSION`, `AGENT STATE`, `SESSION LIBRARY`) unchanged.
- `app/renderer/src/app.css` — additive ledger classes only.
- `CLAUDE.md` — append decisions-table row.

**Untouched (explicit non-scope):**
- `app/renderer/src/Prep.jsx`, `app/renderer/src/Live.jsx`, `app/renderer/src/TvChart.jsx`, `app/renderer/src/App.jsx`
- All hooks in `app/renderer/src/hooks/`
- `app/main/sdk.js`, `app/main/trades.js`, `app/main/tools/surface.js`, `app/main/prompts/analyze.md`
- `Shared.jsx` (TradeCard reused as-is)

---

## 7. Test plan

### Unit (`node --test`)

`tests/review-helpers.test.js`:
- `buildLedger` orders by `setup.ts` ascending; suppresses `_disposition === "ignored"`; attaches matching trade when accepted.
- `deriveLedgerState` returns the right state for every (`_disposition` × `outcome`) combination.
- `deriveLedgerReason` returns no_trade_reason for no-trade, rejection_reason for rejected, model+expand-hint for confirmed.
- `formatGradeShort` returns "NO" for "no-trade"; passes "A+" and "B" through unchanged.

### Integration

- `app/main/review.js` change is additive — no existing test should break. The repo currently has no `tests/review.test.js`; coverage of the `_rejection_reason` annotation happens via the helper test (`buildLedger` accepts an annotated setup with `_rejection_reason` set and emits the right reason string) plus manual sanity.
- `npm run smoke:fixtures` — unaffected (no schema change, no analyze pipeline change).

### Manual

- Boot Electron with a session that has at least one accepted trade + one rejected setup + one no-trade marker.
- Verify the CANDIDATE LEDGER renders in chronological order with the right state pills and reasons.
- Click a confirmed row → verify the TradeCard expands inline.
- Click again → verify it collapses.
- Verify SESSION JOURNAL, AGENT STATE, LIBRARY all still render unchanged.
- Light theme — confirm new ledger classes are readable.

---

## 8. Risks and rollback

### Risks

- **R1 — Ledger row count grows.** A long session with 30+ no-trade markers will have 30+ ledger rows. Mitigation: the ledger is inside the `.work-scroll` container which already scrolls. No virtualisation needed for sessions under 100 rows.
- **R2 — Missing setup `ts`.** Some legacy setup records might lack `ts`. Mitigation: `buildLedger` falls back to sort-by-insertion-order when ts is missing; missing ts renders as `—` in the ts column.
- **R3 — `_rejection_reason` is empty string.** The `window.prompt` returns "" if the user clears the input. The reason column renders "rejected · no reason given" in that case (existing pattern from today's REJECTED section).
- **R4 — `_disposition === "ignored"` count.** Hidden rows. Mitigation: meta line on the panel header reports the count (`5 candidates · 2 ignored`) so the trader isn't surprised by missing entries.

### Rollback

- Revert `Review.jsx` (restore ACCEPTED TRADES + REJECTED / NO-TRADE sections).
- Revert `app/main/review.js` (`_rejection_reason` field stays — it's additive and harmless).
- Revert `app.css` (remove new ledger classes).
- Delete `Review.helpers.js` + `tests/review-helpers.test.js`.

---

## 9. Decisions log

| # | Decision | Reason |
|---|----------|--------|
| 1 | Layout direction = LEDGER FIRST | Session reads as a narrative; the chronological order matters more than the accepted/rejected split. |
| 2 | Inline expansion limited to confirmed/accepted rows | The reason column already carries the story for no-trade / rejected / invalidated. Expanding those would duplicate. |
| 3 | Grade column renders "no-trade" as "NO" | "no-trade" wraps in the narrow grade column. "NO" reads clean. State pill column (wider) still shows "NO-TRADE". |
| 4 | BLOCKED MOMENTS panel skipped | The ledger already shows consecutive no-trade markers chronologically. A separate panel duplicates with no information gain. |
| 5 | AGENT STATE stays where it is | Memory + spend are useful even when reviewing a session. Reference dropped it; we keep it. |
| 6 | EXPORT JSON stays | Real feature in use. Reference doesn't have it; we keep it. |
| 7 | `_rejection_reason` added to setup annotation, not a new schema field | Reject reason already exists in the trade event log. Annotating at journal-build time is a small, contained change in `review.js`. |
| 8 | Pure helpers extracted to `Review.helpers.js` | Same pattern as PREP and LIVE — testable with `node --test` (no Vitest in renderer). |

---

## 10. Next step

Hand off to `superpowers:writing-plans` to break this spec into ordered, runnable implementation tasks.

# REVIEW Panel Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge today's `ACCEPTED TRADES` and `REJECTED / NO-TRADE` sections in `app/renderer/src/Review.jsx` into a single chronological `CANDIDATE LEDGER` with state pills and inline expand-to-TradeCard for confirmed rows.

**Architecture:** Additive on the backend — `app/main/review.js` gains a `_rejection_reason` annotation on rejected setups (sourced from the matching reject trade event). Pure helpers extracted to `Review.helpers.js` for `node --test` coverage. Three new sub-components inside `Review.jsx` (`CandidateLedger`, `LedgerRow`, `LedgerTradeExpand`) replace the two removed sections. Existing `TradeCard` from `Shared.jsx` is reused unchanged for the inline expansion.

**Tech Stack:** React 18 (Vite + Babel via `@vitejs/plugin-react`), `node --test` runner. Same stack as PREP (PR #65) and LIVE (PR #66).

**Spec:** [docs/superpowers/specs/2026-05-27-review-panel-redesign.md](../specs/2026-05-27-review-panel-redesign.md)

**Branch:** `feat/review-panel-redesign` — cut from `main` after PR #66 lands.

---

## File Inventory

**Created:**
- `app/renderer/src/Review.helpers.js` — four pure helpers (`buildLedger`, `deriveLedgerState`, `deriveLedgerReason`, `formatGradeShort`).
- `tests/review-helpers.test.js` — node test for the four helpers.

**Modified:**
- `app/main/review.js` — extend `getJournalFor` to attach `_rejection_reason` to rejected setups (one new local variable + one new field on the annotation).
- `app/renderer/src/Review.jsx` — remove `ACCEPTED TRADES` + `REJECTED / NO-TRADE` blocks; add `CandidateLedger`, `LedgerRow`, `LedgerTradeExpand` components and render the ledger in their place. `adaptTrade()` stays — reused by `LedgerTradeExpand`.
- `app/renderer/src/app.css` — additive only (`.ledger-row`, `.ledger-row.accepted`, ledger sub-classes, `.ledger-trade-expand`).
- `CLAUDE.md` — append decisions-table row.

**Untouched (explicit non-scope):**
- `app/renderer/src/Prep.jsx` (PR #65), `app/renderer/src/Live.jsx` (PR #66), `app/renderer/src/Shared.jsx`, `app/renderer/src/App.jsx`, `app/renderer/src/TvChart.jsx`
- All hooks in `app/renderer/src/hooks/`
- `app/main/sdk.js`, `app/main/trades.js`, `app/main/tools/surface.js`, `app/main/prompts/analyze.md`

---

## Task Dependency Graph

```
Task 1 (branch + spec commit)
  ├─ Task 2 (review.js _rejection_reason)
  ├─ Task 3 (Review.helpers.js)
  │    └─ Task 4 (helper tests)
  ├─ Task 5 (CSS additions)
  │
  └─ Task 6 (Review.jsx restructure) ─┐
       │                               ↓
       └─ Task 7 (test + smoke + manual)
            └─ Task 8 (CLAUDE.md row)
                 └─ Task 9 (push + PR)
```

Tasks 2, 3, 5 can run in any order before Task 6. Recommended sequential: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

---

### Task 1: Cut branch + sanity baseline + commit spec

**Files:**
- The spec at `docs/superpowers/specs/2026-05-27-review-panel-redesign.md` is currently untracked. Commit it to the new branch.

- [ ] **Step 1: Verify clean working state**

Run: `git status`
Expected: on `main` or current working branch. Spec file shows as untracked. If working tree has unrelated changes, stash before proceeding.

- [ ] **Step 2: Sync main**

Run:
```bash
git checkout main
git pull --ff-only origin main
```
Expected: latest main. PR #66 (LIVE) should be in the log.

- [ ] **Step 3: Cut branch**

Run: `git checkout -b feat/review-panel-redesign`
Expected: on the new branch.

- [ ] **Step 4: Baseline tests + smoke**

Run: `npm run test:unit && npm run smoke:fixtures`
Expected: both green. Note the baseline test count (~284) for comparison after.

- [ ] **Step 5: Commit spec + this plan**

```bash
git add docs/superpowers/specs/2026-05-27-review-panel-redesign.md docs/superpowers/plans/2026-05-27-review-panel-redesign.md
git commit -m "$(cat <<'EOF'
docs(review): spec + implementation plan for REVIEW redesign

Spec — merge today's ACCEPTED TRADES + REJECTED / NO-TRADE
sections into one chronological CANDIDATE LEDGER. State pills,
expand-to-TradeCard for confirmed rows. Grade column renders
"no-trade" as "NO" (state pill column still says "NO-TRADE").
BLOCKED MOMENTS skipped (ledger shows chronological cluster).
AGENT STATE + EXPORT JSON unchanged.

One additive backend change: app/main/review.js gains
_rejection_reason on rejected setups (from matching reject event).

Plan — 9 bite-sized tasks. Single-file restructure for Review.jsx;
pure helpers in Review.helpers.js for node --test.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extend review.js with `_rejection_reason`

**Files:**
- Modify: `app/main/review.js` (in `getJournalFor` — around lines 126-140)

- [ ] **Step 1: Read the current annotation block**

Open `app/main/review.js` and find the existing block around line 126:

```js
  const trades = foldAllTrades(tradeEvents);
  // Setups that produced a trade — match by setup_id on accept events.
  const acceptedSetupIds = new Set(
    tradeEvents.filter((e) => e.type === "accept").map((e) => e.setup_id).filter(Boolean)
  );
  const rejectedSetupIds = new Set(
    tradeEvents.filter((e) => e.type === "reject").map((e) => e.setup_id).filter(Boolean)
  );
  const setupsAnnotated = setups.map((s) => ({
    ...s,
    _disposition: acceptedSetupIds.has(s.id) ? "accepted"
                : rejectedSetupIds.has(s.id) ? "rejected"
                : s.grade === "no-trade"     ? "no-trade"
                : "ignored",
  }));
```

- [ ] **Step 2: Replace the block to also attach `_rejection_reason`**

Replace the block above with:

```js
  const trades = foldAllTrades(tradeEvents);
  // Setups that produced a trade — match by setup_id on accept events.
  const acceptedSetupIds = new Set(
    tradeEvents.filter((e) => e.type === "accept").map((e) => e.setup_id).filter(Boolean)
  );
  const rejectedSetupIds = new Set(
    tradeEvents.filter((e) => e.type === "reject").map((e) => e.setup_id).filter(Boolean)
  );
  // Capture the trader-supplied rejection reason from the matching reject
  // event so the ledger can render it instead of a bare "REJECTED" pill.
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
      _rejection_reason: disposition === "rejected"
        ? (rejectionReasonBySetupId.get(s.id) || "")
        : null,
    };
  });
```

- [ ] **Step 3: Verify the file still parses**

Run: `node -e "import('./app/main/review.js').then(() => console.log('ok')).catch((e) => { console.error(e.message); process.exit(1); })"`
Expected: prints `ok`.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test:unit`
Expected: all tests still pass (~284). The change is additive — `_rejection_reason` is a new field on the setup annotation. Existing code that reads `_disposition` is unaffected.

- [ ] **Step 5: Commit**

```bash
git add app/main/review.js
git commit -m "$(cat <<'EOF'
feat(review): attach _rejection_reason on rejected setups

Additive change. getJournalFor now builds a setup_id → reason map
from reject trade events and stamps _rejection_reason on each
setup whose _disposition is "rejected". For other dispositions
the field is null.

Used by the upcoming CANDIDATE LEDGER renderer to surface the
trader's prompt reason inline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Review.helpers.js — pure helpers

**Files:**
- Create: `app/renderer/src/Review.helpers.js`

- [ ] **Step 1: Create the helpers file**

Write `app/renderer/src/Review.helpers.js`:

```js
// Pure helpers for Review.jsx — extracted so they can be unit-tested with
// `node --test`. Importing this file has no side effects.

// Format the grade value for the narrow ledger grade column.
// "no-trade" → "NO" (the full string wraps in the narrow column).
// Everything else passes through ("A+", "B").
export function formatGradeShort(grade) {
  if (grade === "no-trade") return "NO";
  if (grade == null) return "—";
  return String(grade);
}

// Derive the state string + tone for one ledger row.
// Inputs:
//   setup — annotated setup record from review.js getJournalFor
//   trade — matching folded trade (or null if not accepted)
// Output: { label, tone }
//   tone: "green" | "red" | "amber" | "blue" | "dim"
export function deriveLedgerState(setup, trade) {
  const disp = setup?._disposition;
  if (disp === "no-trade") return { label: "NO-TRADE", tone: "amber" };
  if (disp === "rejected") return { label: "REJECTED", tone: "red" };
  if (disp !== "accepted") return { label: "—", tone: "dim" };
  // Accepted — look at the matching trade outcome.
  const outcome = trade?.outcome;
  if (outcome === "TP1_HIT") return { label: "CONFIRMED · TP1", tone: "green" };
  if (outcome === "TP2_HIT") return { label: "CONFIRMED · TP2", tone: "green" };
  if (outcome === "STOPPED") return { label: "STOPPED", tone: "red" };
  if (outcome === "INVALIDATED") return { label: "INVALIDATED", tone: "red" };
  if (trade?.state === "pending_entry") return { label: "PENDING", tone: "blue" };
  if (trade?.state === "filled") return { label: "OPEN", tone: "blue" };
  return { label: "OPEN", tone: "blue" };
}

// Derive the reason string shown in the rightmost ledger column.
// For accepted rows the reason is short — the inline expansion carries
// the full TradeCard. For other rows we surface the no-trade / rejection
// reason so the trader can see why the row landed where it did.
export function deriveLedgerReason(setup, trade) {
  const disp = setup?._disposition;
  if (disp === "no-trade") {
    return setup.no_trade_reason || "no reason given";
  }
  if (disp === "rejected") {
    const r = setup._rejection_reason;
    return r && r.trim() ? r : "rejected · no reason given";
  }
  if (disp === "accepted") {
    const outcome = trade?.outcome;
    if (outcome === "STOPPED" || outcome === "INVALIDATED") {
      return outcome === "STOPPED" ? "stopped" : "invalidated";
    }
    // Default: a short label telling the trader the row is expandable.
    const model = setup.model || trade?.model || "";
    return model ? `${model} · click to expand` : "click to expand";
  }
  return "";
}

// Build the chronological ledger rows.
// Inputs:
//   setups — annotated array from review.js getJournalFor.
//   trades — folded trades array (from useReview.journal.trades).
// Output: [{ setup, trade, state, reason, expandable }]
//
// Rules:
//   - _disposition === "ignored" rows are suppressed.
//   - Rows are sorted by setup.ts ascending; setups missing ts keep
//     their insertion order at the front (defensive — pre-ts data).
//   - Only accepted rows are marked expandable.
//   - The matching trade is found by trade.setup_id === setup.id (when accepted).
export function buildLedger(setups = [], trades = []) {
  const tradesBySetupId = new Map();
  for (const t of trades) {
    if (t && t.setup_id) tradesBySetupId.set(t.setup_id, t);
  }
  const rows = (setups || [])
    .filter((s) => s && s._disposition !== "ignored")
    .map((s) => {
      const trade = s._disposition === "accepted"
        ? (tradesBySetupId.get(s.id) || null)
        : null;
      const state = deriveLedgerState(s, trade);
      const reason = deriveLedgerReason(s, trade);
      return {
        setup: s,
        trade,
        state,
        reason,
        expandable: s._disposition === "accepted" && !!trade,
      };
    });
  // Sort by ts ascending; missing ts keeps insertion order via stable sort.
  rows.sort((a, b) => {
    const ta = a.setup?.ts ? new Date(a.setup.ts).getTime() : Number.NEGATIVE_INFINITY;
    const tb = b.setup?.ts ? new Date(b.setup.ts).getTime() : Number.NEGATIVE_INFINITY;
    return ta - tb;
  });
  return rows;
}
```

- [ ] **Step 2: Verify the module loads**

Run: `node -e "import('./app/renderer/src/Review.helpers.js').then((m) => console.log('exports:', Object.keys(m).sort().join(','))).catch((e) => { console.error(e.message); process.exit(1); })"`
Expected: `exports: buildLedger,deriveLedgerReason,deriveLedgerState,formatGradeShort`

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/Review.helpers.js
git commit -m "$(cat <<'EOF'
feat(review): extract pure helpers for REVIEW redesign

Four exports:
- formatGradeShort — "no-trade" → "NO" for narrow grade column
- deriveLedgerState — setup + trade → { label, tone } for state pill
- deriveLedgerReason — setup + trade → reason column text
- buildLedger — chronological ledger rows from setups + folded trades

Pure JS. No side effects. Mirrors the PREP/LIVE helpers pattern.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Helper unit tests

**Files:**
- Create: `tests/review-helpers.test.js`

- [ ] **Step 1: Write the test file**

Create `tests/review-helpers.test.js`:

```js
// Unit tests for app/renderer/src/Review.helpers.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatGradeShort,
  deriveLedgerState,
  deriveLedgerReason,
  buildLedger,
} from "../app/renderer/src/Review.helpers.js";

describe("formatGradeShort", () => {
  it("shortens 'no-trade' to 'NO'", () => {
    assert.equal(formatGradeShort("no-trade"), "NO");
  });

  it("passes 'A+' and 'B' through unchanged", () => {
    assert.equal(formatGradeShort("A+"), "A+");
    assert.equal(formatGradeShort("B"), "B");
  });

  it("renders null/undefined as em-dash", () => {
    assert.equal(formatGradeShort(null), "—");
    assert.equal(formatGradeShort(undefined), "—");
  });
});

describe("deriveLedgerState", () => {
  it("returns NO-TRADE/amber for no-trade disposition", () => {
    const r = deriveLedgerState({ _disposition: "no-trade" }, null);
    assert.equal(r.label, "NO-TRADE");
    assert.equal(r.tone, "amber");
  });

  it("returns REJECTED/red for rejected disposition", () => {
    const r = deriveLedgerState({ _disposition: "rejected" }, null);
    assert.equal(r.label, "REJECTED");
    assert.equal(r.tone, "red");
  });

  it("returns CONFIRMED · TP1 for accepted + TP1_HIT outcome", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { outcome: "TP1_HIT" });
    assert.equal(r.label, "CONFIRMED · TP1");
    assert.equal(r.tone, "green");
  });

  it("returns CONFIRMED · TP2 for accepted + TP2_HIT outcome", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { outcome: "TP2_HIT" });
    assert.equal(r.label, "CONFIRMED · TP2");
    assert.equal(r.tone, "green");
  });

  it("returns STOPPED/red for accepted + STOPPED outcome", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { outcome: "STOPPED" });
    assert.equal(r.label, "STOPPED");
    assert.equal(r.tone, "red");
  });

  it("returns INVALIDATED/red for accepted + INVALIDATED outcome", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { outcome: "INVALIDATED" });
    assert.equal(r.label, "INVALIDATED");
    assert.equal(r.tone, "red");
  });

  it("returns PENDING/blue for accepted + pending_entry state", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { state: "pending_entry" });
    assert.equal(r.label, "PENDING");
    assert.equal(r.tone, "blue");
  });

  it("returns OPEN/blue for accepted + filled state (no outcome)", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, { state: "filled" });
    assert.equal(r.label, "OPEN");
    assert.equal(r.tone, "blue");
  });

  it("returns OPEN/blue when accepted but no trade record yet", () => {
    const r = deriveLedgerState({ _disposition: "accepted" }, null);
    assert.equal(r.label, "OPEN");
  });

  it("returns em-dash/dim for unknown disposition", () => {
    const r = deriveLedgerState({ _disposition: "ignored" }, null);
    assert.equal(r.label, "—");
    assert.equal(r.tone, "dim");
  });
});

describe("deriveLedgerReason", () => {
  it("surfaces no_trade_reason for no-trade rows", () => {
    const r = deriveLedgerReason(
      { _disposition: "no-trade", no_trade_reason: "pillar2 poor · range 14pt" },
      null,
    );
    assert.match(r, /pillar2 poor/);
  });

  it("surfaces _rejection_reason for rejected rows", () => {
    const r = deriveLedgerReason(
      { _disposition: "rejected", _rejection_reason: "low conviction" },
      null,
    );
    assert.equal(r, "low conviction");
  });

  it("falls back to placeholder when rejection_reason is empty", () => {
    const r = deriveLedgerReason(
      { _disposition: "rejected", _rejection_reason: "" },
      null,
    );
    assert.match(r, /no reason given/);
  });

  it("emits 'stopped' for accepted + STOPPED", () => {
    const r = deriveLedgerReason(
      { _disposition: "accepted", model: "MSS" },
      { outcome: "STOPPED" },
    );
    assert.match(r, /stopped/);
  });

  it("emits 'model · click to expand' for accepted in-progress", () => {
    const r = deriveLedgerReason(
      { _disposition: "accepted", model: "MSS" },
      { outcome: "TP1_HIT" },
    );
    assert.match(r, /MSS/);
    assert.match(r, /expand/);
  });

  it("falls back to 'no reason given' for no-trade without reason", () => {
    const r = deriveLedgerReason(
      { _disposition: "no-trade", no_trade_reason: "" },
      null,
    );
    assert.match(r, /no reason given/);
  });
});

describe("buildLedger", () => {
  const setups = [
    { id: "s1", ts: "2026-05-27T13:35:00Z", _disposition: "no-trade", grade: "no-trade", no_trade_reason: "pillar2 poor", direction: "long", model: "MSS" },
    { id: "s2", ts: "2026-05-27T13:42:00Z", _disposition: "accepted", grade: "A+", direction: "long", model: "MSS" },
    { id: "s3", ts: "2026-05-27T13:51:00Z", _disposition: "rejected", _rejection_reason: "low conviction", grade: "B", direction: "short", model: "MSS" },
    { id: "s4", ts: "2026-05-27T13:30:00Z", _disposition: "ignored", grade: "no-trade", direction: "long", model: "Trend" },
  ];
  const trades = [
    { setup_id: "s2", outcome: "TP1_HIT", state: "filled", model: "MSS" },
  ];

  it("returns chronological rows sorted by setup.ts ascending", () => {
    const rows = buildLedger(setups, trades);
    const ids = rows.map((r) => r.setup.id);
    // ignored row (s4) is suppressed; rest are sorted by ts.
    assert.deepEqual(ids, ["s1", "s2", "s3"]);
  });

  it("suppresses rows with _disposition === 'ignored'", () => {
    const rows = buildLedger(setups, trades);
    assert.equal(rows.find((r) => r.setup.id === "s4"), undefined);
  });

  it("attaches the matching trade to accepted rows only", () => {
    const rows = buildLedger(setups, trades);
    const accepted = rows.find((r) => r.setup.id === "s2");
    assert.equal(accepted.trade.outcome, "TP1_HIT");
    const noTrade = rows.find((r) => r.setup.id === "s1");
    assert.equal(noTrade.trade, null);
  });

  it("marks accepted rows with a trade as expandable", () => {
    const rows = buildLedger(setups, trades);
    const accepted = rows.find((r) => r.setup.id === "s2");
    assert.equal(accepted.expandable, true);
    const rejected = rows.find((r) => r.setup.id === "s3");
    assert.equal(rejected.expandable, false);
  });

  it("returns empty array on missing inputs", () => {
    assert.deepEqual(buildLedger(undefined, undefined), []);
    assert.deepEqual(buildLedger([], []), []);
  });

  it("places rows with missing ts at the front (stable insertion)", () => {
    const noTs = [
      { id: "a", _disposition: "no-trade", grade: "no-trade" },
      { id: "b", ts: "2026-05-27T13:00:00Z", _disposition: "no-trade", grade: "no-trade" },
    ];
    const rows = buildLedger(noTs, []);
    assert.equal(rows[0].setup.id, "a");
    assert.equal(rows[1].setup.id, "b");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test tests/review-helpers.test.js`
Expected: all tests pass (~24 cases).

- [ ] **Step 3: Run the full suite**

Run: `npm run test:unit`
Expected: tests pass — baseline (~284) + ~24 new = ~308.

- [ ] **Step 4: Commit**

```bash
git add tests/review-helpers.test.js
git commit -m "$(cat <<'EOF'
test(review): unit tests for Review.helpers

Covers all four exports — formatGradeShort (3), deriveLedgerState (10
incl. every state x outcome combo), deriveLedgerReason (6),
buildLedger (6 incl. sort, suppression, expandability, null safety).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: CSS additions

**Files:**
- Modify: `app/renderer/src/app.css` (append at end)

- [ ] **Step 1: Append new classes**

Append to `app/renderer/src/app.css`:

```css
/* ─────────── REVIEW redesign (2026-05-27) ─────────── */

/* Candidate ledger row — chronological list inside the new CANDIDATE
   LEDGER panel. One row per setup. */
.ledger-row {
  display: grid;
  grid-template-columns: 56px 36px 44px 64px 88px 1fr;
  gap: 10px;
  align-items: center;
  padding: 5px 14px;
  font-size: 10.5px;
  border-bottom: 1px dotted var(--border-dim, #1e2228);
}
.ledger-row:last-child { border-bottom: 0; }
.ledger-row.expandable { cursor: pointer; }
.ledger-row.expandable:hover { background: rgba(212, 166, 87, 0.04); }
.ledger-row.accepted {
  background: rgba(111, 156, 91, 0.04);
  border-left: 2px solid var(--green);
  padding-left: 12px;
}

.ledger-row .ts {
  color: var(--label-dim, #6b7178);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}
.ledger-row .grade {
  text-align: center;
  padding: 1px 0;
  font-size: 9px;
  letter-spacing: 0.1em;
  border: 1px solid var(--border);
  color: var(--label);
  white-space: nowrap;
}
.ledger-row .grade.aplus {
  color: var(--green);
  border-color: var(--green);
  background: rgba(111, 156, 91, 0.12);
}
.ledger-row .grade.b {
  color: var(--amber);
  border-color: var(--amber);
  background: rgba(212, 166, 87, 0.12);
}
.ledger-row .grade.nt {
  color: var(--label-dim, #6b7178);
  border-color: var(--border);
}
.ledger-row .side {
  text-align: center;
  font-size: 9px;
  letter-spacing: 0.12em;
}
.ledger-row .side.long { color: var(--green); }
.ledger-row .side.short { color: var(--red); }
.ledger-row .model {
  color: var(--value);
  font-size: 10px;
}
.ledger-row .state {
  text-align: center;
  padding: 1px 0;
  font-size: 8.5px;
  letter-spacing: 0.12em;
  border: 1px solid currentColor;
  white-space: nowrap;
}
.ledger-row .state.green { color: var(--green); }
.ledger-row .state.red { color: var(--red); }
.ledger-row .state.amber { color: var(--amber); }
.ledger-row .state.blue { color: var(--blue, #4f7eb3); }
.ledger-row .state.dim { color: var(--label-dim, #6b7178); }
.ledger-row .reason {
  color: var(--label);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ledger-row .reason .caret {
  color: var(--green);
  margin-left: 4px;
}

/* Inline TradeCard expansion — appears under an expanded accepted row. */
.ledger-trade-expand {
  margin: 0 0 4px 32px;
  border-left: 2px solid var(--green);
  background: rgba(111, 156, 91, 0.04);
  padding: 4px 8px;
}
```

- [ ] **Step 2: Verify brace balance**

```bash
node -e "const fs = require('fs'); const css = fs.readFileSync('app/renderer/src/app.css', 'utf8'); const open = (css.match(/{/g) || []).length; const close = (css.match(/}/g) || []).length; if (open !== close) { console.error('CSS brace mismatch:', open, 'vs', close); process.exit(1); } else { console.log('css braces ok:', open); }"
```
Expected: `css braces ok: <N>` (N around 435-450).

- [ ] **Step 3: Commit**

```bash
git add app/renderer/src/app.css
git commit -m "$(cat <<'EOF'
feat(css): add classes for REVIEW redesign

Additive only. New classes: .ledger-row (and its sub-classes for
grade/side/model/state/reason), .ledger-row.accepted, .ledger-row
.expandable, .ledger-trade-expand.

No existing classes modified — PREP / LIVE / shared components
unaffected.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Review.jsx restructure

**Files:**
- Modify: `app/renderer/src/Review.jsx` (remove `ACCEPTED TRADES` + `REJECTED / NO-TRADE` blocks; add new components)

- [ ] **Step 1: Update the imports at the top**

In `app/renderer/src/Review.jsx`, find the import block (around lines 8-11). Replace with:

```jsx
import React, { useState } from "react";
import { Panel, Row, Grade, TradeCard, SectionHead } from "./Shared.jsx";
import { useReview } from "./hooks/useReview.js";
import { useAgentState } from "./hooks/useAgentState.js";
import {
  formatGradeShort,
  deriveLedgerState,
  deriveLedgerReason,
  buildLedger,
} from "./Review.helpers.js";
```

- [ ] **Step 2: Add the ledger components below adaptTrade**

Find `function adaptTrade(t)` (around lines 95-132). After its closing `}`, insert:

```jsx
// Single chronological row in the CANDIDATE LEDGER. Used in the new
// REVIEW layout. State/reason are pre-computed by buildLedger so the
// component is render-only.
function LedgerRow({ row, expanded, onToggle }) {
  const { setup, state, reason, expandable } = row;
  const grade = setup.grade || "no-trade";
  const gradeClass = grade === "A+" ? "aplus" : grade === "B" ? "b" : "nt";
  const side = (setup.direction || setup.side || "").toLowerCase();
  const sideLabel = side ? side.toUpperCase() : "—";
  const ts = setup.ts
    ? new Date(setup.ts).toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York",
      }) + " ET"
    : "—";
  return (
    <div
      className={
        "ledger-row" +
        (expandable ? " expandable" : "") +
        (setup._disposition === "accepted" ? " accepted" : "")
      }
      onClick={expandable ? () => onToggle(setup.id) : undefined}
      title={reason}
    >
      <span className="ts">{ts}</span>
      <span className={"grade " + gradeClass}>{formatGradeShort(grade)}</span>
      <span className={"side " + (side === "long" ? "long" : side === "short" ? "short" : "")}>
        {sideLabel}
      </span>
      <span className="model">{setup.model || "—"}</span>
      <span className={"state " + state.tone}>{state.label}</span>
      <span className="reason">
        {reason}
        {expandable && <span className="caret">{expanded ? " ▾" : " ▸"}</span>}
      </span>
    </div>
  );
}

// Inline TradeCard wrapper rendered under an expanded ledger row.
function LedgerTradeExpand({ trade }) {
  if (!trade) return null;
  return (
    <div className="ledger-trade-expand">
      <TradeCard trade={adaptTrade(trade)} showSnapshot={false} />
    </div>
  );
}

// CANDIDATE LEDGER — the new chronological panel. Replaces the
// ACCEPTED TRADES and REJECTED / NO-TRADE blocks. Expand state is a
// local Set<setupId>.
function CandidateLedger({ setups, trades }) {
  const rows = buildLedger(setups, trades);
  const ignoredCount = (setups || []).filter((s) => s && s._disposition === "ignored").length;
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (rows.length === 0) {
    return (
      <>
        <SectionHead title="CANDIDATE LEDGER" count="0" />
        <div className="empty-state" style={{ padding: 14 }}>
          <div style={{ color: "var(--label)", fontSize: 11 }}>no candidates surfaced this session</div>
        </div>
      </>
    );
  }
  return (
    <>
      <SectionHead
        title="CANDIDATE LEDGER"
        count={
          ignoredCount > 0
            ? `${rows.length} · ${ignoredCount} ignored`
            : String(rows.length)
        }
      />
      <div className="panel-body flush">
        {rows.map((row) => {
          const isOpen = expanded.has(row.setup.id);
          return (
            <React.Fragment key={row.setup.id || row.setup.ts}>
              <LedgerRow row={row} expanded={isOpen} onToggle={toggle} />
              {isOpen && row.expandable && <LedgerTradeExpand trade={row.trade} />}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Remove the old ACCEPTED TRADES block**

Find this block inside `ReviewWorkstation` (around lines 341-348):

```jsx
      <SectionHead title="ACCEPTED TRADES" count={accepted.length} />
      <div style={{ paddingTop: 4, paddingBottom: 4 }}>
        {accepted.length === 0 ? (
          <div className="empty-state" style={{ padding: 14 }}>
            <div style={{ color: "var(--label)", fontSize: 11 }}>no trades accepted this session</div>
          </div>
        ) : accepted.map((t) => <TradeCard key={t.id} trade={adaptTrade(t)} />)}
      </div>
```

Delete the entire block.

- [ ] **Step 4: Remove the old REJECTED / NO-TRADE block**

Immediately after the removed ACCEPTED TRADES block, find:

```jsx
      <SectionHead title="REJECTED / NO-TRADE" count={rejected.length} />
      <div className="panel-body flush" style={{ paddingTop: 2, paddingBottom: 6 }}>
        {rejected.length === 0 ? (
          <div className="empty-state" style={{ padding: 14 }}>
            <div style={{ color: "var(--label)", fontSize: 11 }}>no rejected setups</div>
          </div>
        ) : rejected.map((r) => (
          <div key={r.id || r.ts} className="level-row"
               style={{ gridTemplateColumns: "auto auto 1fr auto", padding: "6px 14px" }}>
            <Grade value={r.grade || "no-trade"} />
            <span style={{ color: "var(--label)", fontSize: 10.5, letterSpacing: ".08em" }}>
              {r.id || "—"}
            </span>
            <span style={{ color: "var(--value)", fontSize: 11 }}>
              <span style={{
                color: r.direction === "long" || r.side === "long" ? "var(--green)" : "var(--red)",
                letterSpacing: ".1em", marginRight: 8, fontSize: 10,
              }}>
                {String(r.direction || r.side || "").toUpperCase()}
              </span>
              <span style={{ color: "var(--label)", marginRight: 8 }}>{r.model || ""}</span>
              <span style={{ color: "var(--prose)" }}>
                {r._disposition === "no-trade" ? "no-trade discipline marker" : "rejected"}
              </span>
            </span>
            <span style={{ color: "var(--label-dim)", fontSize: 9.5, letterSpacing: ".08em" }}>
              {fmtTime(r.ts)}
            </span>
          </div>
        ))}
      </div>
```

Delete the entire block.

- [ ] **Step 5: Insert the new CandidateLedger**

In the same place where the two removed blocks lived, insert:

```jsx
      <CandidateLedger setups={setups} trades={trades} />
```

- [ ] **Step 6: Remove the now-unused `accepted` and `rejected` locals**

Find these lines near the top of `ReviewWorkstation` (around lines 300-302):

```jsx
  const { date, session, brief, summary, setups, trades, stats } = journal;
  const accepted = trades;       // every accepted setup ended up here
  const rejected = setups.filter((s) => s._disposition === "rejected" || s._disposition === "no-trade");
```

Replace with:

```jsx
  const { date, session, brief, summary, setups, trades, stats } = journal;
```

(The `accepted` and `rejected` locals are no longer referenced.)

- [ ] **Step 7: Smoke-check the file**

Run:
```bash
node -e "const fs = require('fs'); const src = fs.readFileSync('app/renderer/src/Review.jsx', 'utf8'); console.log('lines:', src.split('\\n').length); const open = (src.match(/{/g) || []).length; const close = (src.match(/}/g) || []).length; console.log('braces:', open, '/', close, '(diff', open - close, ')');"
```
Expected: line count around 470-520; brace diff small (≤ 5).

- [ ] **Step 8: Run full test + smoke**

Run: `npm run test:unit && npm run smoke:fixtures`
Expected: tests pass (~308); fixtures 16/16.

- [ ] **Step 9: Commit**

```bash
git add app/renderer/src/Review.jsx
git commit -m "$(cat <<'EOF'
feat(review): merge accepted + rejected into CANDIDATE LEDGER

- Remove ACCEPTED TRADES and REJECTED / NO-TRADE sections
- Add CandidateLedger panel with chronological setup rows
- LedgerRow renders ts · grade · side · model · state pill · reason
- Confirmed/accepted rows are expandable; click toggles inline
  LedgerTradeExpand which mounts the existing TradeCard
- Grade column shows "NO" for no-trade (narrow column wrap fix);
  state pill column still shows "NO-TRADE"
- Suppressed ignored setups are surfaced as a count in the
  section header meta
- adaptTrade reused unchanged

Same data flow. No new IPC.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full integration test + manual sanity

**Files:** none

- [ ] **Step 1: Run all tests**

Run: `npm run test:unit && npm run smoke:fixtures`
Expected: all tests pass (~308); 16/16 fixtures.

- [ ] **Step 2: Boot the renderer**

Run: `cd app && npm run dev`
Expected: Vite + Electron boot. Navigate to REVIEW.

Verify:
- **Session with mixed disposition** — Confirm the CANDIDATE LEDGER renders rows in chronological order (oldest first). State pills colour-correct (CONFIRMED green, NO-TRADE amber, REJECTED red).
- **Grade column** — "no-trade" rows render `NO` (single line, no wrap).
- **Expand a confirmed row** — Caret flips `▸ → ▾`, TradeCard appears inline below the row with full risk/outcome details.
- **Collapse** — Caret flips back, TradeCard disappears.
- **Ignored count** — If any setup has `_disposition === "ignored"`, the section header meta reads e.g. `5 · 2 ignored`.
- **Other panels unchanged** — Confirm SESSION JOURNAL header, EXPORT JSON, WATCH NEXT SESSION (when present), AGENT STATE, SESSION LIBRARY all still render as before.
- **Empty session** — Open a session with no setups; confirm the empty state ("no candidates surfaced this session") renders.

- [ ] **Step 3: Light theme**

Toggle to light theme via the topbar. Confirm new classes are readable:
- `.ledger-row .grade.nt` should be a dim grey (not invisible against the light background).
- `.ledger-row .reason .caret` (green) should still be visible.

If any light-theme issue surfaces, add a `[data-theme="light"]` override in `app.css` and commit the fix.

- [ ] **Step 4: Commit any fix-up**

```bash
git add app/renderer/src/app.css app/renderer/src/Review.jsx
git commit -m "fix(review): light-theme + polish

Co-Authored-By: Claude <noreply@anthropic.com>"
```

(Skip if nothing needed.)

---

### Task 8: CLAUDE.md decisions row

**Files:**
- Modify: `CLAUDE.md` (append row after the LIVE decision row, before `## Repo`)

- [ ] **Step 1: Find the LIVE row**

Run: `grep -n "LIVE panel redesign" CLAUDE.md`
Expected: one match. Insert the REVIEW row immediately after it, before `## Repo`.

- [ ] **Step 2: Insert the row**

In `CLAUDE.md`, find the LIVE panel redesign row (single very long line). Add the following NEW row immediately after it:

```
| 2026-05-27 | REVIEW panel redesign — chronological CANDIDATE LEDGER | Merge today's `ACCEPTED TRADES` (full TradeCards) and `REJECTED / NO-TRADE` (compact rows) sections into a single chronological `CANDIDATE LEDGER` sorted by `setup.ts`. Each row carries `ts · grade · side · model · state pill · reason`. State derivation maps `_disposition` + folded trade `outcome` to one of `CONFIRMED · TP1/2`, `STOPPED`, `INVALIDATED`, `REJECTED`, `NO-TRADE`, `OPEN`, `PENDING`. **Click-to-expand:** confirmed/accepted rows show a `▸` / `▾` caret; clicking toggles an inline `LedgerTradeExpand` wrapping the existing `TradeCard` from `Shared.jsx` (reused unchanged). Non-confirmed rows are read-only (the reason column carries the no-trade or rejection text). **Grade column:** renders `"no-trade"` as `"NO"` so the narrow column doesn't wrap; the wider state pill column still shows `"NO-TRADE"`. **BLOCKED MOMENTS skipped** — the ledger already shows the chronological cluster of no-trade markers; a separate panel would duplicate. **Backend change:** one additive line in `app/main/review.js` `getJournalFor` attaches `_rejection_reason` to rejected setups (sourced from the matching reject trade event's `reason` field). **AGENT STATE + EXPORT JSON + SESSION JOURNAL + WATCH NEXT SESSION + SESSION LIBRARY all unchanged.** Pure helpers extracted to `app/renderer/src/Review.helpers.js` (4 exports — `formatGradeShort`, `deriveLedgerState`, `deriveLedgerReason`, `buildLedger`) for `node --test` coverage. **Tests:** +25 helper unit tests. Spec: [docs/superpowers/specs/2026-05-27-review-panel-redesign.md](docs/superpowers/specs/2026-05-27-review-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-review-panel-redesign.md](docs/superpowers/plans/2026-05-27-review-panel-redesign.md). |
```

- [ ] **Step 3: Verify**

Run: `grep -n "REVIEW panel redesign" CLAUDE.md`
Expected: one match.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude): log REVIEW redesign in decisions table

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

Run: `git push -u origin feat/review-panel-redesign`
Expected: branch pushed.

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat(review): chronological CANDIDATE LEDGER with expand-to-TradeCard" --body "$(cat <<'EOF'
## Summary

- Merge today's ACCEPTED TRADES (full TradeCards) and REJECTED / NO-TRADE (compact rows) sections into a single chronological CANDIDATE LEDGER sorted by setup timestamp.
- Each ledger row: \`ts · grade · side · model · state pill · reason\`. Confirmed/accepted rows are expandable — click toggles an inline TradeCard below the row.
- Grade column renders \`"no-trade"\` as \`"NO"\` (narrow column wrap fix); state pill column still shows \`"NO-TRADE"\`.
- Backend change is additive: \`app/main/review.js\` \`getJournalFor\` attaches \`_rejection_reason\` to rejected setups (from the matching reject trade event's \`reason\`).

SESSION JOURNAL header + AGENT STATE + EXPORT JSON + WATCH NEXT SESSION + SESSION LIBRARY all unchanged. Pure helpers extracted to \`Review.helpers.js\` for \`node --test\` coverage.

**Scope:** REVIEW panel only. PREP shipped in #65; LIVE shipped in #66. Util pages are next (panel-by-panel scope).

Spec: [docs/superpowers/specs/2026-05-27-review-panel-redesign.md](docs/superpowers/specs/2026-05-27-review-panel-redesign.md)
Plan: [docs/superpowers/plans/2026-05-27-review-panel-redesign.md](docs/superpowers/plans/2026-05-27-review-panel-redesign.md)

## Test plan

- [x] \`npm run test:unit\` — all green (~308 total: baseline 284 + 25 helper tests)
- [x] \`npm run smoke:fixtures\` — 16/16 fixtures unaffected
- [ ] Boot Electron, open a session with mixed disposition. Verify ledger renders chronologically with right state pills.
- [ ] Click a confirmed row — verify TradeCard expands inline; click again to collapse.
- [ ] Light theme — confirm new classes are readable.
- [ ] Empty session — confirm "no candidates surfaced" empty state renders.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Report back.

- [ ] **Step 5: Done**

Print the PR URL + final test counts.

---

## Self-Review (run after writing the full plan)

### Spec coverage

- §2 Locked design (SESSION JOURNAL + CANDIDATE LEDGER + WATCH NEXT SESSION + AGENT STATE + SESSION LIBRARY): Task 6 covers the ledger insertion; SESSION JOURNAL/WATCH/AGENT/LIBRARY are explicitly untouched.
- §3 Ledger row format (columns, state derivation, reason derivation, inline expansion): covered in Tasks 3 (helpers), 4 (tests), 5 (CSS), 6 (LedgerRow + LedgerTradeExpand).
- §4 Data wiring (`_rejection_reason` extension): Task 2.
- §5 New components (CandidateLedger, LedgerRow, LedgerTradeExpand): Task 6.
- §5.2 Helpers in Review.helpers.js: Task 3.
- §6 File-level inventory: every file listed appears in this plan.
- §7 Test plan: Task 4 (helper unit tests) + Task 7 (manual sanity).
- §8 Risks: mitigated in helper code (R1 scrolling already in `.work-scroll`; R2 stable sort for missing ts; R3 placeholder for empty rejection reason; R4 ignored count in panel meta).

### Placeholder scan

- No TBDs, no TODOs.
- Every code block is complete and self-contained.
- Every git command uses exact commit messages.

### Type consistency

- `buildLedger(setups, trades)` returns `[{ setup, trade, state, reason, expandable }]`. State is `{ label, tone }`. Consistent across helper, test, LedgerRow render.
- `deriveLedgerState(setup, trade)` returns `{ label, tone }` — consistent across helper, test, LedgerRow.
- `deriveLedgerReason(setup, trade)` returns a string — consistent.
- `formatGradeShort(grade)` returns a string — consistent.
- `CandidateLedger({ setups, trades })`, `LedgerRow({ row, expanded, onToggle })`, `LedgerTradeExpand({ trade })` — prop names consistent.

All clear.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-review-panel-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

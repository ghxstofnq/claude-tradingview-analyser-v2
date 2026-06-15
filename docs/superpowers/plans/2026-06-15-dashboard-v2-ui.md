# Dashboard v2 — UI Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the approved v4 dashboard mockup into the real Electron app, wiring every panel to real hooks, with two new deterministic broker-free backend pieces (backtest range/batch runner + analytics aggregation) and all order controls stubbed behind an `executionAdapter` interface.

**Architecture:** Build on `feat/dashboard-v2` in the MAIN checkout so the running app hot-reloads renderer edits (restart only for `app/main` changes). Port slice-by-slice; each slice leaves a working app + green tests. Pure logic → `*.helpers.js` / `cli/lib` with `node --test`; panels verified via the hot-reloading app (`preview_*`). No broker code (companion execution spec, built second).

**Tech Stack:** Electron + React (renderer), Node ESM (main), `node --test` (unit), vite (renderer dev/hot-reload), existing hooks/IPC.

**Spec:** `docs/superpowers/specs/2026-06-15-dashboard-v2-ui-design.md`
**Mockup reference:** `~/Downloads/Dashboard Location (4)/assets/` (read the matching `*.jsx` per panel before porting).

---

## File Structure

**New:**
- `app/renderer/src/hooks/useAccount.js` — ephemeral account mode + persisted guardrails.
- `app/renderer/src/Account.helpers.js` — pure account/guardrail logic (boot-PAPER, clear-stale-key, arm gate, guardrail validation).
- `app/renderer/src/execution/executionAdapter.js` — stub interface (no-op + toast); real impl in the execution spec.
- `app/renderer/src/Sizing.helpers.js` — pure `$risk → contracts` read-out (mirrors `cli/lib/sizing.js`).
- `app/main/backtest-batch.js` — range × sessions × symbol orchestrator over `runBacktest`.
- `cli/lib/backtest-analytics.js` — pure aggregation (cumulative-R, expectancy, breakdowns, equity series).
- `app/renderer/src/SettingsPopover.jsx` — ACCOUNT & EXECUTION popover.
- Tests: `tests/account-helpers.test.js`, `tests/sizing-helpers.test.js`, `tests/backtest-batch.test.js`, `tests/backtest-analytics.test.js`.

**Modify (port to v4):** `app/renderer/src/App.jsx` (shell/topbar/strip), `app.css` (+ ported mockup CSS), `PrepPopover.jsx`, `LivePopover.jsx`, `BacktestPopover.jsx`, `ReviewPopover.jsx`, `Shared.jsx` (ClaudeFeed→4-channel), `hooks/useBacktest.js` (batch events).

---

## Slice 0: CSS + shell scaffolding

**Files:** Modify `app/renderer/src/app.css`, `app/renderer/src/App.jsx`.

- [ ] **Step 1 — Port the mockup theme tokens.** Read `~/Downloads/Dashboard Location (4)/assets/workstation.css` + `screens.css`. Copy the `:root`/`[data-theme]` CSS-variable blocks + base typography into `app.css` (append a `/* === v2 theme === */` section), reconciling variable names with the app's existing tokens. Keep both dark + light.
- [ ] **Step 2 — Verify in the running app.** `preview_*`: load the app, `preview_screenshot` light + dark (`preview_resize colorScheme`). Expected: theme matches the mockup, no layout breakage.
- [ ] **Step 3 — Shell: minimal topbar + control strip.** In `App.jsx`: remove `SymbolSwitcher` from the topbar; keep VER/ALERTS/NEWS/theme; add the `PAPER/LIVE` account badge slot (placeholder until Slice 1). Confirm PREP/LIVE/REVIEW/BACKTEST/CHAT cells render in the bottom status line (already the case post-2026-05-28).
- [ ] **Step 4 — Verify + commit.** `preview_screenshot`; then `git add app/renderer/src/app.css app/renderer/src/App.jsx && git commit -m "feat(dashboard-v2): port theme + shell scaffolding"`.

---

## Slice 1: Account model + Settings popover + execution stub

**Files:** Create `Account.helpers.js`, `hooks/useAccount.js`, `execution/executionAdapter.js`, `SettingsPopover.jsx`, `tests/account-helpers.test.js`. Modify `App.jsx`.

- [ ] **Step 1 — Failing test for account helpers.** Create `tests/account-helpers.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootAccount, loadGuards, validateOrder, armReady } from "../app/renderer/src/Account.helpers.js";

test("bootAccount always returns paper and clears the stale key", () => {
  const removed = [];
  const store = { getItem: () => "live", removeItem: (k) => removed.push(k), setItem: () => {} };
  assert.equal(bootAccount(store), "paper");
  assert.deepEqual(removed, ["workstation:account"]);
});
test("loadGuards falls back to defaults when unset", () => {
  const g = loadGuards({ getItem: () => null });
  assert.equal(g.perTradeMax, 250); assert.equal(g.dailyLossLimit, 600); assert.equal(g.defaultRisk, 120);
});
test("armReady only when typed exactly LIVE", () => {
  assert.equal(armReady("LIVE"), true); assert.equal(armReady("live"), false); assert.equal(armReady(""), false);
});
test("validateOrder blocks no-stop, over-max, and ok path", () => {
  assert.equal(validateOrder({ risk: 120, stopPts: 18.5, hasStop: true, perTradeMax: 250 }).ok, true);
  assert.equal(validateOrder({ risk: 120, stopPts: 18.5, hasStop: false, perTradeMax: 250 }).reason, "no_stop");
  assert.equal(validateOrder({ risk: 400, stopPts: 18.5, hasStop: true, perTradeMax: 250 }).reason, "over_max");
});
```
- [ ] **Step 2 — Run, verify fail.** `npm test -- tests/account-helpers.test.js` (or `node --test tests/account-helpers.test.js`). Expected: FAIL (module not found).
- [ ] **Step 3 — Implement `Account.helpers.js`:**
```js
export const GUARD_DEFAULTS = { perTradeMax: 250, dailyLossLimit: 600, defaultRisk: 120 };
export function bootAccount(store = localStorage) {
  try { store.removeItem("workstation:account"); } catch {}
  return "paper";
}
export function loadGuards(store = localStorage) {
  try { const v = JSON.parse(store.getItem("workstation:guards")); if (v && v.perTradeMax) return { ...GUARD_DEFAULTS, ...v }; } catch {}
  return { ...GUARD_DEFAULTS };
}
export function saveGuards(g, store = localStorage) { try { store.setItem("workstation:guards", JSON.stringify(g)); } catch {} }
export const armReady = (typed) => typed === "LIVE";
export function validateOrder({ risk, stopPts, hasStop, perTradeMax }) {
  if (!hasStop) return { ok: false, reason: "no_stop" };
  if (risk > perTradeMax) return { ok: false, reason: "over_max" };
  return { ok: true };
}
```
- [ ] **Step 4 — Run, verify pass.** `node --test tests/account-helpers.test.js`. Expected: PASS.
- [ ] **Step 5 — `useAccount.js` hook** wrapping the helpers: `const [account,setAccount]=useState(()=>bootAccount()); const [guards,setGuards]=useState(()=>loadGuards()); useEffect persist guards; arm(typed)/returnToPaper()`.
- [ ] **Step 6 — `executionAdapter.js` stub:** export object with `placeOrder/flatten/moveStopToBE/panic/trail/cancel/addToPosition/armLive/returnToPaper`, each `() => { toast("execution not wired yet"); return { ok:false, stub:true }; }` (use the app's existing toast/CustomEvent).
- [ ] **Step 7 — `SettingsPopover.jsx`** ported from `~/Downloads/Dashboard Location (4)/assets/pop-settings.jsx`: ACTIVE ACCOUNT (badge + guarded ARM gate → `armReady`/`armLive` stub), RISK GUARDRAILS (editable, `useAccount`), EXECUTION readout. Wire the topbar badge (`App.jsx`) to `useAccount`.
- [ ] **Step 8 — Verify in app.** `preview_*`: open settings from the badge; type "LIVE" → ARM enables; arm → red badge + RETURN TO PAPER; reload → boots PAPER, key cleared (`preview_eval localStorage.getItem('workstation:account')` → null). `preview_screenshot`.
- [ ] **Step 9 — Commit.** `git add` the new files + `App.jsx`; `git commit -m "feat(dashboard-v2): account model + settings popover + execution stub"`.

---

## Slice 2: PREP panel (restyle, real data)

**Files:** Modify `PrepPopover.jsx`; reuse `Prep.helpers.js` + `useSessionBrief`/`usePrep`.

- [ ] **Step 1 — Read** mockup `pop-prep-live.jsx` (PREP section) for the v4 layout.
- [ ] **Step 2 — Port the markup/classes** in `PrepPopover.jsx` to the v4 design, keeping the existing data wiring (`useSessionBrief` → `Prep.helpers` rows). Ensure every price keeps its `cite` tooltip slot.
- [ ] **Step 3 — Verify in app** (`preview_*`: open PREP, screenshot light+dark; confirm STEP 1/2/3 + brief render from real `brief.json`). If no live brief, confirm graceful empty state.
- [ ] **Step 4 — Commit.** `git commit -m "feat(dashboard-v2): PREP v4 restyle"`.

---

## Slice 3: LIVE panels (HUNT / TICKET / IN-TRADE / ADD)

**Files:** Create `Sizing.helpers.js`, `tests/sizing-helpers.test.js`. Modify `LivePopover.jsx`; reuse `Live.helpers.js`, `useActiveSetup`/`useLive`/`useTrades`/`useWalkers`/`useChat`, `useAccount`, `executionAdapter`.

- [ ] **Step 1 — Failing test for sizing read-out:**
```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { sizeOrder } from "../app/renderer/src/Sizing.helpers.js";
test("MNQ: $120 risk, 18.5pt stop → 3 micros, $111, within tol", () => {
  const r = sizeOrder({ riskUsd: 120, stopPts: 18.5, pointValue: 2, perTradeMax: 250 });
  assert.equal(r.contracts, 3); assert.equal(r.actualRisk, 111); assert.equal(r.withinTolerance, true);
});
test("blocks when nothing lands within ±$50", () => {
  const r = sizeOrder({ riskUsd: 20, stopPts: 100, pointValue: 2, perTradeMax: 250 }); // 1c=$200
  assert.equal(r.withinTolerance, false); assert.equal(r.blockReason, "no_size_within_tolerance");
});
```
- [ ] **Step 2 — Run, verify fail.** `node --test tests/sizing-helpers.test.js`.
- [ ] **Step 3 — Implement `sizeOrder`:**
```js
export function sizeOrder({ riskUsd, stopPts, pointValue, perTradeMax, tol = 50 }) {
  const perContract = stopPts * pointValue;
  if (!(perContract > 0)) return { contracts: 0, actualRisk: 0, withinTolerance: false, blockReason: "bad_stop" };
  const floorN = Math.floor(riskUsd / perContract);
  const candidates = [floorN, floorN + 1].filter((n) => n >= 1);
  let best = null;
  for (const n of candidates) { const risk = n * perContract; if (Math.abs(risk - riskUsd) <= tol) { if (!best || Math.abs(risk - riskUsd) < Math.abs(best.actualRisk - riskUsd)) best = { contracts: n, actualRisk: risk }; } }
  if (!best) return { contracts: 0, actualRisk: 0, withinTolerance: false, blockReason: "no_size_within_tolerance" };
  const pctOfMax = Math.round((best.actualRisk / perTradeMax) * 100);
  return { ...best, withinTolerance: true, pctOfMax };
}
```
- [ ] **Step 4 — Run, verify pass.**
- [ ] **Step 5 — Port LIVE tabs** from mockup `pop-prep-live.jsx` (LIVE section) + `live-options.jsx`: HUNT (entry candidate + confirmation via `Live.helpers.pillar3ToConfirmationRows`), TICKET (sizing read-out via `sizeOrder` + `useAccount` defaults/max; "Accept" calls `executionAdapter.placeOrder` stub), IN-TRADE (`liveGridFromTrade` + manage buttons → `executionAdapter` stubs), ADD (walker `scale_in_add` candidate, badged). Blocked-order state from `validateOrder`/`sizeOrder.blockReason`.
- [ ] **Step 6 — Verify in app** (`preview_*`: drive `useLive` sub-states; screenshot each tab; confirm ticket math matches `sizeOrder`; buttons toast the stub).
- [ ] **Step 7 — Commit.** `git commit -m "feat(dashboard-v2): LIVE v4 panels + sizing read-out (execution stubbed)"`.

---

## Slice 4: BACKTEST (NEW range form + batch runner + analytics)

**Files:** Create `app/main/backtest-batch.js`, `cli/lib/backtest-analytics.js`, `tests/backtest-batch.test.js`, `tests/backtest-analytics.test.js`. Modify `BacktestPopover.jsx`, `hooks/useBacktest.js`, `app/main/ipc-backtest.js`.

- [ ] **Step 1 — Failing test: job expansion.**
```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { expandJobs } from "../app/main/backtest-batch.js";
test("expands range × sessions × symbol", () => {
  const jobs = expandJobs({ symbol: "both", from: "2026-06-08", to: "2026-06-09", sessions: ["ny-am","london"] });
  assert.equal(jobs.length, 2 /*days*/ * 2 /*sessions*/ * 2 /*symbols*/);
  assert.ok(jobs.every((j) => j.date && j.session && j.symbol));
});
```
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement `expandJobs`** (pure: enumerate weekdays from→to, cross sessions[], cross symbol→[MNQ1!]/[MES1!]/both). Keep `runBatch({jobs, deps, bus})` thin over the existing `runBacktest` (one job at a time, emit progress), modeled on `scripts/fold-week.mjs`.
- [ ] **Step 4 — Run, verify pass.**
- [ ] **Step 5 — Failing test: analytics aggregation.**
```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { aggregate } from "../cli/lib/backtest-analytics.js";
test("aggregate computes cumulative R, expectancy, payoff", () => {
  const trades = [ {r:4,grade:"A+",model:"x",side:"long"}, {r:-1,grade:"B",model:"x",side:"long"}, {r:4,grade:"A+",model:"y",side:"short"} ];
  const a = aggregate(trades);
  assert.equal(a.cumR, 7); assert.equal(a.n, 3);
  assert.equal(a.winRate, 67); assert.equal(a.avgWin, 4); assert.equal(a.avgLoss, -1);
});
```
- [ ] **Step 6 — Run, verify fail; implement `aggregate`** (cumR, n, winRate, expectancy, payoff=avgWin/|avgLoss|, avgWin, avgLoss, maxDD from a running equity series, `equity[]`, and `byCut(trades, keyFn)` for grade/model/bias/entry-time + session concentration + outcome breakdown). Reuse the math from `scripts/analyze-patterns.mjs`.
- [ ] **Step 7 — Run, verify pass.**
- [ ] **Step 8 — IPC + hook:** add `backtest:start-range` in `ipc-backtest.js` calling `runBatch`; extend `useBacktest.js` reducer for batch progress + the ANALYTICS payload.
- [ ] **Step 9 — Port BACKTEST UI** from mockup `pop-backtest-analytics.jsx` + `pop-review-backtest.jsx`: NEW (symbol MNQ/MES/Both + date-range presets + session multi-select + AUTO/PAUSE + study summary), RUN/PAUSE/DONE states, ANALYTICS (from `aggregate`). No cost displays.
- [ ] **Step 10 — Verify in app** (`preview_*`: run a small range e.g. 2026-06-08→06-09 NY-AM MNQ; confirm progress → DONE → ANALYTICS numbers match a manual `node scripts/analyze-patterns.mjs` fold). Restart app first (main-process change).
- [ ] **Step 11 — Commit.** `git commit -m "feat(dashboard-v2): backtest range/batch runner + analytics + NEW form"`.

---

## Slice 5: REVIEW (SESSION / TRACK RECORD / LIBRARY)

**Files:** Modify `ReviewPopover.jsx`; reuse `Review.helpers.js`, `useReview`, `cli/lib/backtest-analytics.js` (for TRACK RECORD), a `fills` source (stub returning `[]` until execution).

- [ ] **Step 1 — Read** mockup `pop-review.jsx` for the v4 layout.
- [ ] **Step 2 — Port the header switcher** SESSION · TRACK RECORD · LIBRARY.
- [ ] **Step 3 — SESSION:** P&L hero + per-trade results strip (PAPER/LIVE+grade tags) + decision ledger (`Review.helpers.buildLedger`) + expand → plan-vs-actual reconciliation (from fills source; empty-safe) + confirmation checklist + why-this-grade + notes/tags + journal (auto + editable notes).
- [ ] **Step 4 — TRACK RECORD:** feed `aggregate` with the fills source filtered by account (LIVE/PAPER/BOTH, default LIVE) + window (Today/Week/Month/All); render the analytics components from Slice 4.
- [ ] **Step 5 — LIBRARY:** session-history table from `useReview` (date·session·sym·acct·grade·result·fills), row click → SESSION.
- [ ] **Step 6 — Verify in app** (`preview_*`: switch all three views; SESSION renders today's `useReview` data; TRACK RECORD shows empty/paper note until execution). Screenshot.
- [ ] **Step 7 — Commit.** `git commit -m "feat(dashboard-v2): REVIEW v4 (SESSION/TRACK RECORD/LIBRARY)"`.

---

## Slice 6: CHAT (4-channel)

**Files:** Modify `Shared.jsx` (ClaudeFeed) / a new `ChatPopover.jsx`; reuse `useChat` (claude/codex), bar-read messages (BRAIN), `useWalkers` (WALKERS).

- [ ] **Step 1 — Read** mockup `chat.jsx`.
- [ ] **Step 2 — Port the 4-channel popover:** CLAUDE/CODEX interactive (`useChat` per provider, per-provider input), BRAIN read-only (bar-read messages via `latestBarReadMessage`/filtered `useChat`), WALKERS read-only (`useWalkers`), + the peek strip.
- [ ] **Step 3 — Verify in app** (`preview_*`: open CHAT, switch channels, confirm read-only channels have no input). Screenshot.
- [ ] **Step 4 — Commit.** `git commit -m "feat(dashboard-v2): CHAT 4-channel v4"`.

---

## Final

- [ ] **Full suite:** `npm test` green; smoke fixtures unaffected.
- [ ] **Manual app pass:** every panel in dark + light via `preview_*`.
- [ ] **PR:** push `feat/dashboard-v2`, open PR vs main (UI wiring; execution engine follows). Deploy = switch main checkout back to main, merge, pull, restart.

---

## Self-review

- **Spec coverage:** shell ✓(S0) · account/settings/guarded-arm ✓(S1) · PREP ✓(S2) · LIVE+sizing+stubs ✓(S3) · backtest range/batch/analytics/NEW ✓(S4) · REVIEW 3-view ✓(S5) · CHAT ✓(S6) · executionAdapter stub ✓(S1) · deterministic/$0 backtest ✓(S4). Citations tooltip preserved (S2). Dark+light verified per slice.
- **Placeholders:** UI port steps reference the exact mockup file to read + the exact hook to wire + a preview-verify step — concrete, not "implement later." Full code given for all unit-tested logic (account, sizing, batch expansion, analytics).
- **Type consistency:** `sizeOrder`/`validateOrder`/`aggregate`/`expandJobs` signatures match between their tests and consumers.
- **Out of scope (execution spec):** real `placeOrder`/manage/fills — stubbed here; REVIEW results/track-record are empty-safe until then.

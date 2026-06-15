# Dashboard v2 — UI wiring spec

**Status:** draft for review · 2026-06-15
**Branch:** `feat/dashboard-v2`
**Companion spec:** [2026-06-15-execution-engine-design.md](2026-06-15-execution-engine-design.md) (built second)

## Goal

Port the approved v4 designer mockup (`~/Downloads/Dashboard Location (4)/`) into the real Electron app (`app/renderer/`), wiring every panel to the real data hooks. **UI + data wiring only** — real order execution is the companion spec, built second. Where a panel needs execution data (real fills), wire to a thin data source that the execution engine fills in later; until then it reads paper/empty state without breaking.

This is the lower-risk half: no broker writes, no live orders. It makes the new design real against existing read-only hooks.

## Why now / authority

Design is locked after a 4-round collaboration (see [[dashboard-redesign-execution]] memory; mockups v1→v4). The mockup's mock-data shapes were built ~1:1 against our hooks, so wiring is mostly swapping `MOCK.*` for hook reads. CLAUDE.md constraint #2 ("no broker writes") is untouched by this spec — only the companion execution spec changes it.

## Scope

**In:** the shell + all panels rebuilt to the v4 design, wired to real hooks: topbar (VER/ALERTS/NEWS/PAPER-LIVE badge/theme), bottom control strip (PREP/LIVE/REVIEW/BACKTEST/CHAT cells), PREP, LIVE (HUNT/TICKET/IN-TRADE/ADD layouts — display only), BACKTEST (NEW range form + RUN/PAUSE/DONE/ANALYTICS), REVIEW (SESSION/TRACK RECORD/LIBRARY), CHAT (CLAUDE/CODEX/BRAIN/WALKERS), Settings popover (ACCOUNT & EXECUTION — guardrails persist, account ephemeral). Backtest **range/batch runner** + **analytics aggregation** (deterministic, $0 — no execution dependency).

**Out (→ execution spec):** placing/closing real orders; the TICKET "Accept = send order"; the IN-TRADE manage buttons actually moving orders; real fills feeding REVIEW results + TRACK RECORD; the PAPER→LIVE arm actually routing to a broker. In this spec those are wired to no-op/stub adapters with the UI fully built.

## Approach

1. **CSS:** adapt the mockup's `workstation.css` + `screens.css` into the app's `app.css` (or import as a layer), mapping the mockup's CSS variables to the app's theme tokens. Keep dark + light.
2. **Shell:** the App shell already matches (topbar + full-bleed chart + bottom status line). Move the PREP/LIVE/REVIEW/BACKTEST/CHAT cells into the bottom control strip (mockup already did this in the design); add the PAPER/LIVE account badge + the ACCOUNT & EXECUTION settings popover; remove the symbol switcher.
3. **Per-panel:** rebuild each panel component to the mockup layout, replacing `MOCK.*` with the hook below. Keep pure helpers (`*.helpers.js`) and add unit tests (`node --test`, matching the project pattern).
4. **New deterministic backend:** the backtest range/batch runner + analytics aggregation (no execution needed — folds recorded tapes like the fold scripts).

## Per-panel wiring

| Panel / piece | Real hook / source | New work |
|---|---|---|
| Topbar VER | `useVersion` | none |
| Topbar ALERTS | `useAlerts` (+ `window.api.alert`) | none |
| Topbar NEWS | `useCalendar` (`window.api.calendar`) | none |
| Topbar PAPER/LIVE badge | new `useAccount` (ephemeral mode + guardrails) | new hook (mode in-memory; guardrails localStorage) |
| Bottom cells | usePrep / useLive / useReview / useBacktest / useChat | relocate to control strip |
| PREP | `useSessionBrief` + `Prep.helpers` | restyle to v4; keep checklist mapping |
| LIVE · HUNT | `useActiveSetup`, `useLive`, `useChat` (bar-read) | restyle; confirmation rows via `Live.helpers.pillar3ToConfirmationRows` |
| LIVE · TICKET | `useActiveSetup` + `useAccount` (default risk, max) + new `sizing` | UI + sizing read-out; **Accept = send is stubbed** (execution spec) |
| LIVE · IN-TRADE | `useTrades`/trade-ticker + `Live.helpers.liveGridFromTrade` | restyle; **manage buttons stubbed** |
| LIVE · ADD | walker `scale_in_add` candidate via `useWalkers`/`useActiveSetup` | surface as ADD-badged candidate |
| BACKTEST · NEW | `useBacktest` + new range/session/symbol inputs | **new batch runner** (range × sessions × symbol) |
| BACKTEST · RUN/PAUSE/DONE/DETAIL | `useBacktest` events (`backtest:event`) | restyle to v4 states |
| BACKTEST · ANALYTICS | new `analytics` aggregation over runs | **new aggregation** (cumulative-R, expectancy, breakdowns, equity curve) |
| REVIEW · SESSION | `useReview` + `Review.helpers` | restyle; results strip + ledger; reconciliation reads fills (stub until execution) |
| REVIEW · TRACK RECORD | reuse analytics aggregation over **real fills** | LIVE/PAPER/BOTH filter + window; fills source stubbed until execution |
| REVIEW · LIBRARY | `useReview` session history | session table |
| CHAT | `useChat` (claude/codex) + bar-reads (BRAIN) + `useWalkers` (WALKERS) | restyle to 4-channel |
| Settings ACCOUNT & EXECUTION | `useAccount` | guardrails persist (localStorage); account ephemeral (boots PAPER, clears stale key); guarded LIVE arm UI (arm action stubbed → execution spec) |

## New deterministic modules (no execution dependency)

- **Backtest batch runner** (`app/main/backtest-batch.js`): given `{symbol: MNQ|MES|both, from, to, sessions[]}`, expand to (date × session × symbol) jobs, run each via the existing `runBacktest` (or fold recorded tapes), aggregate. Models on `scripts/fold-week.mjs` (already proven). Emits progress events for the RUN state.
- **Analytics aggregation** (`cli/lib/backtest-analytics.js` or reuse `analyze-patterns` logic): cumulative-R, expectancy, win%, payoff, avg win/loss, max DD, equity curve series, breakdowns by grade/model/bias/entry-time, session concentration, outcome breakdown. Pure function over a run/trade list → analytics object. Feeds both BACKTEST ANALYTICS and REVIEW TRACK RECORD (latter filtered to real fills).

## Stubs (handed to the execution spec)

A single `executionAdapter` interface with no-op implementations now: `placeOrder()`, `flatten()`, `moveStopToBE()`, `panic()`, `trail()`, `cancel()`, `armLive()`. UI calls these; they toast "execution not wired yet" until the execution spec implements them against TV. REVIEW results + TRACK RECORD read from a `fills` source that returns empty until execution writes fills. This keeps the UI fully built and testable without any broker code.

## Testing

- Pure helpers (sizing read-out math, analytics aggregation, batch-job expansion, account-mode logic) → `node --test` unit tests, matching the project's renderer-helper pattern (`*.helpers.js`).
- `npm test` stays green; smoke fixtures unaffected.
- Preview verification via the dev instance (separate from the live app).

## Risks / sequencing

- **Live-app isolation:** build in this worktree; the live app stays on the deployed main checkout. Decide preview approach (separate dev instance vs main-checkout hot-reload) before coding — default: separate instance so live trading is never disrupted.
- **Execution coupling:** REVIEW results + TRACK RECORD are visually complete but data-empty until the execution engine produces fills. Acceptable for UI-first; flagged.
- **CSS port:** the mockup CSS is large (~78KB); port incrementally per panel rather than wholesale to avoid regressions.

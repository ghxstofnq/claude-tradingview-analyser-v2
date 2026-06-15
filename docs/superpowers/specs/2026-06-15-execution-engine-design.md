# Execution engine — design spec (build-ready)

**Status:** locked for planning · 2026-06-15 (refined from the draft after a feasibility spike + brainstorm)
**Branch:** fresh branch off `main` (`feat/execution-engine`), isolated from the dashboard-v2 work and the separate backtest session.
**Companion:** [2026-06-15-dashboard-v2-ui-design.md](2026-06-15-dashboard-v2-ui-design.md) (merged — provides the ticket/buttons/blocked-state UI + the `executionAdapter` stub this fills in).

## Goal

Wire the dashboard's order controls to **real orders through TradingView, paper-first**. On accepting a setup the trader enters a $ risk; the engine sizes it to micro contracts, runs guardrails, and places the entry + an SL/TP bracket. In-trade buttons modify the live position. Fills + outcomes are captured and feed REVIEW (built next, after this works).

This is the **higher-risk** half — automated, real-money-capable order placement. Built isolated, behind a guarded PAPER→LIVE switch, **paper-first**.

## ⚠ Constraint change

This **reverses CLAUDE.md hard constraint #2** ("CLI only — no MCP tools" / "the system must not drive the broker / no broker writes"). The dashboard becomes an order-placing surface. **CLAUDE.md #2 + `docs/decisions-log.md` must be updated as part of this work** with the new posture: the system may place/modify/close orders through the **in-app TradingView webview**, paper-first, behind the guarded LIVE arm, with the guardrails below. This spec is the authority for that change; flag it explicitly in review. The CLI/analysis path (`packages/core` on CDP 9225) is unchanged and still does not place orders.

## Locked decisions (this brainstorm)

1. **Broker:** TradingView's built-in **Paper Trading** (zero signup, simulates fills on the chart symbols MNQ1!/MES1!). A real futures broker is connected later for the live flip; the adapter interface does not change.
2. **Order surface:** the **in-app `<webview>` on CDP 9223** (the chart the trader watches), NOT TV Desktop (9225, the analysis backend). Keeps trading isolated from capture/replay.
3. **First milestone:** a **thin vertical slice** — accept → size → place entry + SL/TP bracket → see the position → FLATTEN + PANIC — proven on paper before BE/TRAIL/CANCEL/ADD are added.
4. **Placement mechanism:** decided by an **M0 feasibility spike** (below). Preference order: (A) replay TradingView's trading network message (websocket/REST) discovered by intercepting one manual paper order — precedent `packages/core/alerts.js` which POSTs TV's `create_alert`; fallback (B) DOM automation of the trade panel. **Position/fill state is always READ from the account-manager DOM** regardless of placement path. Everything downstream of placement is identical for A or B.

**Feasibility finding (2026-06-15 spike):** neither TV instance currently has a broker connected — there is latent trading UI (account-manager stub, order/trading toast groups) but no active account, order ticket, or balance. **Prerequisite: the user connects "Paper Trading" once in the in-app TradingView trade panel** before M0 can run.

## Architecture (isolated, testable units)

### 1. Sizing — `cli/lib/sizing.js` (exists) + `app/renderer/src/Sizing.helpers.js` (exists)
Pure, deterministic (constraint #7 — no LLM math): `contracts = floor($risk ÷ (stopPts × pointValue))`, pointValue MNQ $2 / MES $5; pick the whole-micro count within **±$50** of target, else **block**. Returns `{contracts, actualRisk, pctOfMax, withinTolerance, blockReason?}`. Already unit-tested; no change expected beyond reuse in main.

### 2. CDP webview client — `app/main/execution/cdp-webview.js` (new)
A thin CDP client pinned to the **9223 `type:"webview"`** target (TradingView). Connect, `Runtime.evaluate`, `Network` enable for the spike. Distinct from `packages/core` (9225, analysis) so the two never interfere. Re-acquires the target on webview reload.

### 3. Execution adapter — `app/main/execution/tv-adapter.js` (new)
Implements the interface the UI stubbed, driving the webview via #2. Slice scope first, then the rest:
- `placeOrder({side, type:market|limit, contracts, entry, stop, tp, account})` → entry + **OCO SL/TP bracket**.
- `flatten()` → close position at market + cancel working orders.
- `panic()` → flatten all + cancel all (emergency).
- *(M5)* `moveStopToBE()`, `trail(level)`, `cancel()`, `addToPosition({...})`.
- `armLive()` / `returnToPaper()` → switch the adapter's target account (paper-only until the slice is solid).
- `readState()` → parse the account-manager DOM → `{position, workingOrders, balance}` for the IN-TRADE panel + fill capture.

### 4. Guardrails — `app/main/execution/guardrails.js` (new)
Pure; run **before every order fires** (orders fire immediately on accept — this is the gate). `check({risk, sizing, dayState, guards})` → `{ok}` or `{block:true, reason}`:
- Always-on: require a valid stop; block if no size within ±$50.
- User-chosen: max $ per trade (reject over); daily-loss halt (block new entries after the day hits the limit / the existing loss-halt).

### 5. Fills + outcomes — `app/main/execution/fills.js` (new)
On fill/exit, append a record to `state/trades/<date>.jsonl`: planned (entry/stop/tp/R) + actual (fill, slippage, exit type, real R + $, account PAPER|LIVE, held time). REVIEW (next project) reads these for SESSION reconciliation + TRACK RECORD (LIVE-default filter).

### 6. IPC — `app/main/ipc-execution.js` (new) + preload exposure
`execution:place / flatten / panic / state / arm / disarm` (+ M5 verbs). Renderer's `executionAdapter.js` becomes a thin `window.api.execution.*` wrapper (replacing the stub). Account mode + guards already live in renderer state (boots PAPER, ephemeral) and ride along on each call.

## Milestones (thin slice → full)

- **M0 — mechanism spike.** With Paper Trading connected, place ONE manual paper order while capturing webview `Network` + DOM. Decide A (network replay) vs B (DOM). Document the chosen path. *No engine code committed until this resolves.*
- **M1 — read state.** `readState()` parses the account-manager DOM (position, working orders, balance). Verified against a manual paper position.
- **M2 — place entry + bracket.** `placeOrder` via the chosen path; guardrails before fire; ticket shows computed micros + actual $; verify the paper position + SL/TP appear.
- **M3 — FLATTEN + PANIC.** Close/cancel verified; PANIC flattens all.
- **M4 — fills → record.** Fill/exit writes `state/trades/<date>.jsonl`; IN-TRADE panel reads live position from `readState()`.
- **M5 — BE / TRAIL / CANCEL / ADD.** Layer remaining controls; ADD adds to the position (walker chain already emits `scale_in_add`).

## Safety model

- **Paper-first** — full flow validated on TV Paper Trading; LIVE arm stays disabled in code until M0–M4 are solid.
- **Pre-fire validation is the gate** — require-stop + ±$50 + max-$ + daily-halt; any failure blocks, never fires wrong.
- **Guarded LIVE arm** — deliberate type-"LIVE", ephemeral (boots PAPER), red across the UI when live (UI already built/verified).
- **PANIC** kill switch always available; manual broker control is the ultimate backstop.
- **No silent sizing** — every order shows computed contracts + actual $ risk on the ticket before firing.

## Testing

- Sizing + guardrails: pure `node --test` (±$50 boundary, floor/nearest, both point values, block-when-none-fit; each guardrail gate).
- Adapter: integration against TV **paper** only (scripted spike harness); **never auto-tested against live**.
- `readState()` DOM parse: fixture-based unit test on a captured account-manager HTML snapshot.
- Account-mode ephemerality: covered by the UI's verified reload test.

## Risks

- **Real money** — automated placement; mitigated by paper-first + guardrails + guarded arm + PANIC.
- **TV automation fragility** — DOM/network may change on TV updates; the M0 spike picks the most robust path; `readState()` parsing is isolated so a TV change touches one unit; PANIC + manual control are backstops.
- **Constraint reversal** — update CLAUDE.md #2 + decisions-log deliberately (a milestone deliverable, not silent).
- **Prerequisite** — Paper Trading must be connected by the user before M0; the engine surfaces a clear "no broker connected" state until then.

## M0 spike result (2026-06-15) — mechanism = path A (REST replay)

Captured a real paper order via `scripts/spike-tv-paper.mjs`. **Placement is a single clean REST POST from the page context** (the `alerts.js` pattern):

- **Place (entry + OCO SL/TP in one call):** `POST https://papertrading.tradingview.com/trading/place/<accountId>`
  body (JSON string): `{"symbol":"CME_MINI:MNQ1!","type":"market","qty":1,"side":"buy","sl":<px>,"tp":<px>,"outside_rth":false,"outside_rth_tp":false}`
- **Flatten:** `POST .../trading/close_position/<accountId>` body `{"symbol":"CME_MINI:MNQ1!"}`
- **Header gotcha:** content-type is `application/x-www-form-urlencoded; charset=UTF-8` (a CORS-simple type → no preflight). Do NOT use `application/json` (preflight → rejected). Fetch runs in the webview page context with `credentials:"include"` so the TV session rides along.
- **Acks** stream over the trading WebSocket (`{"m":"order_update"|"journal_update","p":{...,"accountId":<id>,"id":<orderId>,"status":...}}`).
- **Account id:** stable per user, only streams on activity → stored in `state/execution-config.json` (`paperAccountId`), self-healed from acks. Paper mode exposes NO REST reads (`/trading/accounts`, `/trading/state`, `/trading/orders/<id>` all 404/501).
- **State read caveat:** the bottom account-manager DOM only LIVE-updates when the panel is expanded; collapsed = stale. Live position read therefore needs the panel open or (M4) a trading-WS position tracker.

**Verified end-to-end on the live paper account (InnerCircleG):** `placeOrder` → 200 + a filled 1-contract long with SL/TP attached (position read back: `CME_MINI:MNQ1! Long 1 @ 30563.25, TP 30663.25, SL 30463.25`); `flatten` → 200 → flat; no leftover working orders. Implemented in `app/main/execution/tv-adapter.js` (`placeOrder`/`flatten`/`panic`) + `config.js`.

## Out of scope

Any broker beyond TV Paper Trading (for now); portfolio/multi-account; anything behind the LIVE arm until the slice is proven; REVIEW wiring (separate next project — this only writes the fill records it will read).

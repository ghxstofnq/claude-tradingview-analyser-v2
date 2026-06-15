# Execution engine — design spec

**Status:** draft for review · 2026-06-15
**Branch:** `feat/dashboard-v2` (built **second**, after the UI spec)
**Companion spec:** [2026-06-15-dashboard-v2-ui-design.md](2026-06-15-dashboard-v2-ui-design.md)

## Goal

Wire the dashboard's order controls to **real orders through TradingView**, paper-first. On accepting a setup the trader enters a $ risk; the engine sizes it to micro contracts and places the entry + a SL/TP bracket. The in-trade buttons (FLATTEN / BE / PANIC / TRAIL / CANCEL) modify the live position. Scale-ins surface as ADD candidates that add to the position. The engine captures fills + outcomes and feeds them to REVIEW (results + track record).

This is the **higher-risk** half — automated real-money order placement. It is built isolated, behind a guarded PAPER→LIVE switch, paper-first.

## ⚠ Constraint change

This **reverses CLAUDE.md hard constraint #2** ("CLI only — no MCP tools" / "the system must not drive the broker / no broker writes"). The dashboard becomes an order-placing surface. **CLAUDE.md + `docs/decisions-log.md` must be updated** as part of this work, with the new posture: the system may place/modify/close orders through TradingView, paper-first, behind the guarded LIVE arm, with the guardrails below. This spec is the authority for that change; flag it explicitly in review.

## Scope

**In:** the `executionAdapter` (stubbed by the UI spec) implemented against TradingView; deterministic sizing; guardrails enforcement; ephemeral account mode + guarded LIVE arm; fills/outcomes capture feeding REVIEW. **Paper-first**, then a flip to live.

**Out:** any broker beyond what TradingView connects to; portfolio/multi-account; anything not behind the LIVE arm.

## Architecture

### 1. Sizing (`cli/lib/sizing.js` — extend existing)
Pure, deterministic (constraint #7 — no LLM math): `contracts = floor( $risk ÷ (stopDistancePts × pointValue) )`, pointValue MNQ $2 / MES $5. Pick the whole-micro count whose risk is closest to target **within ±$50**; if none within ±$50 → **block** (no order). For market entries size off live price; for limit, off the entry price. Returns `{ contracts, actualRisk$, pctOfMax, withinTolerance, blockReason? }`.

### 2. Execution adapter (`app/main/execution/tv-adapter.js`)
Implements the interface the UI spec stubbed. Drives TradingView via the existing CDP control (`packages/core` over CDP 9225 / the webview), targeting TV's connected futures broker (Tradovate/AMP/etc.), **paper account first**:
- `placeOrder({side, type: market|limit, contracts, entry, stop, tp, account})` → entry + **OCO SL/TP bracket**.
- `flatten()` → close position at market + cancel working orders.
- `moveStopToBE()` → modify stop to entry.
- `panic()` → flatten all + cancel all (emergency).
- `trail(level)` / `cancel()` → modify/cancel working orders.
- `addToPosition({...})` → ADD: place more contracts on the existing position (not a new one).
- `armLive()` / `returnToPaper()` → switch the adapter's target account.

Mechanism (to confirm during a feasibility spike): drive TV's trade panel/DOM, or its internal order REST endpoint (precedent: `alerts.js` POSTs TV's `create_alert`). A spike validates which is reliable for the user's broker before full build.

### 3. Guardrails (`app/main/execution/guardrails.js`)
Enforced **before every order fires** (orders fire immediately on accept — no per-order confirm, so this is the gate):
- **Always-on:** require a valid stop; block if no size within ±$50.
- **User-chosen:** max $ per trade (reject over); daily-loss halt (block new entries after the day hits the limit / the existing 3-loss halt).
- On block → no order, surface the reason inline (the UI's blocked-order state).

### 4. Account mode (ephemeral) + guarded LIVE arm
Account mode lives in memory, **boots PAPER every launch** (never persisted; clear any stale `workstation:account` key — already done in the UI). Guardrails persist (settings, not risk state). LIVE arm: type-"LIVE"-to-enable gate → adapter targets the live account; one-click return to paper. Arming is per-session, never carried across restart (verified safe in the UI mockup).

### 5. Fills + outcomes → REVIEW
On fill/exit, write a fill record (`state/trades/<date>.jsonl` or similar): planned (entry/stop/tp/R) + actual (fill, slippage, exit type, real R + $, account PAPER|LIVE, held time). REVIEW SESSION reconciliation + TRACK RECORD read these (TRACK RECORD filters to LIVE by default).

## Safety model

- **Paper-first**: full flow validated on TV Paper Trading before any live flip.
- **Pre-fire validation is the gate** (immediate fire, no confirm): require-stop + ±$50 + max-$ + daily-halt all checked; any failure blocks, never fires wrong.
- **Guarded LIVE arm**: deliberate type-to-arm, ephemeral, red across the UI when live.
- **PANIC** kill switch always available.
- **No silent sizing**: every order shows computed contracts + actual $ risk before firing (on the ticket).

## Testing

- Sizing: pure unit tests (`node --test`) incl. ±$50 boundary, floor/nearest, both point values, block-when-none-fit.
- Guardrails: unit tests for each gate (require-stop, over-max, daily-halt, ±$50).
- Adapter: integration test against TV **paper** (manual/scripted spike); never auto-test against live.
- Account mode ephemerality: covered by the UI spec's verified reload test.

## Risks

- **Real money** — automated placement; mitigated by paper-first + the guardrails + the guarded arm.
- **TV automation fragility** — DOM/REST may break on TV updates; the feasibility spike picks the most robust path; PANIC + manual broker control are the backstops.
- **Constraint reversal** — must update CLAUDE.md/#2 + decisions-log deliberately, not silently.
- **Build only after the UI spec** is in place (it provides the adapter interface + the ticket/buttons/blocked-state UI this fills in).

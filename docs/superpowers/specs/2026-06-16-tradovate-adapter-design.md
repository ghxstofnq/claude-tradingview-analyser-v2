# Tradovate broker adapter — design

**Date:** 2026-06-16
**Status:** approved (approach A); building in stages
**Branch:** `feat/tradovate-adapter`

## Problem

The execution engine only knows TradingView's **paper** account. When the trader
switches TradingView to a connected **Tradovate** account, the app keeps showing
the paper account and can't route orders there.

## Discovery (live capture, 2026-06-16)

Tradovate is a **separate broker** behind TradingView, not another TradingView
account:

- **Host:** `https://tv-demo.tradovateapi.com` (a *demo* / simulated Tradovate
  environment — no real money), account id `D54476869`.
- **Endpoints** (TradingView's standard REST Broker API shape):
  `GET /accounts/{id}/state`, `/positions`, `/orders`, `/quotes`;
  `POST /accounts/{id}/orders` to place.
- **Auth:** `Authorization: Bearer <JWT>` — **not** the session cookie the paper
  API uses. TradingView holds this token in the webview and sends it on every
  request; it can be read off the webview's own traffic via CDP.

The paper adapter (`tv-adapter.js`) POSTs to `papertrading.tradingview.com` with
cookies. That shortcut is paper-shaped — Tradovate needs a different host + the
Bearer token.

## Approach (A — chosen)

Keep the existing "POST to the broker's REST backend from the app" approach, but
point it at Tradovate's host and attach TradingView's own token (sniffed from the
webview). We do **not** log into Tradovate separately — we piggyback on
TradingView's authenticated session. (Rejected B: drive TradingView's on-screen
order ticket — broker-agnostic but DOM-fragile.)

## Stages

### Stage 1 — detection (read-only, safe; this PR)

Make the app see + follow the active broker.

- **Token + account capture.** Extend `trading-feed.js` (already a CDP Network
  listener on the 9223 webview) to also handle `Network.requestWillBeSent`: when
  the URL matches `tradovateapi.com`, capture `{ token, accountId, host, lastSeenMs }`
  from the request (`Authorization` header + the `/accounts/{id}/` path segment +
  the host). Stored on the feed state as `tradovate`.
- **Active-broker derivation.** Pure `deriveActiveBroker({ tradovateLastSeenMs,
  now, thresholdMs })` → `"tradovate" | "paper"`. Tradovate polls its API every
  few seconds while it's the active account; if we've seen tradovate traffic
  within ~12s, Tradovate is active, else paper. Lives in a new
  `app/main/execution/tradovate.js` (pure helpers + token store).
- **Account gate.** `deriveActiveAccount` (account-gate.js) gains a Tradovate
  branch: when the active broker is Tradovate, the active account is
  `{ id: <D…>, type: "live", name: "Tradovate (demo)", broker: "tradovate" }`.
  (Type "live" so it rides the existing confirm-on-switch arming — even though
  demo, it's a real broker endpoint and we want the deliberate switch.)
- **Surface.** `execution:account` + `execution:state` already flow to the UI;
  the account/routing labels (Settings BROKER ROUTING, ORDERS routing pill) show
  the Tradovate account when active.

### Stage 2 — order routing (this PR; order format CONFIRMED by live capture)

**Confirmed order format (live demo capture 2026-06-16):**
- Place: `POST {host}/accounts/{id}/orders`, `content-type: application/x-www-form-urlencoded`,
  `Authorization: Bearer <token>`, body
  `instrument=<MESU6|MNQU6>&qty=<n>&side=<buy|sell>&type=market&durationType=Day&currentAsk=<ask>&currentBid=<bid>&stopLoss=<price>&takeProfit=<price>`
  (SL/TP optional, ABSOLUTE prices, in the SAME POST → one auto-bracketed order,
  no orphan-order problem) → `{"s":"ok","d":{"orderId":"…"}}`.
- Close: `DELETE {host}/accounts/{id}/positions/{positionId}` → `{"s":"ok"}`
  (positionId from `GET /accounts/{id}/positions`).
- `instrument` is the Tradovate CONTRACT symbol (MESU6), sniffed from
  `GET /quotes?symbols=` — NOT the chart's `CME_MINI:MES1!`.

- **Tradovate adapter** (`tradovate-adapter.js`). `placeTradovateOrder(order)` →
  builds the form body (`buildTradovateOrderBody` in `tradovate.js`) and POSTs it
  via a webview `evaluate` fetch with the sniffed Bearer token.
  `closeTradovatePosition()` → GET positions, DELETE each non-zero by id.
- **Routing.** `resolveTarget` / `tv-adapter` route to the Tradovate adapter when
  the confirmed account's `broker === "tradovate"`, else the existing paper POST.
- **Positions/fills.** Poll `GET /accounts/{id}/positions` + `/orders` (with the
  token) for the live position + fills, mapped to the engine's model.
- **Guardrails unchanged** — valid stop · size in tolerance · per-trade max ·
  daily-loss halt apply to Tradovate orders too.

## Safety

- Stage 1 is read-only — no orders, no money.
- Tradovate here is **demo** (`tv-demo`), i.e. simulated money. A real funded
  Tradovate account would be the same adapter pointed at the live host
  (`live.tradovateapi.com`-style) — that, plus the first real-money order, stays
  behind a separate explicit sign-off.
- Order placement reuses the type-"LIVE" arm + boot live-auto-pause from PR #90.
- The first Tradovate order is a deliberate PLACE the trader presses; the engine
  never fires the first one autonomously.

## Out of scope

- Real-money (funded) Tradovate — same adapter, different host, separate sign-off.
- Auto-engine (walker/tranche) routing to Tradovate — manual ORDERS first.
- Token refresh edge cases beyond "use the most recently seen token".

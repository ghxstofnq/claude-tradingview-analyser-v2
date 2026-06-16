# ORDERS popover — manual order ticket — design

**Date:** 2026-06-16
**Status:** approved (design), pending spec review
**Branch:** `feat/orders-popover`

## Goal

A new topbar popover, **ORDERS**, beside CHAT. A manual order ticket that sizes
itself from the trader's per-trade risk and the live ICT structure, then places a
market order (with its own stop, and an optional take-profit) to the confirmed
broker account. Paper today; the same ticket routes live the day a live account is
armed — no ticket changes. It reuses everything the execution engine already
built (risk from Settings, the size-from-stop formula, the guardrails, the
confirmed-account routing, Flatten).

This is for **discretionary manual trades** the trader decides to take — separate
from the auto walker/tranche chain, which keeps producing its own setups.

## User-facing behavior — the ticket

Top to bottom:

1. **Position line** — the open position (symbol · side · qty · avg · live uPnL),
   or "flat". Read from the live trading feed.
2. **Symbol** — follows the analysis chart (MNQ1! / MES1!), read-only. This is the
   symbol the structure + draws are read from and the order is placed for.
3. **Buy / Sell** toggle — the trader picks the side.
4. **Price** — current market price; the market-order entry estimate.
5. **Stop** — defaults to the auto nearest live structure beyond entry (below for
   Buy, above for Sell), offset a small tick buffer further out. Shows the source
   (e.g. "swing low", "leg low", "NYAM.L"). Three ways to set it:
   - leave it on **auto** (default),
   - pick a specific level from the **stop-draws dropdown**,
   - or **type** an exact level. A typed value always wins.
6. **TP** (optional) — a **TP-draws dropdown** of untaken session / PD / PW draws
   (+ untaken equal-high/low liquidity pools) that sit beyond entry on the target
   side (above for Buy, below for Sell), nearest-first, each labelled with its name,
   price, and the R it represents. Pick one → its exact price drops into the TP
   field. Or type a level. Or leave blank for a stop-only order.
7. **Risk** — defaults to the per-trade dollars from Settings (`defaultRisk`,
   $120 now). Editable per-ticket for a one-off; the edit does **not** change the
   saved Settings value.
8. **Size + R:R** — contracts sized so the dollar risk ≈ the risk target (within
   ±$50), the actual dollar risk, and the **R:R** of the chosen stop/TP. All
   computed in code.
9. **PLACE** — fires a market order carrying its own stop (and TP if set) to the
   confirmed account, after the standard guardrail gate.
10. **FLATTEN** — one-tap market close of the open position for this symbol.

A **routing banner** shows the confirmed account (e.g. "paper · 9256021") or a
block ("confirm account" / "live blocked") sourced from the existing
account-arming gate. PLACE is disabled when not routable.

## Architecture

The main process owns **all** order math and the engine read; the renderer is a
display surface that calls IPC and shows the result. This keeps one tested source
of truth and means the placed order is always re-validated server-side, never
trusting renderer-computed numbers.

- **Context read** — one fast pull gives symbol, current price, the structural
  stop candidates, and the untaken draws. Source: a fresh `state/last-scan.json`
  if recent, else an on-demand `analyze --pillar3-only` against the analysis chart
  (TV Desktop 9225). Cached in-memory in main; refreshed on open / a Refresh
  button / staleness.
- **Preview** — pure computation from the cached context (auto-stop, effective
  stop, size, R:R, draw lists, block reason). Recomputed on every side / stop / TP
  / risk change. Instant (no refetch).
- **Place** — refetches a fresh context, recomputes the preview, runs the
  guardrails, then places via the existing adapter. Authoritative.

## Data sources (exact bundle paths)

All from a standard `tv analyze` bundle (current TF, the analysis chart):

- **Symbol / price:** `chart.symbol`, `quote.last`.
- **Structural stop candidates** (gathered, then filtered by side at pick-time):
  - swing pivots: `gates.engine.pillar3.swings.swing[]` and `.internal[]` — each
    `{ price, is_high, swept, bar_ms }`.
  - session levels: `gates.engine.pillar1.session_levels.<KEY>` — each
    `{ name, price, swept, position_vs_price }` (PDH/PDL/PWH/PWL/AS_H/AS_L/LO_H/
    LO_L/NYAM_H/NYAM_L/NYPM_H/NYPM_L).
  - leg extremes: `gates.engine.pillar2.current_tf.leg_high` / `.leg_low`.
- **TP draws** (untaken only — a swept level is no longer a draw):
  - `gates.engine.pillar1.untaken_buy_side_above[]` — `{ name, price, ... }` (Buy
    targets).
  - `gates.engine.pillar1.untaken_sell_side_below[]` (Sell targets).
  - `gates.engine.pillar1.untaken_pools_above[]` / `untaken_pools_below[]` — equal-
    high/low pools, `{ kind:'eqh'|'eql', price, swept }`.

These are the same fields the live bridge (`bridgeEngineEvidence` in
`bar-close.js`) and the engine gates already use — the ORDERS reader gathers them
directly from the bundle so it has no dependency on the live bar-close path.

Strategy authority: untaken draws as TP targets — `docs/strategy/trading-strategy-2026.md`
§2.1 (draws / liquidity), constraint #11. Stop at structure —
`docs/strategy/entry-models.md` (stop placement), §6.

## Components & files

### New — pure (no electron / IO, unit-tested)

**`app/main/execution/sizing-core.js`**
Extracts the existing size-from-stop formula into one shared function so the manual
ticket and the tranche manager use identical math.
```js
// point value: MES* = 5, else 2 (MNQ). tick = 0.25.
export function pointValue(symbol) { return String(symbol||"").startsWith("MES") ? 5 : 2; }
export function tickSize(/* symbol */) { return 0.25; }
// contracts sized to target risk; withinTolerance mirrors guardrails (±$50, ≥1c).
export function sizeFromStop({ symbol, entry, stop, riskUsd }) {
  const pv = pointValue(symbol);
  const stopPts = Math.abs(Number(entry) - Number(stop));
  if (!(stopPts > 0) || !(riskUsd > 0)) return { contracts: 0, stopPts: 0, actualRiskUsd: 0, withinTolerance: false };
  const contracts = Math.max(0, Math.round(riskUsd / (stopPts * pv)));
  const actualRiskUsd = Math.round(contracts * stopPts * pv);
  return { contracts, stopPts, actualRiskUsd, withinTolerance: contracts >= 1 && Math.abs(actualRiskUsd - riskUsd) <= 50 };
}
```

**`app/main/execution/manual-order.js`**
The ticket's logic.
```js
const STOP_BUFFER_TICKS = 2;   // place the stop this many ticks beyond the level

// Gather structural stop candidates from a bundle (swings + session levels + leg).
// → [{ kind, price, name?, swept?, ref }]
export function structuralStopCandidates(bundle) { /* reads the paths above */ }

// Gather untaken draws split above/below price.
// → { above: [{ name, price, kind, ref }], below: [...] }  (deduped by price)
export function untakenDraws(bundle) { /* reads the untaken_* paths above */ }

// Nearest candidate strictly beyond entry on the stop side, offset by the buffer.
// long  → highest candidate < entry, minus buffer ticks
// short → lowest  candidate > entry, plus  buffer ticks
// → { price, kind, name?, ref } | null
export function pickAutoStop({ side, entry, candidates, symbol }) { /* ... */ }

// Draws usable as TP for the side, beyond entry in the profit direction, sorted
// nearest-first. long → draws.above filtered > entry; short → draws.below < entry.
export function tpDrawsForSide({ side, entry, draws }) { /* ... */ }

// reward:risk for the chosen stop/tp (1 decimal) or null when tp missing.
export function rr({ side, entry, stop, tp }) { /* |tp-entry| / |entry-stop| */ }

// Compose the full preview + the order skeleton + a block reason.
// block ∈ null | "no_stop" | "stop_wrong_side" | "no_size"
export function buildOrderPreview({ side, entry, symbol, bundle, typedStop, typedTp, riskUsd }) {
  // effectiveStop = typedStop ?? pickAutoStop(...).price
  // validates side (long stop < entry, short stop > entry), sizes, computes rr,
  // builds tp draw list, returns { symbol, entry, side, stop, stopSource, tp,
  //   contracts, actualRiskUsd, withinTolerance, rr, stopOptions[], tpDraws[], block }
}
```

### New — main (IO / IPC)

**`app/main/execution/order-context.js`**
```js
// Fresh structure + price for the ticket. Prefers a recent last-scan; else runs
// an on-demand pillar3-only analyze against the analysis chart. Caches the last
// good context in memory.
// → { symbol, price, candidates, draws, ts, source, stale }
export async function getOrderContext({ maxAgeMs = 30_000 } = {}) { /* ... */ }
export function cachedOrderContext() { /* last good, for preview */ }
```

### Modified

**`app/main/ipc-execution.js`** — three handlers:
- `execution:orderContext` `{ refresh? }` → `getOrderContext()`; updates the cache.
- `execution:orderPreview` `{ side, typedStop, typedTp, riskUsd }` →
  `buildOrderPreview` against `cachedOrderContext()`. Pure/instant.
- `execution:placeManual` `{ side, typedStop, typedTp, riskUsd }` → fresh
  `getOrderContext` → `buildOrderPreview` → `checkOrder` guardrails →
  `tvAdapter.placeOrder({ symbol, side, type:"market", entry, stop, tp, contracts })`.
  Returns `{ ok, blocked?, ...gate, result? }`.
  (`execution:flatten` + `execution:state` + `execution:account` reused unchanged.)

**`app/main/execution/tranche-manager.js`** — `sizePacket` delegates to
`sizeFromStop` from `sizing-core.js` (behavior-preserving; a parity test locks it).

**`app/preload.cjs`** — extend the `execution` group:
```js
orders: {
  context(opts) { return ipcRenderer.invoke("execution:orderContext", opts || {}); },
  preview(p)    { return ipcRenderer.invoke("execution:orderPreview", p); },
  place(p)      { return ipcRenderer.invoke("execution:placeManual", p); },
},
```

**`app/renderer/src/OrdersPopover.jsx`** (new) — exports `OrdersCell` (topbar
button + `.bt-popover` body, ~420px). Subscribes to `topbar:open-cell`
(`which === "orders"`). Local state: `side`, `typedStop`, `typedTp`, `riskUsd`
(seeded from `execution.config.get().guards.defaultRisk`). On open / refresh calls
`orders.context()`; on any field change calls `orders.preview()` (debounced).
Renders the ticket, the two dropdowns, the size/R:R block, the routing banner,
PLACE, and FLATTEN. Position line + routing from `execution.state()` /
`execution.account.get()`.

**`app/renderer/src/Orders.helpers.js`** (new) — pure renderer formatters
(`formatDrawOption`, `formatStopSource`, `routingLabel`) for `node --test`.

**`app/renderer/src/App.jsx`** — import + render `<OrdersCell symbol={symbol} />`
beside `<ChatCell/>`; add an `"orders"` case + hotkey (`o`) to the open-cell
switch.

**`app/renderer/src/app.css`** — minimal: reuse `.bt-popover` / `.pill`; add at
most a couple of `.orders-*` rules for the dropdown rows.

## Auto-stop + TP rules (precise)

- **Auto-stop side:** long → stop below entry; short → stop above entry. Pick the
  structural candidate **nearest to entry but still beyond it** on the stop side,
  then move it `STOP_BUFFER_TICKS` (2) further from entry so the level itself isn't
  the exact stop. If no candidate exists on the stop side → `autoStop = null`.
- **Typed stop overrides** auto and dropdown. A typed stop on the wrong side of
  entry (long stop ≥ entry, or short stop ≤ entry) → `block = "stop_wrong_side"`.
- **No stop at all** (auto null, none typed) → `block = "no_stop"`; PLACE disabled.
- **TP draws:** untaken levels + untaken pools beyond entry in the profit
  direction, sorted nearest-first, each carrying name/price/`ref` and a computed R.
  Selecting sets `typedTp`. TP is optional — blank places a stop-only order.

## Sizing, R:R, guardrails, routing (reused)

- **Size:** `sizeFromStop({ symbol, entry, stop, riskUsd })`. `block = "no_size"`
  when no whole contract lands within ±$50 of the risk target.
- **R:R:** `|tp - entry| / |entry - stop|`, 1 decimal, computed in code. Shown per
  TP draw option and for the live ticket.
- **Guardrails:** `checkOrder` runs in `placeManual` — valid stop, size in
  tolerance, per-trade max, daily-loss halt. Same gate as the engine.
- **Routing:** `placeOrder` resolves the target through the existing
  `resolveTarget` (confirmed account; live blocked until `liveHost`). Paper today,
  live later, identical ticket.

## Edge cases / fallbacks

- **Structure unavailable** (TV Desktop down / analyze fails): context returns
  `stale:true`; the stop field stays empty and the banner reads "structure
  unavailable — type a stop". Price falls back to `execution.state().price` (the
  webview mid) so sizing still works off a typed stop.
- **Account not routable** (unconfirmed / live blocked): PLACE disabled + banner.
- **Existing position:** shown in the position line; a manual order nets into it on
  the account (same as the engine adds). No special handling.
- **Symbol skew:** the order is for the analysis-chart symbol; the trader keeps the
  display on the same instrument (single-instrument MNQ/MES workflow).

## Testing

- `tests/sizing-core.test.js` — `sizeFromStop` (MNQ $2/pt, MES $5/pt, ±$50
  tolerance boundary, sub-1-contract → not tradable) + a parity assertion that the
  refactored `tranche-manager.sizePacket` returns the same numbers as before.
- `tests/manual-order.test.js` — `pickAutoStop` (long picks nearest below, short
  nearest above, buffer applied, none → null), `tpDrawsForSide` (side filter +
  sort + only-beyond-entry), `rr`, `buildOrderPreview` block reasons
  (`no_stop`, `stop_wrong_side`, `no_size`, and a clean A+-style pass).
- `tests/order-context.test.js` — gathering candidates + draws + symbol + price
  from a fixture bundle (`structuralStopCandidates` / `untakenDraws`).
- `tests/orders-helpers.test.js` — the renderer formatters.
- `npm run smoke:fixtures` unchanged (no analyze schema change).

## Out of scope (v1)

- Limit / typed-entry orders — market only, as specified.
- Managing an existing position's break-even / trail / cancel — stays in the LIVE
  popover.
- Bracketing a manual order as independent tranches — a single bracket per manual
  order; the tranche engine remains the auto path.
- Live placement — wired and routed, but blocked until the deferred live-discovery
  spike + sign-off (unchanged from PR #90).

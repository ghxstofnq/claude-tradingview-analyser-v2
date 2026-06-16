# Real-broker arming — design

**Date:** 2026-06-16
**Status:** Spec for review (plumbing only; no live order until a separate sign-off)
**Goal:** Let the execution engine route to a real (funded) broker account instead of only paper — safely — by following whatever account is active in TradingView and gating any switch (especially into a live account) behind a deliberate confirm.

---

## Why

Today the execution engine is paper-only by construction:
- `app/main/execution/tv-adapter.js` hardcodes `HOST = "https://papertrading.tradingview.com"`.
- The paper account id is in `state/execution-config.json` (`9256021`) and self-heals from the trading WS (`rememberAccountId`).
- The UI has a PAPER/LIVE badge + a type-"LIVE" arm gate (`Account.helpers.armReady`), but `executionAdapter.armLive` / `returnToPaper` are **stubs** — arming "live" changes renderer state only; the adapter still POSTs to the paper host. So "live" does nothing real.

This builds the plumbing to route real orders, with real-money safety, but stops short of firing one (that needs a live broker connected + a discovery spike + explicit sign-off).

## Decisions (from Q&A, 2026-06-16)

1. **No live broker is connected yet.** Build the plumbing now against the paper shape; the live-endpoint discovery spike is gated to when a funded broker is actually connected.
2. **Live automation = same as paper.** No extra per-mode gating for live; the existing **risk guardrails** (max $/trade, daily-loss halt) are the safety, and orders fire on accept as today.
3. **Auto-discover the active account + confirm on switch.** The engine follows whatever account is active in TradingView (no manual id config). Any *change* in the active account pauses routing and requires a one-time confirm before the engine will route to the new account — and a switch into a **live** account uses the serious (type-"LIVE") confirm.

## The account id (context)

The account id is the segment in the order URL `/trading/place/<accountId>` — it selects which of the user's TradingView accounts an order routes to (the paper sim, or a live broker account; a user can have several). The trading WS stamps the account id on its frames; the feed already captures + persists it (`rememberAccountId`). This design extends that from "remember the id we saw" to "track the *active* account (id + type), follow switches, and gate them."

---

## Architecture

### 1. Active-account source (`app/main/execution/active-account.js`, new)
A single read interface: `getActiveAccount() → { id, type: "paper"|"live", name } | null`.
- Primary source: the trading-feed WS (already receives `accountId`; extended to also capture account **type** + name when present, and to update on a TradingView account switch).
- The exact proactive-read mechanism (active account **before** any order activity, on connect/switch, + the paper-vs-live signal) is confirmed by the **discovery spike** (below). Until confirmed, `type` derives from the host the account belongs to (paper host → `paper`).
- Returns `null` when the active account is not yet known — callers treat unknown as "do not route".

### 2. Confirm-on-switch gate (`app/main/execution/account-gate.js`, new — the pure core)
```
resolveAccountGate({ active, confirmed }) → { route, needsConfirm, level, reason }
```
- `active == null` → `{ route:false, reason:"no_active_account" }`.
- `active.id === confirmed?.id` → `{ route:true }`.
- `active.id !== confirmed?.id` → `{ route:false, needsConfirm:true, level: active.type === "live" ? "live" : "paper" }`.
This is pure and unit-tested. The runtime stores `confirmedAccount` (id + type + name) in main config; confirming sets `confirmedAccount = active`. A `level:"live"` confirm requires the type-"LIVE" gate (`armReady`); `level:"paper"` is a one-click confirm.

### 3. Routing (adapter, modified)
`tv-adapter` chooses host + account id from the **confirmed active account**, not a hardcoded host:
- `paper` → `papertrading.tradingview.com` + the paper id.
- `live` → the live host + live id (host filled by the discovery spike; stored in config).
Every order/flatten/cancel + the auto-fire path first checks `resolveAccountGate`; on `route:false` it does **not** send and surfaces the reason (no_active_account / needsConfirm). So orders only ever go to a confirmed account.

### 4. Persist the confirmed account across restarts (user decision, 2026-06-16)
`confirmedAccount` **persists** across app restarts (it is NOT reset to paper on launch). On restart, routing resumes to the last-confirmed account — including a live one — with no re-confirm. This reverses today's "boot PAPER, clear stale" in `Account.helpers` (that behavior is replaced). A fresh confirm is required only when the active account **changes** from the persisted confirmed one.

**Boot guard for live auto (user decision, 2026-06-16):** the confirmed account persists, so **manual** entries to it (including live) resume immediately on restart. But if the confirmed account is **live** AND an **auto** mode is set, **auto-fire is paused on boot until the user taps "resume auto" once** — this removes the only path where a restart resumes unattended real-money firing. Manual entries are unaffected; paper auto resumes normally. Implemented as a boot-time `autoPausedForLive` flag (set on launch when confirmed=live, cleared by the tap); the tranche manager / auto path checks it and no-ops while set. The UI shows a clear "LIVE auto paused — tap to resume" state on boot.

### 5. UI (`SettingsPopover.jsx` + the account cell, modified)
- Shows the **active** account (name · id · PAPER/LIVE) and whether it matches the confirmed one.
- On a pending switch: a confirm panel — live switch = the existing type-"LIVE" gate; paper switch = a one-click "route to <name>" button.
- The badge reflects the **confirmed** account's type. `armLive`/`returnToPaper` are replaced by "confirm active account" (live confirm) / "return to paper".

### 6. Discovery spike (gated, separate — not in this build's order path)
A one-time read-only spike, run when a funded broker is connected, confirms: (a) reading the active account + type proactively (connect/switch), (b) the live trading **host** + path, (c) the live account id. It writes `liveHost` to config. **No live order fires until this is done and a live account is confirmed.** Modeled on the paper M0 spike (`scripts/spike-tv-paper.mjs`).

### Config additions (`execution/config.js`)
`confirmedAccount: { id, type, name } | null` (**persisted across restarts**; defaults to the paper account only on first run / when never set), `liveHost: string | null` (filled by the spike), `paperHost` (default `papertrading.tradingview.com`). Existing `paperAccountId` + `guards` unchanged. account "mode" is derived from `confirmedAccount.type`, not a separate flag.

---

## Error handling
- **Active account unknown** → block routing, surface "active account unknown — open the trading panel". Never guess.
- **Active ≠ confirmed** → block + surface the confirm (live = type-LIVE).
- **Live confirmed but `liveHost` null** (spike not run) → block live routing with "live endpoint not configured — run discovery". This makes accidental live routing impossible before the spike.
- A gate failure never throws across IPC — structured `{ ok:false, blocked, reason }`, like the existing guardrail path.

## Testing
- **Pure:** `resolveAccountGate` matrix (no active / match / paper switch / live switch); confirmed-account persistence (survives a simulated restart); the boot `autoPausedForLive` rule (set when confirmed=live on launch, blocks the auto path until cleared, never affects manual or paper-auto); `armReady` live-confirm gate. Unit-tested with `node --test`.
- **Integration (paper, no live):** the read-only discovery spike confirms the active-account read on the existing paper account (proves the mechanism without a live broker); a paper "switch confirm" can be exercised by reconfirming the same paper account.
- **Not testable until a live broker exists:** the live host/id + a real order — explicitly deferred to the sign-off.

## Scope / what this builds vs defers
- **Builds now (inert for live):** active-account tracking, the confirm-on-switch gate, persisted confirmed account, adapter host/id-by-account, the confirm UI. Because `liveHost` is null until the spike, this changes nothing about live routing until deliberately configured — it is safe to ship paper-only.
- **Deferred (separate sign-off):** the discovery spike, `liveHost` configuration, and the first real-money order.

## Out of scope
- Per-order confirm for live (decision #2: same as paper).
- Separate live guardrail values (one guardrail set applies to both).
- Multi-account concurrent routing (one active account at a time).

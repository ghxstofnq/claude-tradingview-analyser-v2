# UI fidelity audit — field → bot source map

> Goal mandate ([docs/intent/2026-06-27-end-goal.md](intent/2026-06-27-end-goal.md)): *every panel reads the same
> analysis the bot reads; no UI-only or fabricated numbers.* This audit maps each panel's decision-relevant value
> to its bot source and flags anything the UI invents or re-derives. Status legend:
> **✓ reads bot** · **⚠ derived from bot data + live price (monitoring, acceptable)** · **✗ UI-invented (violation)**.

## LIVE panel (`LivePopover.jsx` / `Live.helpers.js`) — audited 2026-06-27

| Displayed value | Source | Status |
|---|---|---|
| Entry model label (`modelLabel`) | **was** hardcoded MSS→Reversal / Trend→Continuation in the UI | ✗→✓ **FIXED** — now reads the bot's `setup.model_class` (Reversal/Continuation, computed in `execution-packet.js#classifySetupModel` from leg direction); legacy guess kept only as a back-compat fallback when `model_class` is absent. The bot now surfaces `model_class` via `deterministicPacketToSurfacePayload`. |
| Side | `setup.side` / execution feed (`normalizeSide`) | ✓ reads bot |
| Entry / Stop / TP1 / TP2 | `setup.entry/stop/tp1/tp2` (packet) | ✓ reads bot |
| Planned R (`rr`) | `setup.rr` = `packet.tp1.rMultiple` (bot `computeRMultiple`) | ✓ reads bot |
| Grade | `setup.grade` (packet) | ✓ reads bot |
| Confirmation rows (`pillar3ToConfirmationRows`) | `setup.pillar_breakdown[Pillar 3].verdict` | ⚠ synthesizes 3 rows from ONE bot verdict (the deterministic packet emits a single Pillar-3 verdict, not per-check granularity). Faithful in aggregate — the chain only surfaces after the 1m close, so PASS ⇒ all held — but the 3-row split is UI presentation, not 3 bot signals. Acceptable; noted. |
| Confirmation verdict (`entryConfirmationVerdict`) | rolls the rows above | ✓ derived from bot verdict |
| Live price | `useLastBar` (live feed) | ✓ real price (source of truth) |
| `from entry` / `to TP1` / `to stop` distances (`liveGridFromTrade`) | bot levels (`entry/stop/tp1`) + live `lastClose` | ⚠ monitoring geometry — derived from bot levels + live price; cannot diverge from the bot's intent. Acceptable. |
| P&L in R (`liveGridFromTrade.pnl`) | prefers `trade.r_realized` (bot); else computes live unrealized R = `fromEntry / |entry−stop|` | ⚠ reads the bot's realized R when present; UI fallback is a transparent live unrealized-R from bot entry/stop. Acceptable. |
| No-trade explanation (`explainNoTradeReason`) | bot blocker token + `useOpenReaction` ltf/latest | ✓ translates the bot's reason into plain English (exactly the mandate's intent — show what the system is doing). |
| BRAIN narration | `useDeterministicBrain` / `useChat` (bar-read) | ✓ reads bot output |

**LIVE verdict:** one real violation found and fixed (`modelLabel`). Everything else either reads bot values or is transparent monitoring geometry that can't diverge from the bot's decision. Two `⚠` items (confirmation-row split, R fallback) are presentation, not invented decisions — left as-is, documented.

## PREP panel (`PrepPopover.jsx` / `Prep.helpers.js`) — PENDING (B1 next)

## REVIEW panel (`ReviewPopover.jsx` / `Review.helpers.js`) — PENDING (B1 next)

Suspects from the initial scan: `Review.helpers.js` re-aggregates session R / win-rate / cumulative R / cum USD. Need to
check whether `backtest-analytics.js` / the journal already compute these so REVIEW reads them rather than re-summing
(a re-sum can diverge from the bot's own analytics).

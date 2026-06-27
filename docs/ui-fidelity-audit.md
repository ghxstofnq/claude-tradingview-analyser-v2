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

## PREP panel (`PrepPopover.jsx` / `Prep.helpers.js`) — audited 2026-06-27

Every helper maps `brief.json` (the bot's pre-session analysis, written by `direct-session-brief.js`) to display rows.
**No violation** (no surfaced-but-ignored bot value like LIVE's `model_class`).

| Displayed value | Source | Status |
|---|---|---|
| HTF bias rows (`htfBiasToRowsDesigner`) | `brief.htf_bias[].{tf,bias,note}` | ✓ reads bot (citations stripped for display, raw kept in tooltip) |
| Primary draw / Draw row | `brief.primary_draw.{ce,top,bottom,tf,kind,dir,cite}` | ✓ reads bot |
| 3-component vote breakdown (`drawBiasVoteRows`) | `brief.pillar1_votes.{htf,overnight}` + live Open=PENDING | ✓ reads bot (the Lanto grade basis) |
| Pillar-2 quality rows (`pillar2ToRows`) | `brief.pillars[Pillar 2].elements` | ✓ reads bot |
| Overnight Asia/London H-L (`overnightHeaderRows`) | `brief.overnight_block` → `brief.key_levels` fallback | ✓ reads bot |
| Key levels above/below (`groupLevelsByPrice`) | `brief.key_levels` partitioned by `useSymbolCache` live price | ✓ reads bot + live price |
| Decision strip (`decisionLine`) | `brief.{pillar_grade,lean,no_trade_reason,pillar1_votes,primary_draw,pillar2_verdict}` | ✓ reads bot |
| Open-reaction verdict (`openReactionVerdict`) | prefers `ltf.htf_ltf_alignment` (resolver's own verdict), then open-reaction record | ✓ reads bot (Option B) |
| Chain chip (`formatChainChip`) | `brief.chain_status` | ✓ reads bot |
| Sizing note (`scenariosMeta`) | `brief.sizing_note` | ✓ reads bot |

**Minor (⚠ acceptable fallbacks, documented):**
- `htfBiasToRowsConcise` line 153 infers `reaction = "rejected"` from `took_liq` when `primary_draw.state` is absent —
  could instead read the bot's `primary_draw.reaction_dir`/`reacted`. (Only matters if the concise variant renders;
  `htfBiasToRowsDesigner` is the active layout.)
- `decisionLine` / `drawBiasVoteRows` recompute the vote `cast` count from `pillar1_votes` — same source the bot grades
  from, so it can't diverge; ideally reads a bot-surfaced count if one is added.
- `openReactionVerdict` derives CONFIRMS/FLIPS from the HTF vote only as a *fallback* when the bot emits no alignment
  word — the bot's `htf_ltf_alignment` wins first.

## REVIEW panel (`ReviewPopover.jsx` / `Review.helpers.js`) — audited 2026-06-27

REVIEW is a historical track-record/journal view. The ledger (`buildLedger` / `deriveLedgerState`/`Reason`) maps each
setup's `_disposition` + folded trade `outcome` to display rows — presentation, no invented numbers. The aggregates
(`sessR`, `cumR`, best/worst, `win_pct`, `cumUsd`, `winRate`) are **sums/counts over the bot's own per-trade R and
USD outcomes** (from the journal / trade-ticker), not re-derived decision values. This is the canonical place those
live-journal aggregates are computed (distinct from `backtest-analytics.js`, which aggregates backtest runs — a
different data domain, not expected to match). **No violation** — faithful arithmetic over bot data.

## B1 verdict

Across PREP · LIVE · REVIEW: **one real fidelity violation** (LIVE `modelLabel` ignoring the bot's `model_class`) —
found and fixed. PREP reads the brief faithfully; REVIEW aggregates the bot's per-trade outcomes faithfully. The
remaining `⚠` items are transparent monitoring geometry or bot-field fallbacks, not invented decisions.

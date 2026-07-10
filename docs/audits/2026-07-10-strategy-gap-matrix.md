# Strategy gap matrix — 2026-07-10

**Task E1** of [docs/plans/2026-07-09-app-and-bot-improvement-plan.md](../plans/2026-07-09-app-and-bot-improvement-plan.md).
Reconciles every implementation-status statement in the six `docs/strategy/*.md`
docs against the current code and tests, so later lever work starts from one
accurate target.

**Strategy authority** (CLAUDE.md workflow rule): `docs/strategy/*.md` +
`docs/strategy/transcripts/` ONLY. Retired Lanto callout / alerted-trade files
are NOT authority and are not cited here.

**Method.** Each rule is traced to a `file:line` in the live tree (`app/`,
`cli/`, `pine/`) plus the test that locks it, and to the transcript/spec section
that defines the target. `file:line` may drift — verify before relying. Verdicts
were re-checked against the working tree on 2026-07-10 (branch off
`origin/main @ 2a78a57`); the prior fidelity audit
[`lanto-source-of-truth.md`](../strategy/lanto-source-of-truth.md) was taken at
`bf85f6f` and several of its verdicts are now stale — those are marked
**(was …)** below.

**Verdict legend:** `MATCH` (faithful) · `PARTIAL` (partly) · `MISSING` (not
implemented) · `INTENTIONAL DIVERGENCE` (bot deliberately differs from Lanto,
with a stated reason). No behavior changed in the PR that produced this doc — it
measures and documents only.

## Summary counts

| Verdict | Count |
|---|---|
| MATCH | 9 |
| PARTIAL | 8 |
| MISSING | 3 |
| INTENTIONAL DIVERGENCE | 5 |
| **Total rules** | **25** |

Changes since the `bf85f6f` audit (the reason E1 exists):

- **MSS significance + reversal-speed gate** — `MISSING` → **`MATCH`** (shipped).
- **Multi-alignment (two-and-one) A+ entry** — `MISSING` → **`MATCH`** (shipped).
- **SMT / leading-asset selection** — `MISSING` on `main` → **`PARTIAL`** (logic
  now in production on the analyze/brief evidence layer; not on the live trade
  path; uncertified).
- **Runner "no-trim trail"** — was described as faithful/implemented; corrected
  to **`INTENTIONAL DIVERGENCE` / pending** (production is stop-to-BE at TP1 +
  fixed TP2; the structural-trail code path is dormant; `deriveRunnerStructure`
  is test-only).

---

## Pillar 1 — Draw & bias (`daily-bias.md`)

| # | Rule (spec) | Verdict | Code evidence + test | Transcript / spec citation |
|---|---|---|---|---|
| 1.1 | Three-component bias graded by **count**: 1/3 no-trade · 2/3 B · 3/3 A+ | **PARTIAL** (was CONTRADICTS) | `deriveGrade` now runs a nested 3-vote count when the resolver supplies it: `app/main/strategy/walkers/execution-packet.js:637-661` (`chain.drawBiasPillar` → `aPlusEligible`→A+, `bElevatable`→B). BUT Pillar 1 only passes when an HTF draw is present (`app/main/strategy/context/build-strategy-context.js:41-43`), so a **no-HTF-draw 2/3 day cannot reach B** — Lanto would trade it. Overnight never enters the pillar-status gate. Tests: `tests/derive-grade-nested.test.js`, `tests/grading-levers.test.js`. | `daily-bias.md` §1 "Bias = three components counted"; transcript BIAS ~21:29–22:25 |
| 1.2 | HTF PD-array selection: displacive + took-liquidity arrays on D/4H/1H | **MATCH** | `app/main/direct-session-brief.js` HTF ranking (displacement + took-liquidity). Tests: `tests/direct-session-brief*.test.js`, `tests/brief-digest.test.js`. | `daily-bias.md` §2; transcript BIAS 00:56–01:52 |
| 1.3 | Prefer the PD array **nearest current price** | **PARTIAL** (was MISSING) | Signed distance is computed on every in-zone FVG/BPR (`cli/lib/compute-engine-gates.js` `distance_to_top/bottom/ce`) but does not rank the primary draw in `direct-session-brief.js`. Lever `GOFNQ_HTF_INTRADAY_DRAW` (default-on) biases toward the near intraday draw. | `daily-bias.md` §2 "Near price"; transcript BIAS 04:42 |
| 1.4 | Overnight (Asia/London) recency-weighted; reaction not the raw take | **PARTIAL** | Reject/continuation fork resolves at +15 / freezes +30 (`cli/lib/open-reaction-resolver.js`; `app/main/backtest-engine.js:120-144`). Keys off overnight liquidity-level sweeps, not "did price close through the HTF gap". | `daily-bias.md` §3; transcript BIAS 11:14–25:44 |
| 1.5 | Don't flip bias off a single event — need multi-array / more displacement | **MISSING** | The day's bias flips on a single swing-tier MSS / displacement-BoS: `app/main/live-ltf-resolver.js:115-120`. No multi-array or overnight-strength coupling. Lever `GOFNQ_WAIT_FOR_REACTION` (default-off) is the partial fix. | `daily-bias.md` §5; transcript BIAS 30:39–32:21 |
| 1.6 | SMT / leading asset (ES↔NQ): short the weaker, long the stronger | **PARTIAL** (was MISSING on `main`) | Relative-strength leader logic exists in production: `cli/lib/smt-leader.js` (`computeSmtLeader`) + `cli/lib/smt-leader-evidence.js`, wired into the analyze bundle (`cli/commands/analyze.js:890`) and LLM narration (`app/main/sdk.js:711`). **NOT on the live trade path** — the traded symbol is `PAIR_PRIMARY` from config (`app/main/bar-close.js`, `app/main/config.js`); no `smt-leader` import under `app/main/strategy/**` or `bar-close.js`. **Uncertified** — no leader-only-vs-both-symbols fold (plan F1). Tests: `tests/smt-leader.test.js`, `tests/smt-leader-evidence.test.js`. | `daily-bias.md` §6 "SMT"; transcript BIAS 36:32–37:28 |
| 1.7 | Sessions: London tradable; wait for the initial move in slow sessions | **PARTIAL** | Level layer matches Pine; runnable sessions truncate London to 03:00–06:00 and split NY into ny-am (09:30–12:00) + ny-pm (13:00–16:00) with a noon dead-gap (`app/main/sessions.js:33-35`). Asia is not a tradable session. | `daily-bias.md` §7; transcript BIAS 40:23–41:29 |

---

## Pillar 2 — Price-action quality (`price-action.md`)

| # | Rule (spec) | Verdict | Code evidence + test | Transcript / spec citation |
|---|---|---|---|---|
| 2.1 | Displacement tell: engulfing / flush / minimal wicks; you can't outrade bad price | **MATCH** | Engine emits `displacement` clean/acceptable/weak + `candle` (`pine/ict-engine.pine`); A+ requires clean/acceptable (`execution-packet.js:663-669`). Test: `tests/pillar2-verdict.test.js`. | `price-action.md` §1; transcript PRICE 06:52–08:42 |
| 2.2 | Gap size = inefficiency = draw magnetism (a big gap pulls price) | **PARTIAL** | Size ranks zones (tiny/normal/large, ATR-relative) but does **not** gate target validity — a tiny gap can still be a TP/draw (`execution-packet.js` target pool). | `price-action.md` §2; transcript PRICE 09:37–11:30 |
| 2.3 | Stand aside on tight consolidation / bad delivery (the 28pt/3h test) | **MATCH** (was PARTIAL) | Hard stand-aside via `cli/lib/pillar2-verdict.js` collapsing schema-4 quality enums to `good/marginal/poor`; `poor` vetoes (tight 3h range, no displacement, or two-sided doji). Aggregation: one tight LTF vetoes; else both 5m+15m must be bad. Test: `tests/pillar2-verdict.test.js`. | `price-action.md` §2 "stand aside"; transcript PRICE 29:17 |

---

## Pillar 3 — Entry models (`entry-models.md`)

| # | Rule (spec) | Verdict | Code evidence + test | Transcript / spec citation |
|---|---|---|---|---|
| 3.1 | Three models (MSS reversal · Trend continuation · Inversion = failed opposing PD array) | **MATCH** | Walker lifecycles: `mss-lifecycle.js`, `trend-lifecycle.js`, `inversion-lifecycle.js`. Tests: `tests/mss-lifecycle.test.js`, `tests/inversion-entry-gate.test.js`, replay corpus. | `entry-models.md` "MSS / Trend / Inversion"; transcript ENTRY/TRADE24 |
| 3.2 | Best-gap ranking: took-liquidity + displacement | **MATCH** | `rankFvgs` = fresh → took_liq → size → disp_score (`cli/lib/brief-digest.js:28-36`); `took_liq` latches on displacement breaking a prior internal swing (`pine/ict-engine.pine`). | `entry-models.md` "Best-gap selection"; transcript ENTRY 05:38–07:30 |
| 3.3 | MSS needs a **significant** grab + reversal speed matching/exceeding the down-move | **MATCH** (was MISSING) | `app/main/strategy/walkers/mss-lifecycle.js:42-52` `SIGNIFICANT_SWEEP_TARGETS` (named session/PD levels only) filters the anchoring sweep (`:78`); `:61-69` `isSignificantDisplacedShift` requires swing-tier + engine displacement + `disp_atr ≥ 1.0` behind default-on `GOFNQ_MSS_SPEED_MATCH`. Both fail-open on field-less legacy contexts. Tests: `tests/mss-lifecycle.test.js` ("significant named-level grab + displaced swing-tier shift", "does NOT spawn off an insignificant grab", "…lacks displacement (§3 speed gate)", "…internal-tier"). | `entry-models.md` MSS §2/§3; transcript BIAS 28:47–31:34, ENTRY 08:26–09:21 |
| 3.4 | Confirmation on the gap = a deliberate **1m candle close** (not a wick / sloppy) | **MATCH** (body PARTIAL) | `confirm_close && ce_held && !chop_15m` (`app/main/strategy/walkers/lifecycle-utils.js:60-67`) + 15-min fight-timeout (`deterministic-strategy.js:8-36`). Candle-body ≥ 0.6 is enforced only on the Trend wick-tap path (`trend-lifecycle.js:80-81`); the main path trusts engine flags. Tests: `tests/confirmation-body.test.js`. | `confirmation.md`; transcript ENTRY 04:43, PRICE 25:34 |
| 3.5 | Multi-alignment (two-and-one): 5m FVG rebalance + 1m iFVG go-invert = A+ elevator | **MATCH** (was MISSING) | Trend-lifecycle entry variant: `trend-lifecycle.js:213-296` (`findTappedFiveMinuteRebalance` + `findHistoricalIfvgAlignment` + `findEntryIfvgAnchor`), evidence set at `:367` (`multiAlignmentTrendEntry`). Grade elevation: `execution-packet.js:588-595` (`hasMultiAlignment`) + `:655-658` (D5 lifts a 2/3 B day to A+ **only when not divergent**, `GOFNQ_D5_ELEVATION_RESPECTS_CAP` default-on). Tests: `tests/fresh-oracle-02-09-multi-align.test.js`, `tests/grading-levers.test.js` (C5), `tests/derive-grade-nested.test.js`. | `entry-models.md` "Multi-alignment (advanced) entry"; transcript ENTRY 25:13–27:05 |
| 3.6 | 1m vs 5m **gap** preference: when forced to choose, prefer the 5m gap | **MISSING / real gap** | Base MSS/Trend/Inversion entries hunt on 1m; 5m arrays are consumed only inside the multi-alignment elevator (`trend-lifecycle.js:238` `fvgs5m`), never as a base-model gap-TF preference. This is plan **E3a** (default-off lever pending a certified fold). | `entry-models.md` "1m vs 5m gap preference"; transcript ENTRY 32:21–33:23 |
| 3.7 | Model-specific structural stops (below the FVG / relative low-swing) | **MATCH** | Inversion: failed-leg extreme → violating candle → swing → edge; Trend: FVG-creating candle → pullback swing → tap → edge; MSS: pivot → swing-beyond-zone → edge (`execution-packet.js:145-330`, `:420-467`). Tests: `tests/execution-packet-targets.test.js`, `tests/real-session-packet.test.js`. | `entry-models.md` per-model "§Risk & target"; transcript TRADE24 09:02–10:03 |

---

## Risk, sizing & management (`risk-and-management.md`)

| # | Rule (spec) | Verdict | Code evidence + test | Transcript / spec citation |
|---|---|---|---|---|
| 4.1 | Day-of-week sizing: Mon/Fri half · Tue–Thu full | **MATCH** | `cli/lib/sizing.js` — Mon/Fri A+=0.5R, Tue–Thu A+=1.0R, all B=0.5R. Test: `tests/sizing.test.js`. | `risk-and-management.md` sizing table; transcript RISK 00:56–01:54 |
| 4.2 | TP1 ≈ 1–1.5R; ultimate ≈ 2R+ (HTF draw) | **PARTIAL / INTENTIONAL DIVERGENCE** | TP1 = nearest unswept swing ≥2R else session level ≥1.5R, with a **hard 1.5R floor** (`execution-packet.js:497-525`; `tp1_below_1_5r` blocks at `:520/:530`) — the high end of Lanto's 1–1.5R (bot-tuned). Ultimate = HTF draw (TP2/runner) MATCHES (`selectTp2` `:531-555`). | `risk-and-management.md` "Targets"; transcript RISK 01:54–03:44 |
| 4.3 | Runner management — Lanto's personal style is **no-trim, ride the trail, exit on structure change** | **INTENTIONAL DIVERGENCE / pending** (was "faithful/implemented") | **Production = stop-to-BE at TP1 + fixed TP2 for A+**; B banks 100% at TP1 (`cli/lib/trade-outcomes.js:17-22,107-124`; `app/main/execution/tranche-exec.js:57-99` `runnerTp` + `brokerActionsForTransition` TP1_HIT→`modify_stop`). The tick engine `trade-outcomes.js:126-159` **contains** a no-trim structural-trail path (`CLOSED_STRUCTURE` / `STOP_TRAILED`) but it is **dormant** — it fires only when `ctx.structureBreakAgainst` / `ctx.protectiveLevel` are supplied, and no production caller supplies them (`app/main/trade-ticker.js:117` and `cli/commands/trades.js:31` call `tickTrades(open, bar)` with no ctx). The producer `deriveRunnerStructure` (`cli/lib/runner-structure.js:62`) is imported **only** by `tests/runner-structure.test.js`. **Runner style is an open decision** (unified-goal 2026-07-10 checkpoint 2 / pre-approval item 3): derive from transcripts first, side-by-side fold, keep current behavior on ambiguity. | `risk-and-management.md` "Management styles" #3; transcript RISK 13:07–13:59 |
| 4.4 | Stops anchor at structural invalidation (under the FVG / relative low) | **MATCH** | See 3.7. | `risk-and-management.md` "Stops"; transcript TRADE24 09:02 |

---

## Bot-specific overlays (no transcript basis) — `lanto-source-of-truth.md` §5

These are empirically-tuned gates from the bot's fold campaigns; they push away
from pure Lanto and are candidate levers, not fidelity claims.

| Overlay | Behavior | Verdict | Evidence |
|---|---|---|---|
| Exhaustion cap | A+ + clean displacement + entry ≥ 11:00 ET → B | **INTENTIONAL DIVERGENCE** | `execution-packet.js:547-560` |
| 15:32 ET entry cutoff | No new entry after 15:32 | **INTENTIONAL DIVERGENCE** | `execution-packet.js:63-69` |
| 11:40 ET AM B-cutoff | B in ny-am blocked after 11:40 | **INTENTIONAL DIVERGENCE** | `execution-packet.js:70-74` |
| PM carry-only | Suppress fresh ny-pm spawns; carry AM only | **INTENTIONAL DIVERGENCE** | `GOFNQ_PM_CARRY_ONLY` default-on |

---

## Default-off / dormant / lever inventory

The plan (E1 step 2) requires the levers that are default-off or dormant with
their status and what gates enablement. **Verified 2026-07-10 against the guards
and `tests/grading-levers.test.js`.**

### Grading / stop levers (`GOFNQ_*`)

| Lever | Guard | **Actual default** | What it does | Enablement gate |
|---|---|---|---|---|
| `GOFNQ_MSS_KILL_ANCHOR_SWEPT_LOW` (C2) | `!== '0'` | **DEFAULT-ON** (opt out `=0`) | Anchors the swing-grab MSS dead-premise kill on the FVG protective edge, not the broken LH. | Already on (locked by `tests/grading-levers.test.js:85-96` — `=0` is the "legacy bug"). |
| `GOFNQ_MIN_STOP_BAND` (C3) | `!== '0'` | **DEFAULT-ON** (opt out `=0`) | Blocks a structural stop tighter than 0.35×ATR (micro-pivot noise). | Already on (`execution-packet.js:777-786`). |
| `GOFNQ_WIDE_STOP_CAP_ALL_MODELS` (C4) | `!== '0'` | **DEFAULT-ON** (opt out `=0`) | For non-Inversion models, prefer a tighter valid pool anchor when the stop is > 5×ATR. | Already on (`execution-packet.js:761-776`). |
| `GOFNQ_D5_ELEVATION_RESPECTS_CAP` (C5) | `!== '0'` | **DEFAULT-ON** (opt out `=0`) | A multi-alignment 2/3→A+ elevation must not elevate a divergent/retrace day. | Already on (user-approved 2026-07-02; `tests/grading-levers.test.js:39-54`). |
| `GOFNQ_LEGACY_GRADE_B_CAP` (C6) | `!== '1'` (opt-in) | **DEFAULT-OFF** (opt in `=1`) | When on, the legacy fallback path caps at B (no displacement-proxy A+). | Full-corpus fold; `tests/grading-levers.test.js:56-73`. |
| `GOFNQ_MSS_SPEED_MATCH` | `!== '0'` | **DEFAULT-ON** (opt out `=0`) | The MSS reversal leg must displace ≥ 1 ATR (see 3.3). | Already on. |
| `GOFNQ_HTF_INTRADAY_DRAW`, `GOFNQ_FRESH_DRAW_HOLD`, `GOFNQ_STRONG_OVN_NET`, `GOFNQ_WAIT_FOR_REACTION`, `GOFNQ_PM_CARRY_ONLY`, `GOFNQ_P2_DISP_HTF`, `GOFNQ_P3_TREND_STOP` | mixed | mostly DEFAULT-ON | Faithfulness refinements from the 2026-06 audit + PM-carry. | Folded + enabled per their PRs. |

> **Documentation discrepancy flagged for E1 (not fixed here — code untouched).**
> The inline lever comments in `execution-packet.js:755` and
> `mss-lifecycle.js:222` label C2/C3/C4 "**default-off**", and the prior C-lever
> memory note ("C2/C3/C4/C6 stay default-off") says the same. The **actual guards
> are `!== '0'` (default-ON) and no entrypoint assigns these env vars**, so they
> run **default-ON** — confirmed by `tests/grading-levers.test.js:85-96`, which
> treats `=0` as the opt-out. Only **C6** is genuinely default-off. A follow-up
> should correct those inline comments; the PR that produced this matrix changed
> no code.

### Pine levers (deferred audit items, PR #208)

| Lever | Default | What gates enablement |
|---|---|---|
| `useReactionWindowRejection` (`pine/ict-engine.pine:246`) | `input.bool(false)` — **OFF** | Full-corpus fold on the re-recorded certified corpus; changes emitted sweep-rejection semantics → needs new `code_rev` + re-certification. |
| `useOriginLegAnchor` (`pine/ict-engine.pine:245`) | `input.bool(false)` — **OFF** | Full-corpus fold; changes emitted `leg_high/leg_low` → new `code_rev` + re-certification. |

Per unified-goal checkpoint 3 (2026-07-10): the two #208 Pine levers are folded
**first** (to stabilize `code_rev`) before the strategy folds (E3a, runner).

### Dormant emitted evidence

| Field | Status | What gates enablement |
|---|---|---|
| `confirm_strict` (prior-bar tap + engulfing close) | **Parser-typed but DORMANT** — does not gate the chain (`cli/lib/ict-engine-parser.js`). | It folded negative on the corpus (same-candle tap-and-close is oracle-canonical); must not gate the chain without a fresh full-corpus fold. (CLAUDE.md "Same-candle confirmation is canonical".) |
| `deriveRunnerStructure` (`cli/lib/runner-structure.js`) | **Test-only** — not imported by any `app/main/**` path. | The runner-style decision (checkpoint 2 / pre-approval item 3): transcript derivation + side-by-side fold. |

---

## Open items handed to E2 / E3

- **E3a — 5m-gap preference (3.6)** is the one remaining genuine entry-model gap.
- **Runner truth (4.3)** is a decision, not a cleanup: derive from transcripts,
  fold BE/fixed-TP2 vs structural-trail side-by-side, keep current on ambiguity.
- **SMT (1.6)** exists as evidence but does not select the traded symbol and is
  uncertified — plan F1.
- Every lever above must pass the **strict mechanical fidelity gate**
  (unified-goal §Full pre-approval item 2) before it may auto-enable — encoded by
  E2's `scripts/evaluate-strategy-lever.mjs`.

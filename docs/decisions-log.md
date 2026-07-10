# Decisions log

Date-stamped, one entry per decision. Per the strategy-full-spec mandate
(2026-06-13): when the strategy documents are silent or ambiguous, the
decision is resolved by re-reading the docs, then by web research into
ICT/SMC source conventions, and logged here with the evidence that drove it.
The user is unavailable for rulings during the campaign; the only thing never
decided unilaterally is overwriting an existing hand grade.

Doc shorthand: **TS** = `docs/strategy/trading-strategy-2026.md`,
**EM** = `docs/strategy/entry-models.md`.

---

## 2026-06-13 — Break-even scale-in is now the DEFAULT (user ruling)

**Decision.** The backtest/refold engine now scales into a proven-winning idea
by default (opt out: `TV_SCALEIN=0`). Rule:
- **Anchor** = the first trade of a cluster; keeps its ORIGINAL stop and rides
  to TP1 as normal (winners are never scratched).
- **Green light** = the anchor travels 50% of the way to TP1 → the move is
  proven, adds turn on.
- **Adds** = up to 5 concurrent, SAME-DIRECTION confirmed setups (loosened from
  same-target after May 26 showed same-direction catches mixed-target down-moves
  the strict rule missed); 10-min dedup collapses near-identical entries.
- **Breaker** = 2 ADD stop-outs in a row → no more adds that session (a winning
  add resets the streak; the anchor's own stop does not count). Caps chop-day
  bleed.

**Why.** Validated on two out-of-sample weeks (refold, $0): combined
current +11.04R → scale-in **+26.28R** (June 1–5 +0.33→+9.93; May 25–29
+10.71→+16.35). Upside shows on multiple weeks (June 2 cluster, May 26 down-move,
May 25/29 trend days), not one freak day; the breaker holds the cost on chop
days (May 27/28) to ~1 extra R.

**Cost on the graded days (user-authorized re-grade).** Scale-in does NOT change
June 9 (+10.01R) or June 10 (+1.35R) — clean trend days, no adds. It DEEPENS
June 11 AM from −1R to **−3R** (a chop morning where 2 adds stop before the
breaker trips). The refold-gate baseline is re-frozen to reflect this:
June 9 +10.01, June 10 +1.35, June 11 AM −3, June 11 PM 0.

**Scope.** Implemented in the backtest/refold engine (`app/main/backtest-engine.js`).
The LIVE chain (`bar-close.js`) is separate code and still trades one position —
porting scale-in to live is a follow-up. Flag-style env opt-out retained.

---

## 2026-06-13 — Phase 5 week proof (June 1–5 NY-AM): −1.40R, root-caused

**Scope.** User chose NY-AM-only (TV-replay recording wedges the live chart and
ties it up ~25 min/session; full 15-session week deferred). Recorded + folded
the 5 NY-AM sessions through the production engine (`scripts/run-week-proof.mjs`,
with page-reload wedge recovery).

**Result.**

| Day | Net move | Called bias | Trades | R |
|-----|----------|-------------|--------|---|
| Jun 1 | +181 (bull) | bullish/aligned B | 2 longs | −2.00 |
| Jun 2 | +144 (bull) | bullish/divergent B | 1 long | +2.60 |
| Jun 3 | −139 (bear) | bullish/divergent B | 0 | 0 |
| Jun 4 | +131 (bull) | bullish/aligned B | 0 | 0 |
| Jun 5 | −381 (bear) | bullish/aligned A+ | 2 longs | −2.00 |
| | | | **WEEK** | **−1.40** |

**Root cause — both losing days are strategy-faithful.**
- **Jun 1 (−2R):** correct direction (a +181 bullish day) but the two B-grade
  longs printed LATE (11:43 / 11:53 ET) right at the session high 30554 after a
  230-pt rally; both stopped on the pullback. Valid confirmed setups; poor
  location, not a rule violation.
- **Jun 5 (−2R):** Daily +15% / 4H +2% momentum bullish + a REAL LO.L rejection
  inside the §7-Step-4 open window → mechanically aligned-bullish A+ (resolver
  is doc-faithful). The day fell −381 anyway. The bearish delivery came as a
  swing-tier BoS bear @ 11:12 ET with displacement=FALSE — not an MSS and not
  displaced, so §2.3 realignment correctly did not fire.

**No frozen-safe, non-curve-fitting fix flips the week.** Candidate refinements
considered and why each is held:
- §2.1 draw-reaction bias (brief derives htf_bias from momentum `change_pct`,
  not from the primary draw's reaction; Jun 5's draw was a bear FVG *above* →
  §2.1 implies a bearish destination). A REAL fidelity gap — but a large change
  to the bias derivation that feeds the open-reaction + side gate, high risk to
  the frozen days, and needs a full week re-record to validate.
- §2.4 divergent-HTF grade cap (Jun 5 graded A+ despite 1H bearish). Real, but
  grade does not gate trade-taking (A+ and B both book) → does not change R.
- §3 price-quality stand-aside (Jun 5 marginal). Ruled OUT by the frozen days:
  June 10 itself traded on marginal/weak quality (4 losers, +1.35R net) — the
  documented tradable-B day. Tightening quality would move a frozen day.

**Decision.** The −1.40R is a strategy-faithful slight loss on the NY-AM subset.
Forcing it green via the above would be curve-fitting (mandate: "never fix a
rule just to flip one loss") or would move a frozen day (forbidden). The
honest, mandate-aligned outcome is to record it as-is and surface the §2.1
draw-reaction bias as the one genuine fidelity gap worth a future, carefully-
validated PR. (Frozen days re-verified intact after all week-proof runs.)

**Resolution (user-directed): broaden to the full US session.** NY-AM is only
1/3 of "all tradeable sessions" (the mandate's actual scope). Recorded + folded
June 1–5 **NY-PM** through the same engine (zero rule changes): Jun1 0, Jun2
+1.73, Jun3 0, Jun4 0, Jun5 0 → NY-PM **+1.73R**. **Full June 1–5 US-session
week = NY-AM −1.40 + NY-PM +1.73 = +0.33R — PROFITABLE.**

| Day | NY-AM | NY-PM | Day total |
|-----|-------|-------|-----------|
| Jun 1 | −2.00 | 0 | −2.00 |
| Jun 2 | +2.60 | +1.73 | +4.33 |
| Jun 3 | 0 | 0 | 0 |
| Jun 4 | 0 | 0 | 0 |
| Jun 5 | −2.00 | 0 | −2.00 |
| **Week** | **−1.40** | **+1.73** | **+0.33R** |

The week is profitable trading the strategy as documented, with no curve-fitting
and no frozen-day drift (re-verified). The edge (June 2 +4.33R) outweighs the
two strategy-faithful −2R days; June 3/4 + most PM sessions correctly stood
aside. Thin but positive — consistent with the research (the strategy's edge is
the week/many sessions, not every trade). Phase 5 closed.

---

## 2026-06-13 — June 11 PM 13:30 stop (G5): no deterministic fix; interpretive

**Question.** The June 11 PM 13:30 (17:30 UTC) Inversion long surfaces with a
333-point stop (entry 29087, stop 28753.25). Resolve docs-first.

**Investigation (refold-gated, evidence below).** The current Inversion stop
rule's first anchor is the FAILED-LEG EXTREME — the extreme of the visible 1m
bars (`bars.last_5_bars`). EM Inversion §5 actually names the stop as "below
the inversion FVG low **or below the candle that closed through it**"; the
failed-leg extreme is a user refinement (hand-grade 2026-06-13, June 9) the
frozen days depend on. For June 11 PM 13:30 the visible window is
13:26–13:29 — bars `[L28753.25, L28756, L28785.5, L28896.75→close 29087]` — a
clean monotonic 143-pt rally into the violating close. The violated bearish
FVG (28925–28936.25) was created at **12:38**, 48 minutes earlier; its
formation leg is not in the window. So 28753.25 is the **launchpad of the
violating impulse**, not the failed leg. The doc-canonical anchor here is the
violating candle low **28896.75** (190 pts) or the zone low 28925 (162 pts).

**Four refold-gated fix attempts, all rejected:**
1. Bound leg bars to `>= created_ms` — verified no-op on frozen days, but
   inert here (all 4 visible bars post-date the 48-min-old zone). No fix.
2. Per-bar clip to a `[created−120s, created+240s]` formation window —
   **drifted all three frozen days** (changed stops → cascaded TP1/grade/
   booking).
3. Guard on "formation observable" (any bar in the formation window), else
   full-window extreme — **drifted June 9 + June 11 AM** (June 10's booked
   frozen inversions have zones 47–90 min old and the user accepted their
   full-window stops).
4. "Launchpad" guard (reject the extreme when it sits at the first visible bar
   and price moves monotonically toward the violation) — **fixed June 11 PM
   (→ 28896.75) and kept June 10, but drifted June 9 + June 11 AM.** June 11
   AM 13:58 (frozen, accepted stop 29014.75) is bars `[H29014.75, H29009.5,
   H29006.75, H28969.5]` — an index-0 high with monotonically falling highs:
   **structurally identical** to June 11 PM 13:30, only a 45-pt consolidation
   drift vs a 143-pt impulse. The user accepted the 106-pt one and flagged the
   333-pt one.

**Finding.** The ONLY thing separating June 11 PM 13:30 from the frozen,
user-accepted launchpad stops on June 9 / June 11 AM is the **absolute stop
magnitude** (333 vs ≤110 pts). Every structural discriminator that isolates it
also moves a frozen day. A magnitude cap is uncited curve-fitting the mandate
forbids ("never fix a rule just to flip one trade").

**Decision.** The Inversion failed-leg-extreme rule is left **unchanged**
(frozen days intact). G5 ships **no code**. The residual is recorded as
KNOWN LLM-INTERPRETIVE territory: distinguishing an *impulse launchpad*
(invalid stop) from a *consolidation-edge swing* (valid stop) requires reading
move quality, which the deterministic full-window extreme cannot do. The
333-pt setup correctly does not book (0 trades — its far TP and wide stop are
both un-hit in the PM session), so there is no P&L consequence today.

**Flagged for user sign-off (does NOT ship unilaterally).** A §6-grounded
max-structural-stop RISK gate (block scalps whose structural stop exceeds a
volatility-relative ceiling, e.g. N×ATR) would make the 333-pt setup an
explicit no-trade without touching any frozen day (all frozen booked stops
≤110 pts) and without changing any P&L. It is deferred to Phase 5: if the
out-of-sample week surfaces wide-stop losers, the gate gains an empirical,
loss-grounded justification (risk management, not curve-fitting) and can be
proposed with that evidence.

---

## 2026-06-13 — Immutability baseline frozen

**Decision.** The hand-graded refold outputs are frozen as the regression
baseline in `docs/audits/refold-baseline.json`, enforced by
`scripts/refold-gate.mjs`:

| Session | total R | trades | status |
|---|---|---|---|
| June 9 AM | +10.01R | 5 (4W/1L) | FROZEN |
| June 10 AM | +1.35R | 6 (2W/4L) | FROZEN |
| June 11 AM | −1.00R | 1 closed (0W/1L) + 1 open | FROZEN |
| June 11 PM | 0.00R | 0 closed | OPEN (13:30 stop question) |

**Why.** The user hand-graded June 9 / June 10 / June 11 AM trade-by-trade;
those rulings are data, not questions. No rule change ships if it moves a
frozen session's entries, stops, TPs, outcomes, or total R. June 11 PM is
explicitly the open question (its 13:30 ET / 17:30 UTC trade carries a
pathological 333-pt failed-leg stop) and is tracked-but-not-gated until
resolved.

**Evidence.** `node scripts/refold-gate.mjs` reproduces all four from the
recorded tapes through the live truth fn; baseline frozen 2026-06-13.

---

## 2026-06-13 — TP1 books the full position (no TP2/runner accounting)

**Decision (frozen, no code change).** The deterministic engine books the
entire position at TP1 and reports realized R as the TP1 multiple
(`|exit−entry|/|entry−stop|`); TP2/runner is reported on the packet but not
separately accounted.

**Why.** Every frozen baseline R total (+10.01R, +1.35R, −1R) was computed
under TP1-books-all. TS §6 / §7 Step 7 describe two-stage profit-taking
(intraday liquidity first, HTF draw second), so a runner leg is strategy-
faithful — but switching the accounting would move every frozen R total.
Revisit only with explicit user sign-off; until then this stays as-is and the
gap is documented, not silently approximated. (Audit gap G7.)

---

## 2026-06-13 — Confirmation discipline is 1m-close

**Decision (frozen, no code change).** Confirmation closes are evaluated on
the 1m candle close. TS §5 / §7 Step 6 and EM (all three models) permit
"1m **or** 5m" closes.

**Why.** The hand-graded days settled on 1m-close discipline and were graded
correct trade-by-trade under it. Admitting 5m closes as independent
confirmations would add entries on the frozen days. The 5m variant stays out
unless a recorded tape demonstrates a doc-valid setup the 1m discipline
misses. (Audit gap G8.)

---

## 2026-06-13 — Inversion entry is the aggressive (violating-close) variant

**Decision (frozen, no code change).** The Inversion model enters on the
candle that closes through the opposing FVG (EM Inversion §4 "Aggressive
approach … enter on the initial close that violated the FVG"). The
conservative retest variant (EM Inversion §4 "Conservative approach") is not
implemented.

**Why.** The user's June 9 / June 10 rulings graded the violating close as
THE entry. Implementing the retest variant as an alternative would change
graded entries. Intentionally out of scope. (Audit gap G9.)

---

## 2026-06-13 — Trades hold to TP1/stop or the 4:00 PM ET close (AM carries into PM)

**Decision.** A trade is held until the first of: TP1, stop, or the 16:00 ET
cash close. An AM trade still open when the AM window ends is **monitored into
the PM session** (it keeps grading against that day's PM bars); any trade still
open at 16:00 ET is **force-closed at the market** (the bar's close), booking
its signed R. A resting (unfilled) order at 16:00 is cancelled. The strategy
docs are silent on holding-across-sessions and end-of-day close — this is a
user ruling (2026-06-13) filling that gap.

**Why.** Before this, a trade that neither hit TP1 nor stop by its session
window's end was abandoned at $0 ("open at end"), which understated real P&L —
those trades were mostly winners-in-waiting drifting toward their target. TS
§7 Step 7 lets profits run "toward HTF draw if price supports continuation,"
which naturally spans into PM; closing at 16:00 is standard intraday discipline
(no overnight hold).

**Where.**
- Backtest: `app/main/backtest-engine.js` gains a `carryEntries` param (the
  same day's PM tape) + a post-fold carry pass + a 16:00 mark-to-market
  (`closeAtMarket` in `app/main/backtest-grader.js`, outcome `closed_1600`,
  signed R). The refold/week scripts pass the PM tape to AM folds.
- Live: `cli/lib/trade-outcomes.js` gains `closeTradesAtEod` (filled →
  `CLOSED_EOD` at market, signed R off the original risk; pending → cancelled);
  `app/main/trade-ticker.js` `maybeForceCloseAtEod` fires it at/after 16:00 ET;
  wired into the per-bar handler in `app/main/bar-close.js`. The live tracker
  already monitors continuously, so AM→PM carry is automatic live.

**Immutability.** The three frozen hand-graded days (June 9 +10.01R, June 10
+1.35R, June 11 AM −3R) have ZERO open trades at their AM window's end, so the
carry/EOD logic is inert for them — refold-gate verified byte-identical.

**Effect on the out-of-sample weeks (honest R, not curve-fit):**
June 1–5 +9.93 → +12.66R; June 8–12 +10.26 → +12.65R; May 18–22 +3.19 →
+11.59R; May 25–29 +16.35 → +19.11R. Open trades now book real outcomes
(run to TP1 in PM, or close at 16:00) instead of phantom $0.

**Modeling note.** In the backtest, an AM trade carried into PM is independent
of the PM run's own positions — they can be concurrently open (matching the
real rule: hold the AM trade while PM trades normally). The session
one-position-at-a-time and scale-in limits are per-session.

---

## 2026-06-13 — No new entries after the 15:32 ET late-session cutoff

**Decision.** A new entry is blocked once its confirming 1m bar closes at
15:32 ET or later. The last candle that may confirm a new entry is the 15:30
ET candle (which closes at 15:31). Implemented as the `entry_after_session_cutoff`
blocker in `app/main/strategy/walkers/execution-packet.js` (the shared brain —
covers backtest and live), gated on `context.eventTimeUtc`. Inert for AM
trades (they confirm before noon).

**Why.** A trade confirmed in the last ~28 minutes has too little runway to
reach its target before the 16:00 ET forced close (the 2026-06-13 hold-to-4pm
rule). Across the four out-of-sample weeks there were 5 such 15:30–16:00
entries: one winner (June 2, confirmed on the 15:30 candle, +2.73R) and four
that stopped or scratched (15:33/15:34/15:43/15:57). The user set the cutoff at
the 15:31 close so the 15:30-candle confirmation (which had ~29 min of runway
and won) still qualifies, while later confirmations do not.

**Honesty note (curve-fit risk surfaced + accepted).** The exact minute keeps
the one winner and blocks the four losers, which is sample-sensitive — flagged
to the user against the standing "never tune a rule just to flip a loss" rule.
The user's rationale is runway-based (the 15:30 candle still had time), not
outcome-based, and the cutoff was their explicit call. Revisit if more
late-session data shows winners confirming after 15:31.

**Immutability.** Frozen graded days (June 9/10/11 AM) confirm before noon —
the cutoff is inert for them; refold-gate byte-identical (exit 0).

**Effect on the out-of-sample weeks:** June 1–5 +12.66R (unchanged, winner
kept); June 8–12 +12.65 → +14.65R; May 18–22 +11.59 → +12.59R; May 25–29
+19.11 → +19.16R.

---

## 2026-06-15 — Execution engine: the system may place PAPER orders (reverses "no broker writes")

**Decision (user-authorized).** The dashboard becomes an order-placing surface.
The execution engine places/modifies/closes orders through TradingView Paper
Trading on the in-app webview (CDP 9223), **paper-first**, behind a guarded
type-"LIVE" arm. This **reverses** the prior posture in hard constraints #1
(the webview was display-only, "the system must not drive it") and #2 ("CLI
only — every TradingView interaction goes through ./bin/tv"). Both constraints
were amended with the scoped exception; analysis/replay/Pine still run only on
TV Desktop (9225) via the CLI.

**Mechanism (M0 spike, captured from a real paper order).** Placement is one
REST POST from the page context: `POST papertrading.tradingview.com/trading/
place/<accountId>` with body `{symbol,type,qty,side,sl,tp,outside_rth:false,
outside_rth_tp:false}` and content-type `application/x-www-form-urlencoded`
(CORS-simple → no preflight; `application/json` is rejected — same gotcha as
`alerts.js`). Flatten = `POST .../close_position/<accountId>` body `{symbol}`.
Acks stream over the trading WS; paper mode exposes no REST reads (all 501).

**Guardrails (always-on, pre-fire — orders fire on accept, no per-order
confirm).** Valid stop required · whole-micro size within ±$50 (MNQ $2/pt, MES
$5/pt) · max-$/trade · daily-loss halt. LIVE arm is the one deliberate gate;
account mode boots PAPER every launch (ephemeral).

**Verified** end-to-end on the live paper account: place → filled long with
SL/TP bracket → flatten → flat, no leftovers. Spec:
[docs/superpowers/specs/2026-06-15-execution-engine-design.md](superpowers/specs/2026-06-15-execution-engine-design.md).

## 2026-06-15 — Execution: scale-in ADD (paper)

**ADD to the open position works** (PR #76). M0-style spike against the paper
account established the mechanism: a second SAME-SIDE order with no sl/tp
averages into the position (qty grows, avg recomputes) and the existing OCO
bracket auto-resizes to the combined qty — so the add carries no bracket of its
own. IPC handler is guarded: requires an open position whose side matches the
add (never reverse via an add) + the standard pre-fire guardrails on the added
contracts' risk. The fill feed re-anchors entry+qty to the averaged values on a
scale-in so the recorded round-trip R uses the real cost basis. UI surfaces a
same-side candidate onto a GREEN-LIT anchor only (≥50% to TP1, strategy §7
Step 7). **Verified live:** place 1c → add 1c → qty 2 with bracket intact;
wrong-side + no-position adds rejected; flatten clean; fill recorded qty 2 +
averaged entry. Deferred: auto-surfacing from a live producer (mirrors the
backtest's canScaleInto); real-broker LIVE arming.

## 2026-06-28 — Strategy: PM carry-only lever (GOFNQ_PM_CARRY_ONLY, SHIPPED default-ON)

**Lanto has no afternoon session.** The transcripts define New York as ONE
session, 9:30–4:00 PM ET, anchored to a single 9:30 opening range move
(BIAS 12:11, 23:21: *"I start lives at 9:45 because we typically get our opening
range move by then"*); after that he is hands-off (BIAS 18:42: *"if our timing
is not there yet, we simply are hands off"*) and runs a near one-and-done
mindset (BIAS 25:11). The runnable code splits NY into ny-am (09:30–12:00) +
ny-pm (13:00–16:00) with a noon dead-gap — a bot construction
([lanto-source-of-truth.md §1.7](strategy/lanto-source-of-truth.md)) — so the
chain manufactures a fake 13:00 "open reaction" and spawns fresh PM setups the
method never takes.

**Fold evidence (2026-06-28, 30 recorded PM sessions, MNQ).** Pre-session read
grades EVERY PM session no-trade; the chain still fires on 9 of them off the
fake 13:00 reaction. Those PM setups are net-negative under every trading model:
own-session **−6.21R** (3W/9L), continuation-of-morning-bias **−5.42R**
(7W/17L). Suppressing them entirely (carry-only) is best — and matches the
documented method: the morning trade carries into the afternoon, no new afternoon hunts.

**Lever.** `config.pmCarryOnly()` (`GOFNQ_PM_CARRY_ONLY`, **default-ON; opt out
=0**, user-approved 2026-06-28). Gated in the shared brain
`buildDeterministicPacketTruthFromInputs` (mirrors the `pillar2EntryGate`
pattern): when ON and `session === 'ny-pm'`, a fresh `bestPacket` is nulled with
blocker `pm_carry_only`. Open-trade management/carry is unaffected — carry runs
on the AM side (carryEntries reads the ny-pm tape's bars, not the PM context).
**Fold (default-on no flags = +25.65R; opt-out =0 = +19.44R; delta +6.21R,
exactly the removed PM trades); 45→32 trades; win% 40.9→46.9; the one −3R day
(06-17) eliminated; AM side untouched.** Tests: +3 unit (gate on/off/AM-safe);
full suite 1576/0; day-tapes 6/6 (parity holds); smoke 22/22.

## 2026-07-03 — same-candle confirmation is canonical; strict variant rejected by fold

The Lanto confirmation is a deliberate 1m close (clean body, no doji, CE
held, ≤10-min window, 15-min fight kill) — and the tap MAY be the same
candle's wick (oracle: 06-16 verified MSS, 07-02 live winner, June 9 trade
7). The strict prior-bar-tap variant (with or without an engulf-vs-prev-bar
compare) folded negative on all available evidence and is NOT adopted; it
ships only as dormant additive emit evidence (`confirm_strict`, parser-typed)
for cheap future re-tests. The engulf-vs-previous-bar compare is explicitly
NOT part of the strategy (Lanto's "engulfing" = candle anatomy). Indicator
visuals (checklist panel + ✓ confirm marker) key on confirm_close and carry
a visual-aid-only disclaimer — the walker chain remains the single setup
brain. Fold caveat: backtest corpus currently 1 run (wiped in cleanup);
re-record requires the app stopped.

## 2026-07-05 — Pine audit batch 1: 9 confirmed defects fixed (values-only, schema stays 4)

A 74-agent adversarially-verified audit of pine/ict-engine.pine confirmed 15
defects; the 9 small, authority-backed ones ship in one PR: (A1) panel NY-open
vote pending until minute 15 (daily-bias.md "first 15-30 minutes"; mirrors
open-reaction-resolver's boundary); (A2) panel model falls back to INV for a
live in-direction iFVG candidate (entry-models.md aggressive inversion); (A3)
FVG/BPR mitigation loops skip the zone's own formation bar — kills
wick_tapped=1-from-birth and zero-retrace same-bar confirm_close; (A4)
overnight ovHi/ovLo exclude the PRIOR cycle's London extremes during the Asia
window (un-skews overnight_dir for the 02:00 ET London brief via
overnightVote); (B1) orSwept = most recent in-window sweep, not first-latch;
(B2) confirmStrict cleared on inversion; (B3) live iFVGs exempt from
hideTinyZones/zoneSwallowed (render, candidate scan, hysteresis lock); (B4)
range_quality/range_vs_normal go "na" on TFs coarser than the 3h window;
(B5) opening-range vars + gap vote cleared at the 18:00 trading-day edge.
No emitted key changed; parser/gates/walker untouched. Deferred pending
strategy derivation: sweep rejected-latch semantics, leg-origin anchor,
merged-label price, disp_atr ATR snapshot, JS dead-code cleanup (bar_closed,
chop_15m contract, entry_state filter).

## 2026-07-05 — Deferred audit items: derived semantics shipped behind fold-gated levers

Transcript+Discord derivation (quote-verified; full authority in
docs/research/2026-07-05-sweep-rejection-and-leg-origin-derivation.md) settled the two
deferred behavior items from the Pine audit, and both ship DEFAULT-OFF as Pine inputs
(GRP_LEVERS) pending the full-corpus fold:
1. Sweep rejection = a revisable 15-min reaction-window read (`useReactionWindowRejection`),
   replacing the permanent 3-bar latch. One transient close no longer fixes the verdict in
   either direction; frozen at window end; a much-later re-break stays a future
   new-interaction derivation. Ruling basis: BIAS 39:20 / 30:30 / 38:23 / 20:33, PRICE 27:25
   / 25:34, Discord 06-11 11:06 two-outcome zone, 06-22 "until 1:30ET" deadline posture.
2. Leg SH/SL anchors at the leg ORIGIN (`useOriginLegAnchor`) — direction-aware reset keeps
   the opposite accumulated extreme (which at event time IS the origin), with-trend side
   restarts at the break bar; dual-direction bars keep legacy. Consecutive same-direction
   events anchor at the WHOLE structure's origin (documented choice; trail variant would
   need its own fold). The renderLeg comment already stated this convention; the reset code
   contradicted it.
Enablement gate for BOTH: full-corpus fold old-vs-new (blocked on the corpus re-record) +
two hand-graded case days for the rejection lever. Also shipped un-gated: the
build-strategy-context chop_15m blocker deleted (could never fire post-schema-4; chop is
enforced in Pine confirm gating + walker tap timeout). bar_closed kept as honest metadata;
the bridge entry_state filter left documented as V2 test back-compat (removal = test rewrite).

## 2026-07-06 — Gate corpus certified and recording started (real-money-gate instrument)

Parity certification complete (scripts/gate-corpus/parity-diff.py): recorder determinism
proven 07-05 (twice-recorded 07-02 byte-identical except wall-clock emit stamps); price
identity proven both days (all live bars, OHLC exact); and on identical code (2026-07-06,
live + replay both v29/code_rev=1) ZERO hard engine mismatches across 135 bars. Known
bounded divergences documented in docs/gate-corpus-manifest.md (forming-tick quality
scalars ~7% of bars; context domain). Incidental finding formalized: live sessions before
2026-07-05 ran a drifted Pine deploy — their engine evidence is not ground truth; the
code_rev guard (PR #210) prevents recurrence. The 239-session MNQ pass
(2026-01-10..2026-07-03, ny-am+ny-pm) started 2026-07-06 ~12:15 ET via
scripts/record-corpus.mjs; MES pass follows. Fold gate per the confirmed intent:
net-positive over this window on this corpus = green light to arm real money.

---

## 2026-07-10 — Architecture-decisions changelog migrated from CLAUDE.md

The dated decision table below (2026-05-17 → 2026-07-03, 50 rows) lived in CLAUDE.md's "Architecture decisions" section and is moved here wholesale so CLAUDE.md carries active operating guidance only. Rows are historical record: several were superseded by later rows or by the current CLAUDE.md hard constraints (port 9223→webview→TV Desktop 9225; Pine deploy duplicate-and-remove→2026-06-21 correct procedure; engine V1→V2→V3→V5). Where rows conflict, the latest — and the current CLAUDE.md — wins.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-17 | CLI-only consumption, no MCP tools | Ship without MCP config requirement; CLI is the long-term canonical surface. |
| 2026-05-17 | Vendor the `tv` CLI inside this project | Enables first-class custom `tv <foo>` commands sharing in-process core access. Cost: maintained fork. |
| 2026-05-17 | Lock to CDP port 9223 | 9222 is the default for `ai-trading-agent` and upstream `tradingview-mcp-ict`. 9223 is this project's lane. |
| 2026-05-17 | ICT methodology | Analysis framed in ICT vocabulary (HTF bias, liquidity, FVGs, order blocks, killzones, mitigation, IPDA). |
| 2026-05-17 | Build order: live single-chart read first | Foundation primitive. Tracker, scanner, backtester build on top. |
| 2026-05-17 | Claude Code session only — no Anthropic API in scripts | Project is `tv` recipes + this CLAUDE.md teaching Claude how to use them. No API key required. |
| 2026-05-17 | Stripped `brief`, `session`, `morning.js`, `paths.js` | Removes footguns that would write to shared `~/.tradingview-mcp/`. |
| 2026-05-17 | Screenshots out of analysis input | Source: research; multimodal hallucination risk on chart images. |
| 2026-05-17 | Cite-or-reject rule (constraint #6) | Source: research; top documented failure mode is hallucinated levels. |
| 2026-05-17 | No LLM arithmetic (constraint #7) | Source: research; arithmetic error grows with magnitude. |
| 2026-05-17 | Prose-first, JSON-last output (constraint #8) | Source: research; JSON-during-reasoning costs ~10–15% accuracy. |
| 2026-05-17 | Grade enum `A+ | B | no-trade` (constraint #9) | Sources: research (LLM verbal confidence is unreliable) + strategy §7 (the user's actual grading vocabulary). |
| 2026-05-17 | ICT vocabulary moved out of CLAUDE.md into the slash command body | Source: research rec #6; keeps CLAUDE.md under instruction ceiling, re-loads vocab per `/analyze` call. |
| 2026-05-17 | Trading strategy: Lanto's 3-pillar ICT framework | User's documented system; saved verbatim in `docs/strategy/` as the authoritative reference. Three pillars (Draw & Bias, Price Action Quality, Entry Model + Confirmation) and three entry models (MSS, Trend, Inversion). |
| 2026-05-19 | LLM-driven session replaces the watchman | The deterministic watchman (`tv watch`) was a candidate-flagger that fired on bar+FVG+body conditions. Replaced with: bar-close detector (cheap) + Claude Code session + phase-aware `/analyze` that runs on every 1m + 5m close, accumulates `state/session/<date>/*` notes, and reasons across the whole session. Strategy §7 is sequential — making Claude the engine that walks the checklist end-to-end is closer to that than a separate trigger layer. Plan in [docs/plans/llm-driven-session.md](docs/plans/llm-driven-session.md). |
| 2026-05-18 | Watchman context-gating defaults ON, opt-out via flags | Filter alerts by killzone presence, market-open state, and m5/m15 candle quality. Strategy §2.2/§2.3 (liquidity moves during sessions) + §3 (stand aside when price quality is bad). Opt-out (rather than opt-in) means the conservative default matches the strategy. Direction-aware filtering (bullish-bar-into-bullish-FVG etc.) remains deferred — that's the entry-model classification step. |
| 2026-05-18 | Tap detection wick-overlap + FVG direction tagging (carried forward) | Strategy's "tap" is wick-based, not close-inside. `gates.price_context.wick_tapped_boxes[]` lists FVG/iFVG/BPR zones whose high/low overlaps the bar's wick; `inside_boxes[]` is kept for close-based price-vs-zone checks using `quote.last`. Each FVG-study entry carries `fvg_direction` (bullish_fvg/bullish_ifvg/bearish_fvg/bearish_ifvg) from Nephew_Sam_'s bgColor. Verified 2026-05-18 09:35 ET: a bearish bar wicked through 4 FVG zones cleanly but closed in the gap — close-inside would have missed it. Watchman code that consumed these gates was deleted on 2026-05-19, but the gates themselves remain for `/analyze`. |
| 2026-05-20 | Per-session folders: `state/session/<date>/{ny-am,ny-pm,london}/` | Each session (NY AM / NY PM / optional London) gets its own folder holding that session's pillars, open-reaction, ltf-bias, setups, bars, and a `summary.md` wrap. Sessions never overwrite each other — AM, PM, and London grades all persist for later review. Replaces the flat day folder and the short-lived day-level `htf-summary.md` append log. `bar-close-events.jsonl` stays day-level (detector output). The dashboard shows the active session's folder, derived from `gates.session.phase`. |
| 2026-05-20 | Pillar 2 range threshold is per-symbol | `cli/lib/pillar2-thresholds.js` maps symbol → minimum acceptable range. Only the range threshold is price-scale dependent; body-ratio (0.6/0.3) is a normalised ratio and stays fixed. Uncalibrated symbols emit `range_acceptable: null` so the LLM judges the range manually rather than seeing a miscalibrated `false`. |
| 2026-05-21 | Migrate `tv analyze` to the ICT Engine indicator | One schema-versioned indicator replaces the four (FVG/iFVG, AMS, Killzones, BPR) as the data source. Strict superset — adds explicit sweep events, per-FVG displacement scoring, FVG lifecycle state, mechanical MSS/BOS detection — and uses the **textbook** HH/HL/LH/LL convention. Bundle gains `engine`, `engine_by_tf`, `gates.engine.*`. Pillar 2 quality is now the engine's ATR-relative `quality` row (retires `pillar2-thresholds.js`). Plan: [docs/plans/2026-05-21-ict-engine-migration.md](docs/plans/2026-05-21-ict-engine-migration.md). |
| 2026-05-26 | Full ICT Engine utilization — close the gap between what Pine emits and what we use | Audit against the indicator's Pine source surfaced six unused fields and one whole row type. Parser was silently dropping every `liquidity` row (equal-high/low pools — strategy §2.1's draw-target liquidity) and miscoercing the engine's Wilder `atr_14`/`atr_17` as strings. The bundle now exposes: `gates.engine.pillar1.{liquidity_pools, untaken_pools_above, untaken_pools_below}`; `pillar3.fvgs_ranked[]` pre-sorted by `(state=fresh, took_liq, disp_score)`; `pillar3.failure_swings[]` (pre-filtered `event=mss + validation=sweep` — ICT's failure-swing reversal); `pillar3.structures_by_tier:{swing,internal}` mirroring Pine's tier separation; `meta.{emit_age_seconds, stale, engine_session}` for staleness + clock cross-check; signed `distance_to_top/bottom/ce` on every in-zone FVG/BPR; `nearest_opposing_fvg_above/below`; and the previously-unparsed `size_quality`, `reaction_dir`, and `displacement=acceptable` enum value. Additive only — no existing citation paths renamed. |
| 2026-05-26 | Persistent memory layer (cross-day) | Adds `state/memory/{USER.md, MEMORY.md}` with frozen-snapshot injection at the top of the system prompt + an `mcp__tv__memory` tool (action × target, substring-match) exposed only to `chat`/`wrap`/`review` purposes. A new `review` purpose auto-fires after each session wrap (`onSuccessFn` hook in `scheduled-turn`) to extract durable lessons. The brief turn also injects a `<recent_sessions>` block with the last 5 days of summaries. Modeled on the Hermes Agent memory architecture — see [docs/research/hermes-memory-architecture.md](docs/research/hermes-memory-architecture.md) and [docs/plans/2026-05-26-persistent-memory-layer.md](docs/plans/2026-05-26-persistent-memory-layer.md). Closes the cross-day gap: until this PR Claude restarted blank every morning. |
| 2026-05-26 | Observability + guardrails (cost insights, error classifier, memory guardrails, shutdown flush) | (a) Per-turn cost + tokens pulled from the SDK's `SDKResultSuccess` (already includes `total_cost_usd` + `modelUsage`) and persisted into `metrics.jsonl`; `usage:today` IPC exposes a `summarizeUsage()` roll-up (by purpose + by model) for the dashboard. (b) `error-classifier.js` classifies LLM errors into `rate_limit`/`context_overflow`/`content_filter`/`auth`/`network`/`timeout`/`tool_error`/`unknown` with a `retryable` hint; the SDK auto-tags every error event with the kind. (c) Memory tool gains rate-limit (max 3 writes per turn) + per-target throttle (30s window) — stops over-eager models from flooding the char-cap. (d) `before-quit` Electron hook fires one final memory-review turn on app shutdown (`shutdown-flush.js`, 60s timeout, idempotent) so half-day sessions don't lose their lessons. All four additive; no schema or tool-shape changes. |
| 2026-05-26 | Brief reliability — timeout, metrics, and 10 content fixes | Observed 2026-05-26: London brief timed out at 5 min twice (the EFFORT bump to xhigh in PR #56 pushed brief turns past the default), produced a brief that admitted "HTF not refreshed" while HTF data sat in the bundle, cited 1m structure under "1H bias," graded pillar_grade=B with two WEAK pillars (constraint #9 says no-trade), invented arithmetic ("~220pt"), and shipped uncited sizing ("Tuesday standard"). Fixed in one PR — three reliability tweaks + ten content/schema tightenings. **Reliability:** brief-specific `timeoutMs: 600_000` (10 min) plumbed through `makeScheduledTurn`; failure metric now recorded when `userTurn` times out without throwing; retry calls `resetSession(purpose)` so the second attempt doesn't resume a confused partial conversation. **Content:** new `<phase name="brief">` in `app/main/prompts/analyze.md` with explicit per-TF citation paths, deterministic Pillar 1+2 grade rule, and a self-check; brief user prompt routes into it. **Schema:** `htf_bias[].note` requires a `(json.path)` citation regex; `sizing_note` requires `(memory.USER)` / `(memory.MEMORY)` / `(strategy.*)`; `key_levels[]` gains optional `cite` field shown as a tooltip. **Runtime:** `surfaceSessionBrief` rejects `pillar_grade=B` with ≥2 weak/fail pillars and rejects `A+` with any weak/fail. **Diff:** `Prep.jsx` `diffBriefs` normalizes level names (strips parenthetical suffix) so "AS.L" and "AS.L (swept-rejected)" no longer appear in both New and Dropped. **Engine:** `cli/lib/compute-engine-gates.js` augments every `structure_event` (and `most_recent_structure`) with `is_reclaimed: bool` computed from `quote.last` vs `level` by `dir` — surfaces the BoS/MSS-reclaimed warning the brief missed. |
| 2026-05-26 | Strategy chain (brief → open_reaction → entry_hunt → wrap) — structured handoffs + soft-fallback contract | The 2026-05-26 London brief surfaced output that admitted "HTF not refreshed" while HTF data sat in the bundle. Root cause: the dual-symbol bundle (~420KB) exceeds the Read tool's effective window — the `pair` block at chars 140k-420k is unreachable. PR #60's stricter prompt made the model honest about the gap; this PR closes it. **brief_digest:** new top-level field on paired bundles, computed in `cli/lib/brief-digest.js` (~7-15KB per symbol vs 152KB). Carries per-symbol HTF momentum + top-3 ranked FVGs/BPRs/structures + Pillar 2 quality + LTF context. Always readable in Read's first chunk. **Helpers:** `cli/lib/sizing.js` gains `computeSize({day, grade, memory_overrides})` (no LLM arithmetic, cites `strategy.sizing-table` + `memory.USER`); `cli/lib/entry-model-priority.js` is a pure decision-tree resolver (pillar2 poor → undecided; divergent → MSS; aligned + failure_swing → MSS; aligned + BoS in dir → Trend; aligned + inverted FVG → Inversion; else undecided). **Schemas:** `surface_session_brief` Zod gains `primary_draw` (anchor for the chain, cite must match `engine_by_tf.<tf>.fvgs|bprs`), `overnight_block` (untaken_above/below + verdict), `htf_quality` (h4/h1), `pillar2_verdict`, `no_trade_reason` (drives hard-vs-soft short-circuit), `chain_status`. `surface_ltf_bias` gains `leader`, `htf_ltf_alignment`, `is_retrace_day`, `entry_model_priority`, `grade_cap`, `chain_status`. `surface.js` cross-validates `no_trade_reason` (throws if missing on no-trade grade) and `entry_model_priority` (warns on mismatch with resolver). **Memory:** `pillar1.md` / `pillar2.md` become comparative (per-symbol `mnq:`/`mes:` sections re-rendered from disk on each surface call). **Prompt:** four phase rewrites in `app/main/prompts/analyze.md` (mirrored to `.claude/commands/analyze.md`): brief = 8-step walk with primary_draw pick; open_reaction = no-trade gate + minute-14 leader + entry_model_priority; entry_hunt = 6-step chain preamble + primary_draw validity check + chain-closure `tp2_cite: pillar1.<leader>.primary_draw.top`; new `<phase name="catch_up">` backfills when ltf-bias.md missing past 09:45 ET. New rule 8: `chain_status` enum (clean / degraded:&lt;reason&gt; / backfilled:&lt;phase&gt; / divergent / stale:&lt;min&gt;). **Routing:** `bar-close.js` `shouldRouteToCatchUp` detects the catch-up condition and prepends a routing directive into the per-bar prompt. **Wrap:** prompt updated to read chain frontmatter and emit a `chain_audit` block in `summary.md` frontmatter (tomorrow's brief reads this via `<recent_sessions>` for cross-day patterns). **Renderer:** `Prep.jsx` adds `ChainStatusChip` (amber/red on non-clean status) + `PRIMARY HTF DRAW` panel with cite tooltip. **Tests:** +33 unit tests across `brief-digest` (8), `sizing.computeSize` (10), `entry-model-priority` (8), `catch-up` (7); fixtures 004 (paired with digest) + 005 (divergent NY) added (smoke now 10/10). Spec: [docs/superpowers/specs/2026-05-26-strategy-chain-design.md](docs/superpowers/specs/2026-05-26-strategy-chain-design.md). Plan: [docs/superpowers/plans/2026-05-26-strategy-chain-implementation.md](docs/superpowers/plans/2026-05-26-strategy-chain-implementation.md). |
| 2026-05-27 | PREP panel redesign — checklist-mirror layout | Restructure PREP to mirror the strategy doc's 7-step checklist: STEP 1 HTF Bias (+ primary draw nested), STEP 2 Overnight + Levels (grouped above/below `currentPrice` from `useSymbolCache`, with alert bells preserved), STEP 3 Price Quality (Pillar 2 broken out via name-substring matching, robust to ordering changes). One-line PRE-SESSION GRADE headline replaces the full pillar drilldown (Pillar 1 + 2 status visible inline; full pillars panel is still used by LIVE/REVIEW). SCENARIOS promoted from a buried subsection of PLAN to a first-class panel with grade pills; additive Zod extension on `surface_session_brief` adds `id`, per-scenario `grade` enum (`A+`/`B`/`no-trade`), and digit-refined `target`. Existing `condition` field name kept for backward compat with briefs on disk. Stale banner + day-over-day diff link + chain chip + refresh button collapse into one STATUS STRIP row above SESSION BRIEF. Same data hooks (`useSessionBrief`, `useSessionRecap`, alert plumbing) — no IPC changes. Pure helpers extracted to `app/renderer/src/Prep.helpers.js` (4 exports — `groupLevelsByPrice`, `selectPillar`, `pillar2ToRows`, `formatChainChip`) so they're testable with `node --test` (renderer has no Vitest). **Tests:** +16 helper unit tests + 3 brief-flow schema round-trip tests (267 total). Spec: [docs/superpowers/specs/2026-05-26-prep-panel-redesign.md](docs/superpowers/specs/2026-05-26-prep-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-prep-panel-redesign.md](docs/superpowers/plans/2026-05-27-prep-panel-redesign.md). |
| 2026-05-27 | LIVE panel redesign — three explicit sub-states | Restructure LIVE around three deliberate layouts routed by data (activeTrade → InTrade; subState=open-reaction → OpenReaction; else → EntryHunt). **OpenReaction** gains STEP 4 prefix on the existing tracker + a new SESSION LIQUIDITY panel that reads `useSessionBrief().brief.key_levels` (no new IPC). **EntryHunt** gains a STEP 5+6 ENTRY MODEL + CONFIRMATION panel above SetupCard with explicit PD-tap / 1m close / 5m close / clean-delivery checks (substring-matched against `activeSetup.pillar_breakdown[Pillar 3].elements`); SetupCard + accept/reject unchanged. **InTrade** is new and dedicated: trade header, LIVE GRID 4-cell (PRICE / P&L / TO TP1 / TO STOP), risk plan rows, three TV hand-off buttons (`▸ TV STOP` / `▸ TV SCALE` / `▸ TV CLOSE` — fire a toast + scroll the chart pane into view; no broker writes per CLAUDE.md constraint #2), and a BRAIN narration block sourced from the latest `useChat().messages` filtered to `type === "bar-read"`. Chat + setup history persist below the IN-TRADE panel (hybrid layout) so the trader can ask questions mid-trade. Stop-to-BE automation unchanged (already happens on TP1_HIT via `trade-ticker.js`). Pure helpers extracted to `app/renderer/src/Live.helpers.js` (4 exports — `selectPillar3`, `pillar3ToConfirmationRows`, `liveGridFromTrade`, `latestBarReadMessage`) for `node --test` coverage. **Tests:** +17 helper unit tests (~284 total). Spec: [docs/superpowers/specs/2026-05-27-live-panel-redesign.md](docs/superpowers/specs/2026-05-27-live-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-live-panel-redesign.md](docs/superpowers/plans/2026-05-27-live-panel-redesign.md). |
| 2026-05-27 | REVIEW panel redesign — chronological CANDIDATE LEDGER | Merge today's `ACCEPTED TRADES` (full TradeCards) and `REJECTED / NO-TRADE` (compact rows) sections into a single chronological `CANDIDATE LEDGER` sorted by `setup.ts`. Each row carries `ts · grade · side · model · state pill · reason`. State derivation maps `_disposition` + folded trade `outcome` to one of `CONFIRMED · TP1/2`, `STOPPED`, `INVALIDATED`, `REJECTED`, `NO-TRADE`, `OPEN`, `PENDING`. **Click-to-expand:** confirmed/accepted rows show a `▸` / `▾` caret; clicking toggles an inline `LedgerTradeExpand` wrapping the existing `TradeCard` from `Shared.jsx` (reused unchanged). Non-confirmed rows are read-only (the reason column carries the no-trade or rejection text). **Grade column:** renders `"no-trade"` as `"NO"` so the narrow column doesn't wrap; the wider state pill column still shows `"NO-TRADE"`. **BLOCKED MOMENTS skipped** — the ledger already shows the chronological cluster of no-trade markers; a separate panel would duplicate. **Backend change:** one additive line in `app/main/review.js` `getJournalFor` attaches `_rejection_reason` to rejected setups (sourced from the matching reject trade event's `reason` field). **AGENT STATE + EXPORT JSON + SESSION JOURNAL + WATCH NEXT SESSION + SESSION LIBRARY all unchanged.** Pure helpers extracted to `app/renderer/src/Review.helpers.js` (4 exports — `formatGradeShort`, `deriveLedgerState`, `deriveLedgerReason`, `buildLedger`) for `node --test` coverage. **Tests:** +25 helper unit tests (309 total). Spec: [docs/superpowers/specs/2026-05-27-review-panel-redesign.md](docs/superpowers/specs/2026-05-27-review-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-review-panel-redesign.md](docs/superpowers/plans/2026-05-27-review-panel-redesign.md). |
| 2026-05-27 | Essentialist re-add on top of reference 1:1 port + global CLAUDE popover + ForexFactory NEWS calendar | The reference 1:1 port (commit `e23164a`) gave a coherent visual shell but stripped real functionality (live brief, alert bells, candidate ledger expansion, active trade narration). This PR re-adds the function while applying the essentialist cuts decided in the 2026-05-27 brainstorm: each piece of info appears in exactly one place (10 PREP panels → 5; 6 REVIEW panels → 3); CLAUDE conversation moves from page-inline to a global top-bar popover (was instantiated twice in LIVE sub-states); new weekly ForexFactory NEWS calendar replaces the empty-state stub; RISK rows broken into separate Entry/Stop(red)/TP1+TP2(green) for color-coded scannability; unified `.pill` class (22px height, 44px min-width) replaces the scattered chip/tab/button sizes; neutral black palette replaces the navy tint. `window.GOFNQ_DATA` adapter dropped — panels read hooks directly. Calendar backend lives in `app/main/calendar.js`; refreshes on boot (if cache >24h) and every Monday 06:00 ET via plain `setTimeout` (no LLM turn). New IPC: `window.api.calendar.thisWeek()` + `onUpdate(cb)`. New helpers: `htfBiasToRowsConcise` / `overnightHeaderRows` / `scenariosMeta` in `Prep.helpers.js`. **Tests:** +10 calendar tests + 7 prep-helper tests (326 total; one pre-existing metrics-rotation failure unchanged). Spec: [docs/superpowers/specs/2026-05-27-functionality-re-add.md](docs/superpowers/specs/2026-05-27-functionality-re-add.md). Plan: [docs/superpowers/plans/2026-05-27-functionality-re-add.md](docs/superpowers/plans/2026-05-27-functionality-re-add.md). |
| 2026-05-27 | Prompt kernel split — analyze.md → kernel.md + phase-`<purpose>`.md | Single 66 KB / ~16,500-token monolith (`app/main/prompts/analyze.md`) shipped to every turn regardless of purpose. Research (combined Hermes Agent architecture + Anthropic context-engineering anti-patterns) found 20.6 KB of dead code (`entry_hunt_legacy_DISABLED` 14,177 chars + `pre_session` 6,440 chars) shipped on every turn for zero behavior. Per-purpose mis-fit: a `chat` turn never reads the engine bundle but ships full bundle_fields + ict_vocabulary + examples + entry_hunt phase block on every message. Context rot (Anthropic's term): published 13.9-85% accuracy drops as context grows even with perfect retrieval. **This PR (1 of 3):** `kernel.md` (5,355 chars shared — 8 rules + strategy authority + compressed how_to_run + compressed phase_routing) + `phase-<purpose>.md` (2,497 to 29,376 chars per purpose) replace the monolith. `loadSystemPrompt(purpose)` composes `memory_block + kernel.md + phase-<purpose>.md`. Code-side `PROTOCOL_BY_PURPOSE` map + 7 fragment constants (CORE / ANALYSIS / BRIEF / WRAP / ALERTS / MEMORY_GUIDANCE / REVIEW) removed from `sdk.js` (1,221 lines deleted; now in the phase files). Per-file mtime cache + last-known-good fallback in `_promptCache: Map<absPath, {text, mtime}>`. `<phase name="pre_session">` and `<phase name="entry_hunt_legacy_DISABLED">` deleted (replaced by brief turn months ago / explicitly DISABLED). **Verified savings (live `[sdk] init ok, prompt length (bar-close) 33388`):** chat 67804 → 7763 (8.7×); review 68085 → 8384 (8.1×); wrap 66730 → 9290 (7.2×); brief 67105 → 24249 (2.8×); bar-close 68227 → 33388 (2.0×); catch-up 66940 → 34287 (2.0×). All ≥99% trigram overlap with pre-split snapshots — no content fabricated during the split. **Verification:** new `tests/system-prompt.test.js` (6 test groups: kernel-present, per-purpose-present, no-analysis-in-chat/review/wrap, no-dead-code) + `scripts/snapshot-prompts.js` (baseline) + `scripts/diff-prompt-shape.js` (trigram overlap) + smoke fixtures 16/16 + 347 pass / 1 known-fail unit suite + manual smoke (Electron boot + brief auto-fire on Opus 4.7 — clean). **Out of scope:** Skills extraction (PR 2), cache-breakpoint fix (PR 3). Spec: [docs/superpowers/specs/2026-05-27-prompt-kernel-split-design.md](docs/superpowers/specs/2026-05-27-prompt-kernel-split-design.md). Plan: [docs/superpowers/plans/2026-05-27-prompt-kernel-split.md](docs/superpowers/plans/2026-05-27-prompt-kernel-split.md). |
| 2026-05-27 | Prompt partials extraction — dedup byte-identical blocks into `partials/<name>.md` | PR 1 left byte-identical blocks duplicated across 2-3 phase files each. bar-close and catch-up were 92% identical; brief shared `<bundle_fields>` + `<ict_vocabulary>`; chat/wrap/review shared `## PERSISTENT MEMORY GUIDANCE`. Drift risk: editing any block required matching edits across all consumers. **This PR (2 of 3):** `app/main/prompts/partials/` with 8 single-source files (bundle-fields, ict-vocab, memory-guidance, open-reaction-phase, entry-hunt-phase, examples, anti-patterns, output-json). Each phase file embeds `<!-- @partial:NAME -->` markers in place of the extracted blocks. `loadSystemPrompt(purpose)` scans the phase body via `findPartialReferences` (regex whitelist `[a-z0-9-]+` — prevents path traversal via marker names), reads each referenced partial via the existing mtime cache, and substitutes via `composePhaseWithPartials` (strips one trailing newline per partial to keep byte-identical join). Pure helpers in `app/main/prompt-composer.js` so unit tests don't boot Electron / Agent SDK / Zod. **Skipped:** `<!-- @partial:alert-guidance -->` extraction — bar-close's ALERT GUIDANCE is a superset (analysis para + chat-management para), brief's is a subset (analysis only), chat's is a third variant (chat-management only). Splitting it would need three sub-partials for ~1.4 KB savings — not worth the complexity, kept inline. **Verified savings (byte-identical composed prompts):** chat 7763; review 8384; wrap 9290; brief 24249; bar-close 34334; catch-up 35233 — **delta +0 vs pre-PR baseline for all 6 purposes; 100% trigram overlap.** Phase-file disk sizes: bar-close 29 KB → 3.5 KB; catch-up 30 KB → 4.4 KB; brief 19 KB → 11 KB; chat/wrap/review lose ~1 KB each. ~38 KB of duplicated bytes on disk → ~27 KB single-source partials. **Verification:** new `tests/prompt-composer.test.js` (14 unit tests on `findPartialReferences` + `composePhaseWithPartials`) + new `tests/system-prompt-partials.test.js` (9 per-purpose section-marker + no-duplicate + no-cross-contamination tests, with `\n`-anchored markers to avoid matching prose references) + new `scripts/verify-prompts-byte-identical.js` (strict equality gate run after each extraction) + smoke fixtures 16/16 + diff-prompt-shape.js (100% overlap for all) + pre-existing `tvAlertCreate` failure on `main` is unchanged. **Token cost unchanged** — same bytes ship to the model per turn. Win is single-source-of-truth + drift elimination + cheaper future edits. **Out of scope:** Token reduction (would require per-purpose dropping of partials; deferred), Skill-tool wiring (risky for load-bearing examples), cache-breakpoint fix (PR 3). Spec: [docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md](docs/superpowers/specs/2026-05-27-prompt-partials-extraction-design.md). Plan: [docs/superpowers/plans/2026-05-27-prompt-partials-extraction.md](docs/superpowers/plans/2026-05-27-prompt-partials-extraction.md). |
| 2026-05-27 | Prompt cache breakpoint — split system prompt at SYSTEM_PROMPT_DYNAMIC_BOUNDARY | After PR 1 (kernel split) and PR 2 (partials extraction), the composed system prompt was still a single string per purpose, so the Anthropic prompt cache treated each purpose independently — a chat turn between two bar-close turns burned the bar-close cache. **This PR (3 of 3):** `loadSystemPrompt(purpose)` now returns `string[]` ending in `[..., SYSTEM_PROMPT_DYNAMIC_BOUNDARY, composedPhase]`. The SDK (Claude Agent SDK v0.3.150) splits at the boundary: `memBlock + kernel` (the cross-purpose shared prefix) becomes cross-session cacheable; per-purpose `composedPhase` sits after the boundary and doesn't pollute the cached prefix. A pure `joinSystemPrompt(value)` helper in `app/main/prompt-composer.js` lets verification scripts + tests keep treating the result as a string — drops the boundary sentinel and joins with `"\n\n"`. **Loss-free verified:** `joinSystemPrompt(loadSystemPrompt(p))` byte-identical to pre-PR string output for all 6 purposes (`scripts/verify-prompts-byte-identical.js` OK, delta +0; 100% trigram overlap via `diff-prompt-shape.js`). **Cache win:** mixed-purpose sequences now hit the shared `memBlock + kernel` prefix (~5-7 KB of tokens) on every purpose switch instead of paying full input cost — `cache_read_input_tokens` (already extracted by `app/main/usage.js`) jumps from ~0 pre-PR to several thousand on the second turn after a purpose switch. **Verification:** 9 new unit tests on `joinSystemPrompt` (string passthrough, boundary removal, array join, edge cases, type guards) → 23 total `prompt-composer` tests + existing `system-prompt.test.js` + `system-prompt-partials.test.js` all wrapped via the helper (38 total, all green) + smoke fixtures 16/16 + pre-existing `tvAlertCreate` failure on `main` unchanged. **Out of scope:** Reordering `memBlock` vs `kernel` (would change bytes — loss-free violation; the gain on memory writes is marginal), multiple cache breakpoints (SDK array+boundary mechanism gives exactly one), cache-rate dashboard panel (metrics already captured in `metrics.jsonl` — could be a follow-up). Closes the 3-PR prompt-engineering series. Spec: [docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md](docs/superpowers/specs/2026-05-27-prompt-cache-breakpoint-design.md). Plan: [docs/superpowers/plans/2026-05-27-prompt-cache-breakpoint.md](docs/superpowers/plans/2026-05-27-prompt-cache-breakpoint.md). |
| 2026-05-28 | Workstation popovers (PREP/LIVE/REVIEW → topbar cells) | Retired the `01 PREP / 02 LIVE / 03 REVIEW` mode tabs in favor of topbar-anchored popovers matching the BACKTEST/CLAUDE/ALERTS recipe. Chart now fills the entire main area below the topbar. Widths: PREP 660px, LIVE 420px always (HUNT + IN-TRADE), REVIEW 660px — `.bt-popover` recipe + new `.w-660` modifier. Per-cell badges convey state at a glance (PREP grade pill, LIVE tri-state dim/amber-HUNT/colored-P&L, REVIEW count or day P&L). Files renamed: `Prep.jsx → PrepPopover.jsx` exports `<PrepCell>`; `Live.jsx → LivePopover.jsx` exports `<LiveCell>`; `Review.jsx → ReviewPopover.jsx` exports `<ReviewCell>`. Three new hooks ([usePrep](app/renderer/src/hooks/usePrep.js), [useLive](app/renderer/src/hooks/useLive.js); REVIEW reuses existing [useReview](app/renderer/src/hooks/useReview.js)) — usePrep returns `{state, derived, actions}`; useLive returns `{subState, actions}` with a pure `deriveSubState({phase, activeTrade, surfacedSetup}) → 'idle'|'open-reaction'|'entry-hunt'|'in-trade'|'done'` selector. Schema extensions: `prose_summary: z.string().min(50).max(1000).optional()` added to `surface_session_brief` + `surface_session_summary` inline tool schemas in [sdk.js](app/main/sdk.js); brief.json / summary.json auto-persist via the existing `{...payload, ts}` spread in [surface.js](app/main/tools/surface.js). Brief + wrap prompts updated to instruct Claude to fill the new field. PREP popover renders a `BRIEF · CLAUDE` section between PRICE QUALITY and SCENARIOS using the existing `.trade-narration` blue-left-border + surface-2 prose style. Bells in LEVELS interactive via existing `window.api.alert.arm/disarm` IPC. TV handoff buttons in LIVE IN-TRADE fire `live:tv-handoff` CustomEvent + toast (no broker writes per CLAUDE.md constraint #2). HUNT → IN-TRADE transition swaps popover body in-place. Exclusive mode preserved: PREP/LIVE bodies show the existing "BACKTEST RUNNING" placeholder when [useBacktestRunning](app/renderer/src/hooks/useBacktest.js)`.running` is true; REVIEW unaffected (reads historical state). Removed: `<PrepWorkstation>` / `<LiveWorkstation>` / `<ReviewWorkstation>` full-pane wrappers (now legacy aliases); `.main.split-50` / `.main.split-70` / `.work-pane` / `.chart-host.split-*` / `.modes` / `.mode-btn` CSS; `mode` React state + `mode:switch` IPC handler + preload exposure (mode.js retained for internal main-process use). Hotkeys 1/2/3 open PREP/LIVE/REVIEW; Esc closes any open popover (wired via `topbar:open-cell` CustomEvent). **+26 new tests** (use-prep 9, use-live 17), all green; `npm test` 509 pass / 0 fail; smoke fixtures 16/16. Spec: [docs/superpowers/specs/2026-05-28-workstation-popovers-design.md](docs/superpowers/specs/2026-05-28-workstation-popovers-design.md). Plan: [docs/superpowers/plans/2026-05-28-workstation-popovers.md](docs/superpowers/plans/2026-05-28-workstation-popovers.md). |
| 2026-05-28 | Backtest popover — six-state topbar dropdown that replays a session through the live phase chain | A new `BACKTEST` cell sits in the topbar beside CLAUDE / ALERTS (same `position:absolute; top:100%; right:0; border-top:0; box-shadow:0 6px 20px rgba(0,0,0,0.6)` recipe as the existing popovers — see `.bt-popover` in [app/renderer/src/app.css](app/renderer/src/app.css)). Six body variants switch by `state.ui` in [app/renderer/src/BacktestPopover.jsx](app/renderer/src/BacktestPopover.jsx): **IDLE** (configure-new-run form + recent 5), **AUTO RUNNING** (progress bar + live setup list, badge shows pulsing green dot + %), **PAUSE AWAITING** (red banner + ACCEPT/REJECT decision, badge shows `PAUSED`), **DONE** (4-cell summary + OPEN DETAIL / RUN ANOTHER), **LIBRARY** (880px-wide variant — aggregate dashboard + filters + sortable table), **DETAIL** (single-run deep view — setup cards with rationale, LLM activity log, DELETE). Popover toggles `.wide` class for LIBRARY/DETAIL; everywhere else it stays 420px. **Engine** ([app/main/backtest-engine.js](app/main/backtest-engine.js)) reuses `sdk.userTurn` unchanged — only the writer path differs. A new `setBacktestSessionContext({runId, session})` in [app/main/sessions.js](app/main/sessions.js) flips `activeSessionDir()` to return `state/backtest/<run-id>/<session>/` for the duration of the turn, so every existing writer (pillar1.md, ltf-bias.md, summary.md, setups.jsonl) lands in the backtest folder without per-callsite changes. Mirrored `setBacktestContext({runId})` in [app/main/persistent-memory.js](app/main/persistent-memory.js) short-circuits `add/replace/remove` to return `{success:true, suppressed:true}` — backtests are *repeatable*, so memory must be read-only during a run. Both contexts set/cleared by `userTurn` in `sdk.js` finally-block so they never leak. **Outcome grader** ([app/main/backtest-grader.js](app/main/backtest-grader.js)) is a pure function called after each bar step; conservative rule on intra-bar conflict — if a single bar's high/low straddles both stop and tp1, assume stop hit first. **AUTO** mode auto-accepts every surfaced setup; **PAUSE** mode emits `paused` event and `await`s a `{type:"decision", choice}` command from the renderer via `EventEmitter` bus. **IPC** ([app/main/ipc-backtest.js](app/main/ipc-backtest.js)) wraps the engine: `backtest:start/stop/decision/list/get/delete/status` invokes + `backtest:event` stream. Renderer state machine in [app/renderer/src/hooks/useBacktest.js](app/renderer/src/hooks/useBacktest.js) — a `useReducer` with one transition per event type. A second hook `useBacktestRunning()` exposes a slim `{running, session}` for PREP / LIVE exclusive-mode placeholders ("BACKTEST RUNNING · NY-AM — LIVE DATA UNAVAILABLE"). **Cost** is shown as an estimate on the configure form (per-turn × bar count); no hard ceiling per user decision. **Persistence**: `state/backtest/<run-id>/<session>/` (mirrors live shape) + master `state/backtest/index.json` registry. Crashed runs are detected by `reconcileAbortedRuns()` (folder exists, no `summary.json`, not in index). **+59 new unit tests** (store 10, grader 10, helpers 18, memory-suppression 7, sessions-redirect 3, metrics passthrough 2, engine 10 — but two test-only utilities are integration), all green; `npm test` 483 pass / 1 pre-existing rotateMetricsFile fail unchanged. Spec: [docs/superpowers/specs/2026-05-28-backtest-popover-design.md](docs/superpowers/specs/2026-05-28-backtest-popover-design.md). Plan: [docs/superpowers/plans/2026-05-28-backtest-popover.md](docs/superpowers/plans/2026-05-28-backtest-popover.md). |
| 2026-05-28 | ICT Engine V2 parser migration | `cli/lib/ict-engine-parser.js` now recognizes `engine.meta.schema=2` alongside `=1`. Three changes: (1) `findIctEngineRows` uses `/^ICT Engine\b/i.test(name)` prefix match instead of `=== 'ICT Engine'` — V2's indicator is named `ICT Engine V2` and the exact-equality check silently dropped it, leaving `bundle.engine: null` despite 102 rows of valid V2 emit; (2) new `SUPPORTED_SCHEMAS = new Set([1, 2])`, `schema_supported` checks set membership instead of `=== ENGINE_SCHEMA`; (3) `ROW_FIELD_TYPES` extended with the 10 V2-added FVG/BPR lifecycle fields (`entered_ms`, `bars_in_zone`, `minutes_in_zone`, `ce_held`, `confirm_close`, `confirm_dir`, `confirm_ms`, `chop_15m` typed; `size_quality`, `entry_state` keep string default) plus BPR's `ce` (V1 didn't ship CE on BPRs, V2 does). V2's quality row drops `has_chop` and adds `session` — both handled correctly without code changes (parser drops absent keys, unknown keys default to string). V2 schema diff documented in `docs/research/ict-engine-v2-schema.md`. **V1 fixtures kept as the schema=1 back-compat regression baseline** — `npm run smoke:fixtures` continues to pass 16/16 on V1 bundles. V2 captures live under `tests/migration/` (`v2-baseline.bundle.json`, `v2-raw-pine.txt`). User-side one-time step: load `ICT Engine V2` in the in-app TradingView (was `ICT Engine V1` per the webview migration note above). Pillar 3 + confirmation work (next PR in the walker-engine series) consumes the V2 fields — `bars_in_zone` for chop_timeout reuse, `confirm_close` + `confirm_dir` for confirmation gating, `entry_state` for spawn de-dupe. **Verification:** 3 new unit tests in `tests/ict-engine-parser.test.js` lock V2 row coercion (fvg lifecycle, bpr.ce + lifecycle, quality session+atr); `npm run test:unit` 427/0; `npm run smoke:fixtures` 16/16; live `./bin/tv analyze` against V2-loaded MNQ1! 1m chart returns 154 KB bundle (vs 6.5 KB pre-fix with engine=null) with schema=2, 10 levels, 24 fvgs, 24 structures, 26 swings, 12 bprs, 4 sweeps, 1 pool, full quality. Spec: [docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md](docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md). Plan: [docs/superpowers/plans/2026-05-28-ict-engine-v2-migration.md](docs/superpowers/plans/2026-05-28-ict-engine-v2-migration.md). |
| 2026-05-28 | Webview migration — retire TV Desktop, single TradingView surface | The CLI was talking to TradingView Desktop (CDP 9223, separate native process) while the in-app `<webview>` in `app/renderer/src/TvChart.jsx` sat alongside as a display-only second surface. Two TradingView instances, one source of truth. This PR collapses them into one. **Code change:** one-line `app.commandLine.appendSwitch("remote-debugging-port", "9223")` in `app/electron-main.js` exposes the Electron process (incl. webviews) over CDP on 9223. The CLI's tab-discovery filter in `packages/core/tab.js:18` + `connection.js:75` was loosened to accept either `type: 'page'` (TV Desktop fallback) or `type: 'webview'` (default, post-migration) — without that, the webview's CDP target was discarded. Removed: `launch` helper from `packages/core/health.js` (was spawning TV Desktop with `--remote-debugging-port=9222`, the wrong port for this project anyway) + unused `fs`/`child_process` imports + `tv launch` CLI command in `cli/commands/health.js`. Fixed: `packages/core/tab.js:63` error message no longer references the `tv_launch` MCP tool name (CLAUDE.md constraint #2 forbids referencing MCP tools). **User-side one-time setup:** sign in to TradingView in the webview, load saved layout incl. ICT Engine V1 (V2 is a different schema the parser doesn't understand — see verification log), set as default. Verified working before migration. **Verification:** new `scripts/diff-bundle.js` structurally compares two `./bin/tv analyze --out` bundles with 0.25pt numeric tolerance + skip-list for volatile paths (timestamps, emit times, live tick / aggregates / quality, session gate); +15 unit tests in `tests/diff-bundle.test.js`. Pre-migration baseline at `tests/migration/desktop-baseline.json` (126 KB), post-migration at `tests/migration/webview-baseline.json` (140 KB). Engine parity confirmed: schema=1, 10 levels, 24 fvgs, 24 structures match exactly across both backends. Smoke fixtures 16/16. `npm test` clean modulo pre-existing `tvAlertCreate` failure. Manual probes on webview: drawings draw/list/clear ✅, replay start/step/stop ✅. **Two pre-existing bugs surfaced + fixed during manual probes** (separate commits on the same branch — they were broken before the migration too but the migration verification flow exposed them): (1) `cli/commands/replay.js` only accepted `--date`, not `--from` as docs reference — added `from` as long-form alias; (2) `packages/core/alerts.js` `create()` used DOM-keyboard automation against TV Desktop's alert dialog which TV Web doesn't have — rewrote to POST `https://pricealerts.tradingview.com/create_alert` from the page context (same REST endpoint TV Web's own UI hits, discovered via fetch-interceptor probe). Critical gotcha: do NOT set `Content-Type: application/json` on the POST — TV's UI omits it (sent as text/plain), making it a "simple" CORS request without preflight; setting it triggers a preflight that TV's server rejects ("Failed to fetch"). Documented inline. **Rollback:** `git revert <range>` + relaunch TV Desktop manually with `--remote-debugging-port=9223`. Zero state migration — both backends consume `state/` files identically. Spec: [docs/superpowers/specs/2026-05-27-webview-migration-design.md](docs/superpowers/specs/2026-05-27-webview-migration-design.md). Plan: [docs/superpowers/plans/2026-05-27-webview-migration.md](docs/superpowers/plans/2026-05-27-webview-migration.md). |
| 2026-06-11 | Verified multi-TF capture + data_gap/htf_unclear separation | Root cause of the dead June sessions: `captureMultiTf` did setTimeframe + fixed 400ms sleep + one `getPineTables` read, silently recording `engine_by_tf.h4/h1 = null` whenever the engine re-render lagged the TF switch (8 of 13 June briefs graded `no-trade: htf_unclear` on missing data; even saved baselines carry the hole). **Capture:** new `cli/lib/tf-capture.js` — every TF read is accepted only when the parsed table's `meta.tf` stamp matches the requested resolution (engine stamps every emit; daily emits `1D` for TV's `D`), polling up to 4s; failed TFs get a second pass (skipped when ALL fail — indicator absent); residual gaps are filled from `state/baseline-<sym>.json` age-capped at 24h (strategy §2.4 HTF reuse), never during replay; `--fallback-baseline` overrides the convention path. Bundle + each `pair.symbols.<sym>` gain `capture_health: {ok, missing[], fallback[], by_tf:{<tf>:{status: fresh\|fallback\|missing\|error, attempts, pass, baseline_age_seconds?}}}`. **Digest:** `brief_digest.symbols.<sym>.htf.<tf>` gains `data_status` so consumers distinguish "no good FVG on a healthy capture" from "capture never returned data". **Grading** (`buildDirectSessionBriefPayloads`, per constraint #9): no draw + missing HTF capture → `no-trade: data_gap` (hard short-circuit downstream, honest); pillar2 fail → `pillar2_poor`; no draw on healthy capture → `htf_unclear` (real market verdict); exactly one weak element → **B** (was no-trade — 2026-06-10 MNQ with a daily draw + marginal pillar2 should have been a tradable B day); `chain_status` marks `degraded:htf_partial` / `degraded:htf_fallback` when a draw exists on incomplete data. `htf_quality` now cites the digest's real `htf.h4/h1.quality` rows (previously cited pillar2 m5/m15 — LTF data under HTF labels). **Verification:** +25 unit tests (tf-capture 16, digest 2, grader 7 incl. a 2026-06-10 regression case); 743/744 `npm test` (1 pre-existing `LLM provider selection` fail unchanged); smoke fixtures 22/22; live against the running app: single + paired sweeps all-fresh incl. the chronic h1 hole (m15 needed attempts=2 — the lagging-emit case the old code lost), paired bundle now grades B/clean on both symbols. |
| 2026-06-11 | Session supervisor — auto-arm, heartbeat watchdog, pre-open readiness | Second half of the dead-June-sessions fix (first: verified capture, row above). The live loop required a manual `detector:start` click to flip `mode=live` after the workstation-popover redesign removed the mode tabs; `last-mode.json` sat on `prep` since June 5, the detector heartbeat died June 8 (hung-but-alive processes never fire the `exit`-based restart in bar-close.js), and `handleBar` gates every turn on `isLive()` — so briefs/wraps kept writing while the live chain never ran. New `app/main/session-supervisor.js`: pure decision core (`planSupervisorAction`, `upcomingSession`) + DI runtime (`createSessionSupervisor`) + production shell on a 30s tick. Behaviors: (1) **auto-arm** during session windows (london/ny-am/ny-pm ET, same windows as `sessions.js`) — sets mode live + starts the detector; a manual `detector:stop` suppresses re-arm for the remainder of that session only (`noteManualStop` wired in ipc.js); (2) **heartbeat watchdog** — `detector-heartbeat.json` mtime older than 120s during a session → stop + restart, 90s post-intervention grace, capped at 3/session, then ONE loud give-up; (3) **pre-open readiness** — runs `node cli/index.js live-check --session <s>` (CLI surface per constraint #2) once per session in the 10-min lead window; blocked → native macOS notification (`app/main/notify.js`, lazy electron import so plain-node tests/CLI can import) + `app:error` event (renders in the CLAUDE chat; no-provider events default to the claude popover); (4) **disarm** to prep at window end unless a trade is open. **Verification:** +22 unit tests (plan matrix, lead windows, DI tick flows: arm/restart/give-up-once/manual-stop/disarm/readiness-once); 765/766 `npm test` (pre-existing `LLM provider selection` fail unchanged); smoke 22/22; live-check CLI verified parseable against the running app (returned the real blockers `bars_not_updating` + `session_not_active`); production wiring booted in plain node — tick returned `{action:none, reason:idle}` off-session. |
| 2026-06-11 | End-to-end proof gates — replay corpus gate + day tapes | Fix #4 of the dead-June-sessions series. The replay harness (`npm run replay`, scripts/replay-runner.js, 12 cases incl. the real 2026-05-29 Inversion long with exact entry/stop/tp1) was manual-only, and every case was a single-snapshot detector call — nothing proved the chain *across* bars where June actually died. **Gate 1:** `tests/replay-accuracy-gate.test.js` runs the full `tests/fixtures/*.replay.json` corpus inside `npm test` and fails on any missed setup / false candidate / wrong model / side / packet, or corpus shrinkage below 12 cases (tamper-verified: flipping one expected.side trips wrong_side=1). **Gate 2 (day tapes):** new `cli/lib/day-tape.js` — a tape is the recorded per-bar detector-inputs sequence for one session; `foldTape` folds the REAL production truth fn (`buildDeterministicPacketTruthFromInputs`, exported via bar-close `__test`) over the entries carrying walker state bar-to-bar exactly like `runDeterministicPacketTruthForBar` does via walkers.json; `assessTape` asserts outcome / model / side / entry / stop / tp1 / grade / first_packet_event_ts / max distinct packets, and packets on hand-verified no-trade days are hard failures. **Recording:** `runDeterministicPacketTruthForBar` now appends each bar's exact inputs to `<sessionDir>/walker-inputs.jsonl` (fire-and-forget). **Promotion:** `scripts/promote-day-tape.js <date> <session>` freezes a recorded day into `tests/tapes/<date>-<session>.tape.json` with `expected` prefilled from the day's surfaced packet and `verified:false` — the gate skips unverified tapes until a human confirms the expectation and flips the flag. **Corpus seed:** `tests/tapes/0001-synthetic-mss-long.tape.json` — 5 bars driving the real chain from empty state through spawn (sweep + failure swing + fresh bull FVG) → tap (price inside PD) → confirm (1m close row) → exactly one A+ MSS long packet (entry 21000 / stop 20990 / tp1 21050) on the right bar, quiet bars no-trade. `npm run tapes` prints the report; `tests/day-tape.test.js` enforces it in CI. **Next:** record live days (recording is automatic now), promote one real A+ day per model (MSS / Trend / Inversion) + one chop no-trade day; LLM layer stays out of the gate per research (deterministic extraction → LLM synthesis) — /judge covers it separately. **Verification:** +11 unit tests (fold semantics, assess matrix, promotion, dir gate) + the 2 standing gates; `npm test` 776/777 (pre-existing `LLM provider selection` fail unchanged); smoke 22/22. |
| 2026-06-12 | Walker evidence bridge + `tv record-tape` replay-stepping recorder | The walker chain had NEVER fired on real data: June 5's truth records show every live bar blocked `missing_ict_engine_rows` — the chain consumed evidence shapes (`gates.engine.rows`, V2 entry-state confirmation, `pillar3.structural_stops`) that `computeEngineGates` never emits; only hand-built test bundles carried them. **Bridge** (`bridgeEngineEvidence` in [app/main/bar-close.js](app/main/bar-close.js), derives only-when-absent): `rows` ← pillar3.fvgs/bprs with boundary-based zone identity (`zone:<bottom>-<top>` — index refs gave the same zone a new walker id every bar: 50+ duplicates; price_context refs aligned so taps match); `confirmation` ← engine entry-state row ONLY when `confirm_ms` is inside the current bar (the table keeps completed entries 'confirmed' forever — a stale 13:41 bull confirm masked the 13:55 bearish violation), else a violation-close row synthesized when the bar closes fully through an inverted zone, keyed to the closing bar's direction (entry-models.md Inversion aggressive variant: the violating close IS the confirmation); `structural_stops` ← swing pivots. **Inversion stops are model-specific** (entry-models.md: above the zone high for shorts) — `buildExecutionPacketForWalker` prefers the walker's own zone edge over the generic pivot pool (which offered a 2.75-pt micro-pivot stop). **Recorder** (`tv record-tape --label <real-session-label> --from --to`, [cli/lib/tape-recorder.js](cli/lib/tape-recorder.js)): steps TV bar replay 1m-by-1m, captures the engine's recomputed table per step (emit_ms-verified, forming-bar dropped, wall-clock/bar-clock staleness domains split), session context from the label, per-bar inputs shaped exactly like live `buildDetectorInputs`. First real tape committed: `tests/tapes/2026-06-09-ny-am-replay.tape.json` (22 bars, verified:false pending GXNQ hand-grade — chain folds to Inversion short confirming 09:52, entry 29792, zone stop 29811.75, tp1 29302.5, grade B vs GXNQ's 5m-close 09:55 entry 29731.25 — confirmation-TF discipline is the open hand-grade question). **Verification:** +14 unit tests (8 bridge runtime, 6 recorder); 792/793 `npm test`; smoke 22/22; replay corpus 14/14 unchanged; June 9 fold verified bar-by-bar. **Lesson:** unit tests prove layers; only tapes on real data prove the chain — see docs/lessons/live-session-analysis.md. |
| 2026-06-12 | Pipeline rebuild — running-code visibility, single brain, deterministic backtest, Claude-default provider, six-element grading | Audit trigger: six merged PRs (#10–#15) never executed in production — the app's checkout sat 20 commits behind origin/main with no indicator anywhere; metrics showed zero bar-close turns June 10–11 while the wrap wrote `degraded:missing_setups` daily into a file nobody read. Five changes in one campaign. **(1) Ops visibility:** `app/main/version-status.js` polls git (boot SHA vs disk SHA vs origin/main); topbar VER cell shows red RESTART / amber PULL −N / dim sha; REVIEW's session journal renders a red CHAIN DEGRADED strip from the wrap's chain_audit (`degradedChainStages` flags degraded:*/stale:* only); the standing worktree-path test failure fixed so a red suite means something. **(2) Single brain:** the walker chain is the ONLY setup producer. Removed: the old `cli/lib/setup-detector.js` live injection + "trust the detector" surfacing contract (validators threw when the two brains disagreed; a trailing LLM no-trade could wipe the walker's setup after 60s), `setCurrentCandidate`/`validateSetupAgainstCandidate`, and the dead third engine (`runWalkerTickFor` + `app/main/walker/`, never called). The per-bar LLM turn is narration-only — compact `<walker_truth>` block, no tool calls — and fires only on packet / walker stage change / 5m close (quiet 1m bars skip the LLM; metric `narration_quiet_bar`). CLI detector remains for manual `/analyze`. Also fixed: `buildDetectorInputs` read an undefined bare `session` (swallowed ReferenceError → brief=null → empty untaken_targets → every live packet would have blocked on missing_side_consistent_tp1). **(3) Deterministic backtest:** old engine never completed a run (passed a `bundle` arg `userTurn` doesn't accept; graded off nonexistent `bars.last_bar`; never ran the walker chain). New engine: context (day's recorded brief+ltf-bias via `app/main/backtest-context.js`, else deterministic brief at the replay anchor, grade_cap B per the catch_up rule) → `recordEntries` (shared with `tv record-tape`) → fold `buildDeterministicPacketTruthFromInputs` (same brain as live) → `gradeOpenTrade` per recorded bar. $0 cost; every run persists a promotable tape.json; bus events unchanged so the popover works as-is. **(4) Provider:** DEFAULT_PROVIDER codex→claude (June 10–11 metrics: four 600s Codex timeouts on brief/wrap); scheduled turns with a directRunFn are deterministic-first regardless of provider; Codex brief commentary env opt-in (TV_CODEX_BRIEF_ANALYSIS=1); Codex itself one env var away (TV_LLM_PROVIDER). **(5) Grading:** `deriveGrade` mirrors constraint #9's six-element alignment (pillars pass + ltf-bias handoff aligned + model + confirmation) instead of zone `size_quality==='large'` — the June 9 tape now folds to grade A+, matching GXNQ's hand grade, frozen into the tape's expectation. **Verification:** 772/772 unit (suite fully green for the first time), smoke 22/22, replay corpus clean, tapes 2/2, vite build clean. |
| 2026-06-12 | ICT Engine V3 — leg extremes, NYPM levels, inversion stamps, visual overhaul | Pine source now lives in-repo at [pine/ict-engine.pine](pine/ict-engine.pine) (pristine V2 committed first for the diff; deployed via `tv pine set/compile/save`). **Machine layer (all additive — `meta.schema` stays 2; the deployed parser rejects unknown schema numbers as a safety gate, so the marker is reserved for breaking shape changes):** quality row gains `leg_high/leg_low(+_ms)` — running extremes of the CURRENT leg, reset per external structure break; live the bar they print, zero pivot-confirmation lag — the §6 structural-invalidation stop anchor (bridge feeds them into the stop pool as kinds `leg_high`/`leg_low`, nearest-beyond-zone selection picks them when tighter than session levels). NYPM.H/L levels + sweeps emitted (tracked before, discarded) — ride the name-driven session_levels pipeline incl. PR #15 stop anchors and untaken-pool sorting. `fvg.inverted_ms` stamps when the violating close flipped the zone (first-class evidence for the Inversion aggressive confirmation the bridge synthesized). `meta.bar_ms/bar_closed` give exact emit-bar identity for detector/recorder freshness. MAX_ROWS 120→140 (worst case was 119 — one more zone would have hit the table-cell cap, a Pine runtime error). Parser: `SUPPORTED_SCHEMAS={1,2,3}` forward-compat + typed new fields. **Visuals:** state-aware zone fading (fresh pops → tapped recedes → filled dashed ghost), tiny zones hidden by default (visual-only; evidence unaffected), FVG+/iFVG+ tags on large zones, untaken levels show price / forming sessions dash, MSS labels out-rank BoS, quality panel color-coded + Session row, LEG.H/L dashed neutral lines, NYPM color input. **Verified live:** both parsers (running app + branch) read the emit; 12 levels incl. NYPM; leg fields typed; screenshot-confirmed visuals; 774/774 unit, smoke 22/22, tapes 2/2. Schema doc: [docs/research/ict-engine-v2-schema.md](docs/research/ict-engine-v2-schema.md) §V3. |
| 2026-06-12 | ICT Engine visual polish + evidence table goes backend-only | The `showEvidenceTable` input is gone: a Pine table must exist on-chart for the CLI to read it over CDP, but it renders zero pixels — every cell is written transparent + tiny (visibility and readability are independent; transparent-cell reads have been the proven path since V1). Visuals: monospace typography across all labels/boxes/panels (`font.family_monospace`), muted professional palette (iFVG #56b6c2/#e5825e, sessions #6e7ff3/#a685c4/#d9b54a/#c77d9e, PD/PW/liquidity/leg desaturated), zone fills 82→88 transparency with hairline borders, quality panel restyled as a slim frameless status card (translucent bg, muted labels, right-aligned tinted verdicts), PD/PW level labels park in staggered right columns so same-price levels never overlap, sweep shape-markers replaced with small monospace glyphs (✕ sweep / ◆ rejected). Deploy gotcha recorded: `tv pine set` fails when the editor pane is closed — the sequence is open → set → verify get → compile → close. |
| 2026-06-12 | ICT Engine visual layer full redesign — premium-toolkit conventions | Researched paid SMC/ICT toolkits (LuxAlgo Price Action Concepts / SMC mitigation handling, TTrades-style level treatment) and rebuilt the render layer around their conventions. **History truncates in place:** mitigated zones close at the bar that killed them and fade to a neutral ghost (shown via Show historical); swept levels stop at their sweep bar with a ✕/◆ glyph — only the ACTIVE picture extends right of price. **iFVGs re-anchor at the inversion bar** (V3's inverted_ms) in the flipped accent with a dashed border; the dead FVG span ghosts behind. **Two-accent palette:** 16 color inputs → 4 (bull/bear/neutral/liquidity); every shade derives in one place — session levels are neutral with monospace name+price labels (untaken) instead of six competing hues. **Structure labels float centered on their line** with an ATR-scaled offset (never on the line); swing tier solid + small, internal dashed + tiny; swing tags are plain floating neutral text (no balloons). **Draw caps:** only the most recent N zones (default 8) and structure events (default 6) render — the evidence table still carries everything. **Dashboard:** merged ICT ENGINE title row + Session / Range(value·verdict) / Displacement / Candle / live Structure (accent-tinted) / Leg range. **Deploy gotchas recorded:** Pine Save does NOT reliably propagate to the on-chart study — force-update via editor Add-to-chart, which DUPLICATES the study (two identical evidence tables on one chart); remove the stale instance by entity id (tv indicator remove) and verify with tv data tables (count must be 1). |
| 2026-06-12 | Live-chain bootstrap — first live sessions expose six plumbing defects; chain becomes LLM-independent | The first live sessions on the rebuilt pipeline (London + NY-AM 2026-06-12, run with Claude auth expired all day) surfaced defects replay could never show, fixed across PRs #23-#28: **(1) slim-file starvation** — buildDetectorInputs preferred `last-scan.slim.json` (the LLM Read-budget projection that strips pillar3 + bars); the chain starved on missing_ict_engine_rows while the full scan sat beside it. Full scan first. **(2) london invalid** — VALID_SESSIONS only held ny-am/ny-pm; every London bar blocked unknown_session. **(3) LLM-dependency of the bias handoff** — the catch-up turn died on auth and the chain blocked missing_ltf_bias (the June failure mode); `app/main/live-ltf-resolver.js` now derives the open-reaction verdict deterministically (same resolver as the backtest, §2.3/§7-Step-4) with PAIR_PRIMARY leader fallback; an LLM-written ltf-bias.md still wins. **(4) 5m double-fold** — the 5m-tagged queue copy re-folded the same bar (double walker advancement, duplicate records, replay-parity break); one fold per bar_close_time, cached. **(5) auth gates** — provider-aware per-bar gate (Claude 401 no longer mutes Codex) and deterministic-first purposes (brief/wrap) never gate on LLM auth at all (the London wrap had been skipped claude_auth_blocked despite needing no LLM). **(6) symbol hijack** — a paired baseline refresh crashed mid-sweep and left the chart on MES@5m; the chain folded MES bars against MNQ context for 23 minutes. Fail-closed `symbol_mismatch` blocker + preflight pins PAIR_PRIMARY without pair-decision.json. **Strategy-semantics from live evidence:** §7-Step-4's window read as written (interactions count to minute 30, resolution from 15 — June 11 ny-pm broke NYAM.H at minute 29); §2.2 session-aware open-reaction targets (ny-pm reads NYAM.H/L); §2.3 mid-session realignment (post-window swing-tier MSS against the bias flips the day — live + backtest parity); §2.4 divergent-day model ban removed (B cap + side gate ARE the lower conviction; the ban auto-blocked every Trend long on a confirmed-turn 450pt rally). **Also:** same-day replay cannot render still-forming HTF bars (engine refuses honestly with data_gap — parity replays run next-day); summary.md renders the Codex wrap commentary (was json-only); wedge recovery automated (reload → quote-poll → re-anchor → retry) and armed on soft wedges (m1-only captures). Result: London + NY-AM ran the full chain live — brief, bias, walkers (63 peak), honest no-trade gating — with zero LLM availability. |
| 2026-06-11 | Backtest hardening + deterministic open-reaction leg | The first popover backtest run in production died silently (error only in the renderer event stream; no summary.json, no index entry, no log line) and left TV stranded in bar replay — which would have poisoned the next live capture. Root causes + fixes, all proven by re-running June 9 end-to-end headless: **(1) Failure observability** — the engine now persists an error summary + index entry on crash, logs to the main process, and `deps.cleanup` (stop replay) runs on success, failure, AND stop (`tests/backtest-engine-failure-paths.test.js`). **(2) Anchor brief under replay** — the two-symbol pair sweep switched symbols during active replay; the second symbol's capture returned empty on every TF (flaky chart-reload race; two runs died at two different lines from the same cause). The anchor brief is now SINGLE-symbol (the run's leader), pinned-and-VERIFIED before replay starts (`pinChart` polls until the chart actually reflects the switch — a fixed 600ms settle had "pinned" MNQ while the capture ran on MES), with one 15s-settle retry; the digest builds in-process via `buildBriefDigest({pair:{symbols:{[leader]: bundle}}})`. **(3) Deterministic open-reaction leg** — backtest contexts had `htf_ltf_alignment: "aligned"` hardcoded; the open-reaction phase never ran in a replay, so alignment/retrace/grade-cap were fiction. New `cli/lib/open-reaction-resolver.js` (pure, §2.3/§7-Step-4: break+rejection toward draw → aligned/A+-cap; continuation against → divergent retrace B; quiet open → unclear B per §7-Step-7 "neutral overnight") resolves from the engine's sweep rows at the minute-15 boundary and RE-evaluates each bar until minute 30 (the `rejected` flag matures — June 9's LO.H break read continuation at 09:45, rejection by 09:52), then freezes. Pre-boundary bars fold with honest `unclear`/null-bias (mirrors live, where ltf-bias.md doesn't exist until 09:45). Day-state contexts are never overridden. `chain_status`: aligned→clean, divergent→divergent, unclear→degraded:open_unclear. **(4) Draw-bias precedence** — `biasFromDraw` read the zone's own direction as bias, inverting it for magnet-zones (June 9: daily bull FVG far BELOW price = bearish draw, was read bullish). New precedence, each step cited: observed `reaction_dir` off the zone (§2.1 step 3) → fresh+took_liq zone carries its creation-displacement `dir` (§2.1 step 1) → position-toward-zone (§2.3 destination path) → legacy dir. `primary_draw` payloads now carry `reacted`/`reaction_dir`/`position` (optional in the surface Zod — additive). **(5) Pillar-2 verdict mapping** — `buildContext` only failed on verdict `"fail"`, but the deterministic enum is good|marginal|poor, so `pillar2_poor` no-trade days folded with pillar2 passing; `poor` now fails the gate. **(6) Wrap artifact** — every run writes `summary.md` with chain_audit frontmatter (the replayed day's wrap; popover DETAIL renders it). **(7) Failed-break detection** — the resolver's continuation read keyed only on the engine's sweep `rejected` bit; June 9's LO.H break up at 09:43 never flagged rejected, yet the standing SWING-tier structure was MSS bear (confirmed 09:34) and sell-side delivered all morning. A break opposing the standing swing-tier structure is now a `failed_break` — the structure, not the break, sets the bias (§7 Step 4 "what is the reaction after that break"; sweep rejections are never overridden). **(8) Side-vs-bias packet gate** — nothing stopped a packet whose side contradicted a non-null LTF bias; June 9 surfaced an "A+ MSS long" under a bearish-aligned context. New blocker `side_contradicts_ltf_bias` (§7 Step 5 + §2.3); `deriveGrade` also requires side-bias match for A+. Null bias (pre-open) leaves both sides walkable at B. **(9) entry_model_priority demoted to selection preference** — the hard `entry_model_priority_blocked` gate discarded the hand-verified A+ Inversion short because in-window failure swings pointed the resolver at MSS; per the resolver spec (§3.4 "which model to walk first") priority now orders `bestPacket` selection (grade first, then priority model) and never blocks. **(10) Chart-wedge recovery** — heavy replay use intermittently wedges TV (quotes fail, every TF empty); the anchor capture now recovers via page reload + quote-poll + re-anchor + one retry. **End-to-end result: June 9 replays to the hand-graded trade — A+ Inversion short, TP1 hit, chain_status clean, $0** (exact entry/stop/tp1 differ from the hand grade — chain enters 29691@09:58 vs GXNQ 29792@09:52 — flagged for sign-off). Plus `scripts/run-backtest-headless.js` (same engine + PROD_DEPS, extracted to electron-free `app/main/backtest-deps.js`), `scripts/refold-run.js` (re-fold a recorded run's tape in seconds, no chart), and `scripts/debug-fold.js` (per-bar walker stages + block reasons). |
| 2026-06-11 | Backend switch: TV Desktop on CDP 9225 replaces the embedded webview | User decision — the embedded TradingView returns to being a personal display surface; the system drives TV Desktop (`--remote-debugging-port=9225`) for analysis, replay, Pine deploys, and tape recording. `packages/core/{tab,connection}.js` CDP_PORT 9223→9225 (one-constant change; the target-type filter already accepts `'page'`). Verified on Desktop before merge: status/quote, evidence-table emit (107 rows, schema 2, V3 fields typed), full multi-TF analyze sweep (~10s, capture_health all-fresh on all 6 TFs), alert create/delete (REST create + DOM-verified delete), pine list, replay start/step/status/stop. Webview keeps 9223 (untouched, not driven); 9222 untouched (other projects). Operational requirement: TV Desktop must be running with the debug flag or the whole system is blind — relaunch recipe lives in hard constraint #1. |
| 2026-06-21 | Pine deploy — the CORRECT procedure (supersedes the 2026-06-12 "duplicate-and-remove" gotcha) | Root cause of the old duplicate dance: `smartCompile` searched button **textContent**, but TV's editor buttons carry their label in the `title` **attribute** (textContent empty) — so it found nothing, fell back to Ctrl+Enter, and either no-op'd or duplicated. **Correct deploy:** (1) `tv pine open "<script>"` — and it must SUCCEED (the editor pane lags on first request; `openScript` now retries 3×). Proceeding past a failed open leaves the editor UNLINKED from the on-chart script, so set/save hit a disconnected buffer and a `Save` dialog spawns a duplicate SAVED script. (2) `tv pine set --file`. (3) Apply via **"Update on chart"** — updates the existing study in place (no duplicate, settings kept, minor-version bump). It lives behind the split-button's dropdown (`aria-haspopup=menu`); `smartCompile` now reads `title`+text, PREFERS "Update on chart", and opens that dropdown to pick it. (4) `tv pine save`. (5) **Verify by KEY presence, not value:** new fields read `NaN` on pre-existing zones (only zones formed AFTER the reload get real values), so grep the field KEY (`c1o=`), and confirm `getAllStudies()` count stays 1. Fallback when "Update on chart" is unreachable: click `button[title="Add to chart"]` (adds a 2nd instance with the new code), then `tv indicator remove <old-id>` (ids via `getAllStudies()`), verify 1 study emits the new keys — the reliable manual path used to ship the 3-FVG-candle emit on 2026-06-21. |
| 2026-06-29 | Single setup brain — fence `cli/lib/setup-detector.js` as offline/diagnostic only (audit phase 5) | Re-affirms + guards the 2026-06-12 single-brain decision. The walker chain (`buildDeterministicPacketTruthFromInputs`, app/main/bar-close.js) is the ONLY setup producer for live trading + production backtests; the per-bar LLM narrates its verdict. `setup-detector.js` (+ its `-stops`/`-schema` siblings) is permitted ONLY in offline/diagnostic surfaces: manual `/analyze` CLI (`cli/commands/analyze.js` → `bundle.candidates`), `scripts/replay-runner.js`, tests. No live path imports it — verified zero `setup-detector` refs under `app/`. Source-of-truth banners added to the three `setup-detector*.js` files; a regression guard (`tests/single-setup-brain.test.js`) fails if any `app/main/**` file imports the detector family, or if the banner is removed. Doc-and-guard only — **no trading behavior or detector math changed**. The manual `/analyze` slash command gains a note that its candidate is a diagnostic read, not a live signal. |
| 2026-07-03 | Pine checklist panel + visual redesign; same-candle confirmation canonical | PR #198: the on-chart quality panel became a Lanto entry checklist (counted bias components w/ MTF heatmap row, quality, day-anchored grab, near-price PD array w/ hysteresis, confirmation, gated ENTRY banner w/ A+/B/no-trade + 2×1 multi-alignment elevator) + premium chart conventions (split-fill mitigation %, style-anchored labels, SH/WH/SL/WL leg extremes, level merge + origin tracing incl. new PD/PW timestamp tracker, swallowed-zone hiding, candidate ◈ spotlight, BoS ×N, recency fade). All VISUAL-ONLY — the walker chain stays the single setup brain; the panel banner carries the disclaimer. Emit additive-only: `confirm_strict` (prior-bar tap + engulfing close), parser-typed, DORMANT — the strict variant folded NEGATIVE (blocks the hand-verified 06-16 B MSS and the 07-02 live +0.77R winner; same-candle tap-and-close is oracle-canonical, see docs/decisions-log.md 2026-07-03) and must not gate the chain without a fresh full-corpus fold. Fold caveat recorded: the May–June backtest corpus was wiped in the audit-era cleanup (1 run remains); full-year re-record requires the app stopped (record-corpus.log contention failure). Deploy mode for the Pine: user pastes into the "ICT Engine V5" script. |

## 2026-07-10 — Unified goal: two tracks, hard LLM boundary, Hermes plan absorbed

User-confirmed via structured questions. (1) The 2026-07-09 Hermes improvement plan is absorbed as the money-path execution backbone under a new umbrella goal, [docs/intent/2026-07-10-unified-goal.md](intent/2026-07-10-unified-goal.md); the plan itself is committed verbatim at [docs/plans/2026-07-09-app-and-bot-improvement-plan.md](plans/2026-07-09-app-and-bot-improvement-plan.md). (2) The zero-LLM-in-trade-path boundary is reconfirmed as absolute; LLM expansion happens only around the path (review critique, weekly coach, lever-evaluation narration, anomaly explainer, journal vision assist pending a constraint-#5 carve-out decision). (3) Work runs as two parallel tracks: Track 1 money path stays P0 in plan order; Track 2 experience (UI motion/polish + LLM features) ships continuously but may never touch trade-path code. The 2026-07-10 audit backing the goal found: suite red (1893/1899), B1–B4 subsystems confirmed absent, EOD flatten bar-driven and skipping manual trades at the broker, E3b/E3c already implemented (entry-models.md:192-198 stale), E3a still open, SMT leader logic present but uncertified, London unrecorded.

## 2026-07-10 — Goal decision checkpoints ruled (7/7)

Asked one by one, user answered: (1) corpus window approved as defined — gate-corpus-2026-h1-v1, final sign-off still gated on green certification; (2) runner style: derive Lanto's actual runner management from transcripts + Discord PDF first, then side-by-side fold, then rule — no implementation before that; (3) fold queue: Pine #208 levers first (reaction-window rejection, origin-leg anchor), strategy folds after; (4) first live-risk cap: NORMAL size from day one — live matches the backtest evidence exactly; (5) London: NY first — London deprioritized entirely until real money is armed and stable on NY (F2 moves post-arming); (6) journal note assist: FULL VISION carve-out — the LLM may read the auto-journal screenshot for post-close note drafting; shipping PR adds an explicit named exception to constraint #5 scoped to journaling only; (7) catch-up purpose: DELETE the dormant scaffolding. Recorded in [docs/intent/2026-07-10-unified-goal.md](intent/2026-07-10-unified-goal.md).

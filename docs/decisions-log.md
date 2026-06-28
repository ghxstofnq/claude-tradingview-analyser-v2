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
(7W/17L). Suppressing them entirely (carry-only) is best — and matches Lanto
literally: the morning trade carries into the afternoon, no new afternoon hunts.

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

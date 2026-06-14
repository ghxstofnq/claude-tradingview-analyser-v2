# Re-grade: June 8–12 week (2026-06-13)

Re-grading the week under the **current adopted rules** so the frozen baseline
reflects the system as it actually trades now (the old baseline predated three
of these rules):

- From-scratch deterministic brief (no recorded-context reuse)
- TP1 weekly-draw exclusion (#60)
- 4:00 PM ET close + AM→PM carry (#60)
- 15:32 ET late-entry cutoff (#61)
- Break-even scale-in adds (#58)
- **A+ → TP2 with BE at TP1** (user ruling 2026-06-13; B trades still bank at
  TP1). Full position to TP2, stop → entry once TP1 tags. TP2 = packet's TP2,
  fallback to the session HTF draw.
- **Grade-tiered AM cutoff** (user ruling 2026-06-13): in the AM session, B
  setups may only surface until **11:40 ET**; A+ setups may surface until 12:00.
  (Conviction-tiered latitude — same philosophy as A+→TP2: higher grade gets
  more rope in both time and target. PM 15:32 cutoff is a candidate for the
  same treatment later.)
- **3-losses-in-a-row session halt** (user ruling 2026-06-13): stop taking new
  entries for the rest of a session after 3 consecutive losing trades (any win
  resets the streak). Stricter than the existing −3R cumulative halt. **Sound
  rule, but a no-op on this sample**: the one session it would touch (June 11
  AM) has *concurrent* adds — the 3rd booked loss doesn't land until all four
  are already open (trade 2 held ~3 hrs into PM), so the halt fires but can't
  retract an open position. Kept as future protection; 0R effect here. (My
  earlier sim claimed +1R by dropping the 4th trade by entry order — wrong, it
  assumed sequential trades.)
- **Inversion wide-leg stop cap** (user ruling 2026-06-14): when the failed-leg
  extreme is **> 95 MNQ pts** from entry, use the tighter violating-candle stop
  instead (entry-models.md Inversion §5). In volatile regimes the failed leg can
  be enormous (June 11: 131 pts), deflating every target's R so the trade reaches
  past nearer liquidity. 4-week fold sweep: 90-99pt is a flat plateau (+6.13R,
  **zero week-level losses, no winner broken**); <85 falls off a whipsaw cliff
  (80pt loses on May25-29 + Jun1-5 and breaks the Jun 3 winner); 100 leaves +2.1R
  on the table; 95 sits mid-plateau. Re-froze the baseline: June week 25.99 →
  **32.12R** (Jun 9 14.85 / Jun 10 5.74 / **Jun 11 AM −4 → +1.08** / Jun 11 PM
  9.4 / **Jun 12 AM 0 → +1.05**). June 9 + June 11 PM runners untouched (legs
  <95). MNQ-point scale — rarely fires on MES (smaller stops); revisit if MES
  becomes a primary. (Distinct from the rejected full candle-swap below, which
  tightened *every* inversion stop and lost −51R.)

### Rules tested and REJECTED (kept honest for the record)
- *Late-B reward filter (TP1 > 2.0/2.5/2.75/3.0R)* — curve-fit; non-monotonic
  across thresholds, R-multiple doesn't predict late-B outcomes. Used the hard
  11:40 cutoff instead.
- *Stand-aside on unclear-open + marginal/poor quality* — catastrophic (−52R):
  that signature describes most WINNING sessions too (June 9, June 10), so the
  gate blocks the winners. June 11 AM (−4, lost) is ex-ante identical to June 10
  AM (+5.74, won) — the chop is only visible after the fact.
- *Un-latch the scale-in green light* (adds only while price is CURRENTLY past
  the halfway mark, not "was once") — net −13.6R (67.9→54.3), worse every week.
  Fixes June 11 AM (−4→−2 by dropping the bounce adds) but blocks the winning
  adds during NORMAL trend pullbacks — same trap: the reversal looks identical
  to a healthy pullback. The latch earns its keep; kept as-is.
- *Proximity-first TP1 (drop the 2R swing premium → nearest liquidity ≥1.5R)*
  (tested 2026-06-14) — net **−11.56R** across the 4 weeks (65.18→53.62, on
  regenerated current-code payloads): May18-22 +4.41, **May25-29 −11.54**,
  Jun1-5 −1.02, Jun8-12 −3.41. Born from a real finding — the 2R floor makes a
  short reach *past* a nearer London-low draw to a deeper swing (June 11 10:11:
  skipped LO.L 28638.25 @1.95R for 28533 @2.75R). Proximity-first DOES capture
  it (June 11 AM −4→−1.22), but the system's edge is the A+ runners reaching
  deeper targets: pulling TP1/TP2 nearer cuts runners short (June 9 second short
  +7.27→+4.13) and arms break-even early enough to scratch winners (May 29: two
  A+ runners → closed_be 0R). Same trap as the un-latch. The §7-Step-7 "first at
  intraday liquidity" reading sounds more faithful but loses more on the trend
  winners than it saves on the chop losers. The 2R swing premium earns its keep;
  kept as-is. **Shipped alongside** (kept — correctness, baseline-neutral): the
  session-low pool fix — `brief.overnight_block.untaken_{above,below}` now split
  by side of price from the engine's `untaken_{sell_side_below,buy_side_above}`
  lists (was sliced by array position, dropping LO.L / AS.L), so sell-side
  session lows finally reach the TP1 pool; refold-gate stays byte-identical
  because the 2R rule still governs selection.
- *Inversion stop: violating candle instead of failed-leg extreme* (tested
  2026-06-14) — **catastrophic, net −51.48R** across the 4 weeks (65.18→13.70):
  May18-22 −12.3, May25-29 −16.0, Jun1-5 −12.3, Jun8-12 −10.9. The leg-extreme
  stop is wider (June 11 10:11: 131 pts vs the candle's 85.5) and that width is
  LOAD-BEARING — it gives trades room to survive noise so the A+ runners reach
  the deep targets where the edge lives. The tighter candle stop gets whipsawed
  out: June 10 AM 7.49→1.16, June 11 PM +9.4→−3 (the +7.25 runner stopped). It
  HELPED exactly one day — June 11 AM −4→+1.08 (the day we were staring at, the
  LO.L targets finally clear 2R) — and wrecked everything else. Textbook
  single-day overfit; the cross-week fold is what caught it. Failed-leg extreme
  (tier 0) kept as the primary Inversion stop (entry-models.md §6 / June 9
  hand-grade). **Update 2026-06-14:** the *conditional* version — candle stop ONLY
  when the leg is > 95 pts — was ADOPTED (see the wide-leg cap in the adopted list
  above): tightening only the over-extended legs is net-positive (+6.13R, no
  winner broken), whereas tightening *every* inversion stop is the −51R disaster
  here. The distinction is the whole point.
- *Reclaim gate — block new shorts once a recently-swept sell-side draw is
  reclaimed* (price back above the swept level within a recency window) (tested
  2026-06-14 on top of the 95pt cap) — **net flat-to-negative, REJECTED.** The
  engine's single-bar `rejected` sweep flag was false on the LO.L sweep (the
  rejection was a multi-bar reversal), so the gate used raw price-reclaim +
  recency window instead. Window sweep is non-monotonic (10min 71.31 / 15min
  72.31 / 20min 70.64 / 35min 71.20 / 45min 68.05) and — fatally — **no window
  fixes June 11 AM without breaking June 9**: the only window that preserves
  June 9 (15min) doesn't touch June 11 at all (its +1 is coincidental other-week
  trades); every window that blocks a June 11 short also blocks June 9's +1.67
  Trend continuation short. June 11 AM's reversal-reclaim and June 9's
  trend-pullback-reclaim happen at the same age — price alone can't separate
  them (same trap as the stand-aside gate). A structure-flip signal (bullish
  MSS/BOS after the sweep) might, but the evidence here doesn't justify it.

These re-grade rules are **not yet in production code** — these values are the
signed-off targets; the engine changes + gate re-freeze happen in one pass once
the whole week is reviewed.

**4-week effect (out-of-sample, honest):** current +59.1R → A+→TP2 +64.1R →
+ AM cutoff **+67.9R**.

## Sign-offs

| Day | Session | Re-graded result | Status |
|-----|---------|------------------|--------|
| Jun 8 | AM | no-trade (0 walkers spawned, no LTF bias) | ✅ locked + frozen in gate |
| Jun 8 | PM | no-trade | ✅ locked + frozen in gate |
| Jun 9 | AM | **+14.85R** (5 A+ shorts; 09:52 & 10:05 ran to TP2) | ✅ locked (pending code + re-freeze) |
| Jun 9 | PM | no-trade | ✅ locked |
| Jun 10 | AM | **+5.74R** (all B; 11:56 B add cut by AM cutoff) | ✅ locked |
| Jun 10 | PM | no-trade | ✅ locked |
| Jun 11 | AM | **−4R** (4 A+ shorts, all stopped; chop day. Streak halt fires but can't drop the concurrent 4th add) | ✅ locked |
| Jun 11 | PM | **+9.39R** (B anchor +2.15 TP1; A+ add +7.25 runner to 4:00 close) | ✅ locked |
| Jun 11 | day | **+5.39R** | ✅ locked |
| Jun 12 | AM | no-trade (only candidate was 11:52 B long, cut by AM cutoff; was −1R) | ✅ locked |
| Jun 12 | PM | no-trade | ✅ locked |

**Re-graded week total: +25.98R** — Jun 8 (0) · Jun 9 (+14.85) · Jun 10 (+5.74) · Jun 11 (+5.39) · Jun 12 (0).
(Old frozen graded-days baseline was June 9 +10.01 / June 10 +1.35 / June 11 AM −3 = +8.36 for those days.)

### Jun 9 AM detail (+14.85R)

| Time ET | Model | Side | Entry | Stop | TP1 | TP2 | Grade | Outcome | R |
|---------|-------|------|-------|------|-----|-----|-------|---------|---|
| 09:52 | Inversion | short | 29792 | 29847 | 29659.25 | 29566 | A+ | TP2 | +4.11 |
| 10:05 | Inversion | short | 29664 | 29713.75 | 29458.5 | 29302.5 | A+ | TP2 | +7.27 |
| 10:27 | Inversion | short | 29467.25 | 29526 | 29302.5 | 29302.5 | A+ | TP1 (TP2=TP1) | +2.80 |
| 11:05 | Trend | short | 29184 | 29226.5 | 29083.75 | 29083.75 | A+ | stop | −1.00 |
| 11:53 | Trend | short | 28911.75 | 28971.75 | 28811.5 | 28811.5 | A+ | TP1 (TP2=TP1) | +1.67 |

## 2026-06-14 — stale-target discovery: the backtest was folding on malformed targets

Triggered by a TP1-selection challenge (a London low skipped for a far swing).
Root cause turned out bigger: **the backtest folded on the targets baked into
the June-13 tapes/payloads, which carried the OLD malformed `overnight_block`**
(positional slice — wrong-side levels in both the above/below lists, e.g. a
London *high* sitting in a short's *below* target list). The 2026-06-14
session-low fix corrected this for LIVE (buildDetectorInputs reads the fresh
brief) but **never took effect in any fold** — every backtest this session
(including the wide-leg sweep) measured a system that no longer runs.

**Fix:** (1) `backtest-engine.js` now overrides each bar's `untaken_targets`
from the brief context instead of the tape's baked copy (no-op on fresh runs);
(2) `refold-gate.mjs` patches the recorded payloads' `overnight_block` targets
with the current brief's values (targets only — recorded grades/bias kept, so no
unrelated re-grade). **Re-froze the baseline: June week 32.12 → 55.0R**, entirely
**June 9 AM 14.85 → 37.73R** — the stale targets had been capping the big
down-trend shorts at malformed nearer levels; the correct sell-side draws (LO.L
29566 / AS.L 29302.5 / PDL 28821) let them ride the real move to the prior-day
low. **Independently verified** (1m price path, no grader): all four new
deep-draw shorts reached PDL 28821 at 11:35 and none had their stop touched.
Other June days byte-identical; 4-week out-of-sample 71.31 → 94.94R (−2 on
May18-22, rest flat).

**§2.1 grade reflection — RESOLVED 2026-06-14 (gate now folds the full current
brief, not just targets).** The recorded June-13 payloads carried the pre-§2.1
bias read: a fresh, liquidity-taking 4H **bear** FVG above price (30249-30397)
graded **bullish** ("draw above price → bullish"), so the June 11 PM rally-long
graded A+ (aligned) and ran to the 4:00 close (+7.25). §2.1's supply-rejection
rule (strategy §2.1: "trades into a 4H BPR... rejects sharply → bearish") reads
that same zone as 4H **supply → bearish**; the PM rally is then a **retrace
against** the bearish draw → **B** (§2.4: "HTF one way, LTF a short-term retrace"
= conviction trade, not A+). HTF momentum confirms (4H bearish / 1H bearish;
only daily bullish). So **June 11 PM = B, +4.9R** (banks at TP1), not A+ +9.4R —
the user's A+ sign-off rested on the old bullish misread. Folding the full brief
also lifts **June 10 5.74 → 15.32R** (§2.1 reshuffle + deeper draws — verified:
both new shorts reached 28610.25, stops never hit). **Re-froze: June week 55.0 →
60.08R** (Jun8 0 / Jun9 37.73 / Jun10 15.32 / Jun11 1.08 AM + 4.9 PM / Jun12
1.05). The gate now mirrors live end-to-end (§2.1 grades + fixed targets).

**Tapes re-recorded 2026-06-14** — `scripts/refresh-tape-briefs.mjs` re-derives the
stale brief-only fields (`inputs.untaken_targets`, `inputs.session_state`) and
`brief-payloads.json` from the recorded bundle with current code, across all 45
runs. Market/engine data and recorded OHLC are untouched, so the frozen baseline
does not move (verified: gate still +60.08R after the refresh). Re-run it after
any brief-code change. The gate keeps its own regen-from-bundle as a self-healing
guarantee (it never trusts the tape's baked brief), so even an un-refreshed tape
can't silently re-introduce the stale-data bug — the refresh just keeps the raw
files honest for direct readers (debug-fold, the popover replay).

## 2026-06-14 (later) — "avoid bad trades" campaign: reclaim gate re-test, counter-structure, 5m-confirmation

All measured on the CLEAN pool (every session regenerates its brief from the
recorded bundle, self-healing like refold-gate). **Clean 4-week baseline =
100.02R** (May18-22 9.83 / May25-29 17.61 / Jun1-5 12.5 / Jun8-12 60.08).
Harnesses (kept, untracked): `scripts/reclaim-gate-test.mjs`,
`scripts/trade-dump.mjs`, `scripts/five-m-confirm-sim.mjs`.

**1. Reclaim gate re-test (the one item rejected on STALE data).** The original
2026-06-14 rejection used the stale 71.31R baseline; re-run clean:
- *Raw price-reclaim, short-only* — block a short within N min of a swept
  sell-side draw being reclaimed. Saturates at **+4.33R** (60min). BUT it pays a
  −1.67R June 9 tax (clips the 11:53 Trend runner) and its June 11 "help" is on a
  reclaim that had ALREADY structurally failed (every bullish flip `recl=true` by
  11:19) — i.e. June 11's late losers were never reversal-context shorts; they
  lost to chop. The gate is a **continuation-fade**.
- *Two-sided* (add the buy-side mirror to block longs) — **−20R** (100.02 →
  84.28). Kills the June 2 long runners (+2.08/+3.31/+3.67/+4.54) and June 11 PM
  (+4.9 → 0). Proves the mechanism fades runners in whichever direction trends;
  short-only looked clean only because this corpus's clean trends are down days.
- *Structure-confirmed* (block only when a standing bullish MSS/BoS confirms the
  reclaim) — **+2.00R**, fires exactly twice (May 20, two A+ losers), zero
  winners killed, June untouched. Clean and §2.1-faithful but **2 trades of
  evidence** and does nothing for the real losers. **Verdict: not adopted** —
  too thin; the raw gate is rejected (continuation-fade that clips a runner for
  a refuted reason). June 11's losses were never a reclaim problem.

**2. No clean trade-level filter exists.** `trade-dump.mjs` over all 87 trades:
- By grade: A+ +54.34R / B +45.68R — both net positive, nothing to cut.
- By model/side: all positive. Stop/ATR: ~all trades in one bucket (no separation).
- Counter-structure at entry (standing opposite-side flip): n=11 **W4/L7 but net
  +19.86R** — the SAME signal precedes May 20's losers AND May 29's +11.92 / June
  10's +8.64 winners. Blocking it loses money.
- The killer counterexample: **June 10 lost its first two trades then made +18R on
  the next three** — kills every loss-streak / re-entry / stand-aside rule (why
  the halt is at 3, not 2). **The losers are the entry price of the runner days;
  they are ex-ante indistinguishable from the winners.**

**3. 5m-confirmation — faithfully simulated, CATASTROPHIC (−55R).** §5 ("1m/5m
close"). First attempt (env-gate confirmation to 5m boundaries) was confounded by
the Inversion `invertedOnThisBar` stamp (dropped ~80% of setups by inversion-minute
parity) — reverted. Faithful sim (`five-m-confirm-sim.mjs`): the real chain still
identifies setup + zone + structural stop + targets; we BUFFER each confirmed
packet and release it at the next 5m boundary only if the 5m close still holds
beyond the zone, **repriced to that 5m close** (stop/targets are structural and
don't move). Result: **100.02 → 45.22R** (max_wait 1/2/3 all 42-45R). 71% of
entries reprice to a worse fill — e.g. June 9 first short: entry 29792→~29650,
risk 55→197pt, +4.11R→+1.43R. **The post-hoc filter's +3.41R counted an impossible
benefit** (good 1m fill AND fakeout-filter): to filter the fakeout you must wait
for the 5m close → worse fill (−55R); to get the fill you take the 1m limit →
already in before the 5m confirms (100R, eats the fakeout). **The aggressive 1m
entry is correct and load-bearing.** 5m-confirmation closed as strictly worse.

**Net: the system is at the frontier of what's cleanly filterable.** Every lever
either fades the runners (reclaim two-sided, 5m-confirmation) or can't separate
losers from winners (counter-structure, grade, RR, stop, hour). The −1R losers
are the cost of being in the market on runner days. Baseline unchanged at
60.08R June / 100.02R 4-week; no code shipped.

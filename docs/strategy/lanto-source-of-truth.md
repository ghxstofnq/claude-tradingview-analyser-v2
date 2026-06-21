# Lanto Source of Truth — verbatim rules + bot fidelity audit

This is the master reference for the strategy docs. It distills Lanto's five class
transcripts (the creator's own words) into per-topic rules, each tagged with how the
bot currently behaves. The other docs in `docs/strategy/` are written **from** this
file. When the bot and Lanto disagree, this file records the gap; the spec docs
describe Lanto (the target).

**Sources** (vendored in `docs/strategy/transcripts/`):

| Tag | Class | Video |
|---|---|---|
| BIAS | How I Develop Daily Bias (12/12/2025) | `kix1SDRSCiU` |
| ENTRY | How I Enter The Market / Entry Models (2/9/2026) | `MoFNCTq9aXs` |
| TRADE24 | How I Trade The Stock Market 2024 | `TGIUjVBBemo` |
| PRICE | How To Identify Price Action | `nEAGVMAJypE` |
| RISK | Understanding Risk: Prop Firms & Personal Account (10/2/2025) | `sN83BHNBzJo` |

**Verdict legend:** MATCH (faithful) · PARTIAL (partly) · MISSING (not implemented) ·
CONTRADICTS (bot does the opposite) · OVERLAY (bot-specific behavior with no basis in
the transcripts).

> Citations point at the live tree (`app/`, `cli/`, `pine/`) at the time of writing
> (branch off `main` @ `bf85f6f`). `file:line` may drift — verify before relying.

---

## 1. Daily bias (Pillar 1)

### 1.1 The three components + the grade count
> "We now combine all three: higher-time-frame analysis, overnight price, opening
> range move. **One out of three — don't trade.** Two out of three — it's not A+, but
> you can trade. Three out of three — it is A+." (BIAS ~21:29–22:25)

- **The grade is a count of three votes:** HTF analysis · overnight price · NY-open
  reaction. 1/3 = no-trade, 2/3 = B, 3/3 = A+.
- Lanto **trades 2/3 with no HTF read** ("this week nothing's been A+ … we only had
  overnight price and the opening range move … no higher-time-frame look") (BIAS 22:25).

**Verdict: CONTRADICTS.** The bot grades by *alignment*, not a 3-vote count
(`app/main/strategy/walkers/execution-packet.js:445-469` `deriveGrade`): A+ needs
pillars pass + a known model + `htfLtfAlignment === 'aligned'` + side-aligned + clean
displacement. Pillar 1 only passes with an HTF draw present
(`app/main/strategy/context/build-strategy-context.js:41-43`), so a no-HTF day cannot
even reach B — Lanto would trade it. Overnight never enters `deriveGrade`.

### 1.2 HTF analysis (Daily → 4H → 1H)
> "Start from the daily and mark out significant areas of interest — fair value gap,
> inversion fair value gap, sell-side / buy-side liquidity… The gaps have to be
> displacive… and a gap which takes liquidity." (BIAS 00:56–01:52)
> "It's always areas of interest where it's near price… **near price ideally is where
> I look to go for** … a realistic area of interest where price could come in today."
> (BIAS 04:42)

- Mark displacive, liquidity-taking PD arrays on D/4H/1H + buy/sell-side liquidity.
- Prefer the array **nearest current price**.

**Verdict:** HTF selection by displacement + took-liquidity = **MATCH**
(`app/main/direct-session-brief.js:264-297,343-367`). **Near-price = MISSING** —
distance is computed (`cli/lib/compute-engine-gates.js:69-78`) but never ranks the
primary draw (`direct-session-brief.js:268-272`).

### 1.3 Overnight (Asia / London), recency-weighted
> "Asia 6 p.m.–3 a.m. ET, London 3 a.m.–9:30 a.m. ET… If overnight price is bearish,
> ideally momentum is in sync with HTF — that sways my bias even more bearish… If
> overnight is strictly consolidation, I won't have a dedicated bias yet. I like
> utilizing recency bias." (BIAS 12:11–16:50)

**Verdict: CONTRADICTS (as a grade input).** `computeOvernightVerdict`
(`direct-session-brief.js:305-312`) returns extending/retracing/consolidating but is
consumed only by the renderer + memory string; `deriveGrade` has no overnight term.
Overnight contributes only its *levels* as TP targets, never direction to the grade.

### 1.4 NY-open reaction (reject vs invert)
> "Whatever we do off this hourly — **reject or invert** — will dictate my narrative…
> Reject aggressively, trade below this low again → much lower is valid. Invert that
> hourly gap → flip bias." (BIAS 11:14–25:44)
> "It's not the initial liquidity we take — it's **the reaction**." (BIAS 20:33)
> "I start lives at 9:45 because we typically get our opening range move by then…
> first 15–30 minutes." (BIAS 23:21, 27:42)

**Verdict: PARTIAL.** The reject/continuation fork exists
(`cli/lib/open-reaction-resolver.js:106-109`, close-back-through rejection) and the
window is exact — resolve at +15 (09:45), freeze at +30 (10:00)
(`app/main/backtest-engine.js:120-144`). But it keys off **overnight liquidity-level
sweeps**, not "did price close through the HTF gap." The literal "invert the gap →
flip bias" is only an entry-walker trigger (`inversion-lifecycle.js`), not a bias
decision.

### 1.5 Flip-bias / don't reverse off one thing
> "Just because we disrespected this gap doesn't mean we'll disrespect the next and
> seek higher and higher. I need to see **more displacement**, multiple arrays
> invalidated, before I long a reversal — especially with overnight bearish." (BIAS
> 30:39–32:21)

**Verdict: MISSING.** The day's bias flips on a **single** swing-tier MSS /
displacement-BoS (`app/main/live-ltf-resolver.js:115-120`) with no multi-array /
mass-displacement count and no coupling to overnight strength.

### 1.6 SMT / leading asset (ES ↔ NQ)
> "ES is a bit more leading at that point in time… NQ was the weaker asset… as soon as
> ES showcased that sell, that told me price most likely were to drive lower — so I
> flipped on ES and looked to ride NQ." (BIAS 36:32–37:28; also 32:21 ES-vs-NQ at entry)

**Verdict: MISSING.** Leader is chosen by single-symbol displacement **magnitude**
(`cli/lib/compute-leader.js:82-83`); the chosen symbol is then traded in isolation
(`app/main/live-open-reaction-finalizer.js:93`) — ES/NQ disagreement never sets bias.
Real SMT exists only on an unmerged branch.

### 1.7 Sessions & timing
> Asia 18:00–03:00 ET · London 03:00–09:30 ET · New York 09:30–16:00 ET. (BIAS 12:11)
> Asia: "I never trade Asia unless price first shows a good move; if it's slow, don't
> trade." (BIAS 40:23–41:29)

**Verdict: PARTIAL.** The Pine/level layer matches (`pine/ict-engine.pine:24-27`), but
the runnable sessions truncate **London to 03:00–06:00** and split NY into ny-am
(09:30–12:00) + ny-pm (13:00–16:00) with a noon dead-gap
(`app/main/sessions.js:33-35`). **Asia is not a tradable session**
(`build-strategy-context.js:4`); no Asia-specific "wait for the initial move" logic.

---

## 2. Price action quality (Pillar 2)

### 2.1 Displacement is the tell
> "You want engulfing, flush candles, minimal wicks… mass wicks, dojis, consolidation
> = bad price. **You cannot outrade bad price.**" (PRICE 06:52–08:42, 29:17)

**Verdict: MATCH.** Quality row emits `displacement` clean/acceptable/weak (clean-bar =
body/range ≥ 0.5 over 6 bars) + `candle` doji_wick/engulfing/normal
(`pine/ict-engine.pine:794-796`); A+ requires clean/acceptable
(`execution-packet.js:463-467`).

### 2.2 Gap size = inefficiency = draw magnetism
> "A 130-point 4H gap holds a lot more orders than a 20-point gap… a 20-point 4H gap
> doesn't give the market motive to move to that zone." (PRICE 09:37–11:30)

**Verdict: PARTIAL.** Size ranks zones (tiny/normal/large, ATR-relative,
`pine/ict-engine.pine:345-348`) but does **not** gate target validity — a tiny gap can
still be a TP/draw (`execution-packet.js:332-432`).

### 2.3 Stand aside on tight consolidation
> "28-point range in three hours… that is unacceptable." (PRICE 29:17–30:12)

**Verdict: MISSING.** `range_quality` good/tight is emitted but only soft-caps a
retrace day to B; no hard stand-aside on tight ranges.

---

## 3. Entry models (Pillar 3)

### 3.1 Three models, mechanics
> MSS (reversal: grab → directional shift → retrace FVG → 1m confirm), Trend
> (continuation after MSS, tap the FVG → confirm — a tap is enough, no full fill),
> Inversion (price closes through an opposing FVG → iFVG → go). (ENTRY 07:30–22:24;
> TRADE24 01:00–23:57)

**Verdict: MATCH** (`app/main/strategy/walkers/{mss,trend,inversion}-lifecycle.js`).

### 3.2 Best-gap selection
> "Two components: **displacement** (large body, minimal wick) and a gap that **takes
> liquidity while forming** (sweeps an internal high/low as it prints)." (ENTRY
> 05:38–07:30)

**Verdict: MATCH.** `rankFvgs` = fresh → took_liq → size → disp_score
(`cli/lib/brief-digest.js:28-36`); `took_liq` latches when displacement broke the prior
internal swing (`pine/ict-engine.pine:393-398`).

### 3.3 MSS needs significant liquidity + matching reversal
> "Always look at the type of sell sequence into the low… a significant low, then price
> shows complete reversal at a speed that engulfs / matches the down-move. I never play
> an MSS off a 1m equal-low." (BIAS 28:47–31:34)

**Verdict: MISSING.** MSS spawns on **any** rejected sweep + a post-sweep failure-swing
(`mss-lifecycle.js:38-61,121-160`); no significance gate on the grab, no
down-move-vs-reversal speed compare beyond the binary clean/acceptable flag.

### 3.4 Confirmation = 1m candle close
> "Confirmation is one-minute confirmation on every gap… a strong, deliberate candle
> close, sharp displacement, not a wick / sloppy delivery." (ENTRY 04:43; TRADE24
> 09:02–10:03)
> "If a 1m entry fights longer than 10–15 minutes, that's not an entry you should
> take." (PRICE 25:34)

**Verdict: MATCH** for the close + chop guard
(`lifecycle-utils.js:60-67`: `confirm_close && ce_held && !chop_15m`) and the 15-min
fight-timeout (`deterministic-strategy.js:8-36`). **PARTIAL** on the candle-body
discipline: only the Trend wick-tap path enforces body ≥ 0.6
(`trend-lifecycle.js:80-81`); the main path trusts engine flags.

### 3.5 Multi-alignment advanced entry
> "A 5-minute bullish FVG rebalance paired with a 1-minute bearish FVG go-invert in one
> — two imbalances making one move. That's why today's trade was A+." (ENTRY
> 25:13–27:05)

**Verdict: MISSING.** No code joins a 5m FVG + 1m iFVG into one stronger entry.

### 3.6 1m vs 5m preference
> "If I had to pick, the 5-minute — less noise; a clear 5m gap isn't even debatable."
> (ENTRY 32:21–33:23)

**Verdict: PARTIAL.** Entries hunt on 1m; 5m is used for structure, not as the gap TF
of preference.

### 3.7 Stops (model-specific, structural)
> "Stop at the invalidation point — slightly under the FVG, or under the relative
> low/swing." (TRADE24 09:02–10:03; entry-models stop rules)

**Verdict: MATCH (live path).** Inversion: failed-leg extreme → violating candle →
swing → edge. Trend: FVG-creating candle → pullback swing → tap → edge. MSS: pivot →
swing-beyond-zone → edge (`execution-packet.js:145-330`).

---

## 4. Risk, sizing, management

### 4.1 Day-of-week sizing
> "Mondays and Fridays half risk ($250); Tuesday/Wednesday/Thursday full risk ($500)."
> (RISK 00:56–01:54)

**Verdict: MATCH (exact).** `cli/lib/sizing.js` — Mon/Fri A+=0.5R, Tue–Thu A+=1.0R, all
B=0.5R.

### 4.2 TP1 ≈ 1–1.5R, ultimate ≈ 2R+
> "Typical target one ~1–1.5R; ultimate target ~2R+." (RISK 01:54–02:50)

**Verdict: PARTIAL.** TP1 = nearest unswept swing ≥2R else session level ≥1.5R, with a
**hard 1.5R floor** (`tp1_below_1_5r` blocks) — the high end of Lanto's 1–1.5R
(`execution-packet.js:355-388,530`). Ultimate = HTF draw (TP2/runner) = MATCH.

### 4.3 Management styles
> "Trader 1: trim 50% at TP1, stop to BE, ride to the ultimate target. Trader 2: 100%
> trim at TP1, size to the R. **Me: no trim — I play with the trail, hold through
> targets, exit on a structure change.**" (RISK 02:50–14:55)

**Verdict: MATCH (his personal style).** Bot codes only the no-trim ride: A+ runs to
TP2, B banks 100% at TP1, stop→BE on TP1 (`cli/lib/trade-outcomes.js:17-22,94-128`).
The trim variants are not coded (intentional — they're the prop-firm styles, not his
cash-account style).

### 4.4 Stops
> "Stop at the invalidation point slightly under the FVG, or through the relative low."
> (TRADE24 09:02–10:03)

**Verdict: MATCH.** See 3.7.

---

## 5. Bot-specific overlays (no basis in the transcripts)

The live packet builder adds empirically-tuned gates from the bot's own fold campaigns.
None trace to a transcript; some push **away** from pure Lanto.

| Overlay | Behavior | Tension | Evidence |
|---|---|---|---|
| Exhaustion cap | A+ + clean displacement + entry ≥ 11:00 ET → B | Lanto prizes clean displacement | `execution-packet.js:547-560` |
| 15:32 ET entry cutoff | No new entry after 15:32 | none stated | `:63-69,545` |
| 11:40 ET AM B-cutoff | B in ny-am blocked after 11:40 | none stated | `:70-74,566-569` |
| 1.5R TP1 floor | Blocks TP1 < 1.5R | Lanto takes 1–1.5R | `:530` |
| 95-pt wide-leg stop cap | Inversion leg stop > 95pt → violating candle | bot-tuned | `:287-301` |
| Env levers | `GOFNQ_HTF_STRUCT_ALIGN`, `GOFNQ_P2_DISP_HTF`, `GOFNQ_P3_TREND_STOP` | refinements, default-on | `:159,463-464,184` |

---

## 6. Divergences ranked (candidate levers)

1. **Grade model** — no-HTF-draw = no-trade vs Lanto's tradable 2/3 B; overnight inert.
2. **SMT / leading asset (ES↔NQ)** — absent on `main`.
3. **MSS significance gate** — any rejected sweep qualifies.
4. **Near-price draw selection** — distance computed, never ranked.
5. **Gap-size → draw/target magnetism** — ranks but doesn't gate target validity.
6. **Hard consolidation stand-aside** — soft-cap only.
7. **Multi-alignment 5m+1m entry** — net-new model.
8. **Anti-bias-flip discipline** — single MSS flips the day.
9. **Re-examine the bot-specific overlays (§5)** — some contradict Lanto.

**Strong fidelity (no action):** three models + mechanics, 1m confirmation + chop guard
+ 15-min fight-timeout, took_liq + displacement ranking, model-specific structural
stops, side-vs-bias gate, sizing table, runner/trail + stop-to-BE, ultimate = HTF draw,
open-reaction window timing, ny-pm reads NYAM levels.

---

*Method: each lever is folded old-vs-new on the full-year MNQ corpus in a worktree
before anything ships; the user approves each. One lever at a time.*

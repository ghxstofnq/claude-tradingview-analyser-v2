# Lanto Oracle — the fidelity test

**Phase 0 of the faithful rebuild.** This is the measurable definition of "correct": the
hand-grade rubric + Lanto's own worked examples. The rebuilt system is judged by
reproducing these — never by R on the old corpus. Spec: [README.md](README.md). Plan:
[../plans/2026-06-21-faithful-lanto-rebuild.md](../plans/2026-06-21-faithful-lanto-rebuild.md).

Sources tagged as in [lanto-source-of-truth.md](lanto-source-of-truth.md): BIAS · ENTRY ·
TRADE24 · PRICE · RISK.

---

## Part A — Hand-grade rubric

Grade a session by walking these in order. The **day grade is a count of the three bias
components**; Pillars 2–3 are gating filters on top.

**Pillar 1 — bias (the three votes):**
- [ ] **HTF**: a displacive, liquidity-taking PD array near price on D/4H/1H; direction
  set by the *reaction* off it. Vote = bullish / bearish / none.
- [ ] **Overnight**: Asia (18:00–03:00) / London (03:00–09:30) direction + untaken
  liquidity. Vote = bullish / bearish / chop(=no vote).
- [ ] **NY-open reaction**: at the key level/gap, **reject** (tap + close back through →
  continuation) or **invert** (close through → flip). Extension vs retrace. Vote.
- **Draw-bias pillar = votes aligned:** 1/3 → no-trade · 2/3 → tradable, capped at B · 3/3
  → fully-confirmed bias (2/3 trades with no HTF read).
- **Overall grade (alignment + conviction, NOT a hard 3/3 cap — see daily-bias.md §1):**
  - **A+** = the three pillars **align (no conflict) with high conviction**, via *either* a
    3/3 bias *or* a **multi-alignment entry** (Lanto's *"two-and-one"* — two imbalances confirming one
    move, ENTRY 27:05/31:25) on an otherwise-aligned, good-price day. (2026-02-09: 2/3 bias + A+
    multi-alignment entry → A+.) A **single** clean/displaced entry does **NOT** elevate.
  - **B** = aligned but **one element marginal** — a **single/ordinary entry (even clean) at 2/3**, or
    a sloppy entry *even at 3/3*.
  - **No-trade** = a real **conflict** among bias inputs (open-reaction **reverses** the bias →
    **hands off**), a missing/weak pillar, or no clean entry.
  - A **neutral** input (chop overnight / no HTF) is a non-vote, not a conflict. The entry only
    **elevates an already-aligned day**; multi-alignment in a conflicted/choppy tape is still no-trade/B.

**Pillar 2 — price quality (filter — *"you can never outrade bad price"*, PRICE 27:25; it gates the
other two: bad price into confirmation ⇒ the entry model and the draw are unreliable too):**
- [ ] Displacement present; engulfing/flush, not mass wicks/dojis. *Speed* is the tell (PRICE 28:21,
  TRADE24 15:59 — the best entries go in-the-money instantly / near-zero drawdown).
- [ ] Gap size is a real magnet (not a ~20pt 4H gap).
- [ ] Not tight consolidation (the "28pt/3h = stand aside" test — verbatim, PRICE 30:12, on NQ).

**Pillar 3 — entry + confirmation (filter):**
- [ ] Model identified: Reversal (MSS) or Continuation (Trend), entered via FVG-retrace or
  inversion (or multi-alignment).
- [ ] Best gap: displacement + took liquidity while forming.
- [ ] MSS only: significant swept liquidity + reversal speed matches/exceeds the down-move.
- [ ] Confirmation = 1m candle close, deliberate/engulfing, not a tap alone, doesn't fight
  >10–15 min.

**Risk/management (filter):**
- [ ] Stop structural — just beyond the **entry array** (FVG edge / inversion level), tight, **NOT**
  automatically above the whole session swing. ⚠️ A tight stop only works on **clean/displacing** price —
  **a tight stop in chop gets wicked out** (PRICE 26:29: that trade lost because the stop was tight
  relative to how consolidative price was). So the tight stop pairs with the Pillar-2 clean-price filter
  (don't take the entry if price is consolidative). TP1 ≈ his stated 1–1.5R; ultimate ≈ 2R+ HTF draw.
  Mgmt = trail / BE.

---

## Part B — Worked examples (qualitative oracle)

The discriminator column is the one thing that makes it good vs bad — that's what the
rebuilt logic must get right.

### MSS (reversal)
| # | Source | Setup | Lanto's call | Discriminator |
|---|---|---|---|---|
| M1 good | TRADE24 ~06:00 | 30m FVG, prior Fri; swept liquidity, shift off the 5, retrace, **candle close over** | Long, confirmed | Liquidity grab + speed change + deliberate close |
| M2 good | ENTRY ~12:47 | PDL swept; displacement back up **matching** the down-move; 5m FVG tap + confirm | Long | Reversal speed matches the sell leg |
| M3 bad | TRADE24 ~08:02 | 2nd low off an FVG, no sweep, sloppy delivery through the gap | No trade | No significant grab; no deliberate confirmation |
| M4 bad | ENTRY ~15:53 | gap tapped, no major liquidity taken, weak flip | No trade | No significant liquidity + no confirmation |

### Trend (continuation)
| # | Source | Setup | Lanto's call | Discriminator |
|---|---|---|---|---|
| T1 good | TRADE24 ~14:59 | post-MSS uptrend; retrace to 5m FVG **CE**, candle close over | Long | Established trend + decisive close, zero drawdown |
| T2 good | ENTRY ~14:04 | strong trend, **tap** of 5m FVG (no full fill), confirm | Long | A tap suffices when price is strongly trending |
| T3 bad | TRADE24 ~16:59 | retrace into 1m FVG, **never** a confirming close | No trade | No displacement/close back up |

### Inversion (failed opposing PD array)
| # | Source | Setup | Lanto's call | Discriminator |
|---|---|---|---|---|
| I1 good | TRADE24 ~20:57 | overnight low grab (London/Asia), speed, **close over** a bearish FVG → iFVG | Long | Grab + fluid speed + close through |
| I2 good | ENTRY ~20:34 | London low + 4H FVG tap, displacement up, **go invert** off 5m array | Long | Displacement before the inversion |
| I3 bad | TRADE24 ~22:57 | first inversion off a short-term low, no mass liquidity, no fluid conviction | No trade | No real grab; sluggish delivery |

### Multi-alignment (advanced A+) — the cleanest dated case
| # | Source | Setup | Lanto's call | Discriminator |
|---|---|---|---|---|
| X1 | ENTRY ~25:13 (**2026-02-09**, dated class example) | **5m bullish FVG rebalance** + **1m bearish FVG go bullish-invert**, in one | A+ long | Two imbalances confirming one move |

### Bias / price-quality (whole-session reads)
| # | Source | Setup | Lanto's call | Discriminator |
|---|---|---|---|---|
| B1 | BIAS (**2026-12-12**... see note) | overnight bearish (London sold off); NY swept London lows then **displaced down 9:40** | Bearish, **2/3 = B** (no strong HTF) | Overnight + open-reaction agree; HTF absent |
| B2 | BIAS ~26:46 | took London lows then bounced, but **no major displacement** up | Did NOT flip long | Reversal needs mass displacement vs strong overnight |
| B3 | BIAS ~36:32 | NQ weaker than ES; ES showed the sell first | Flipped on **ES**, rode NQ | SMT / leading asset |
| P1 good | PRICE ~19:00 | 1m FVG retest, **engulfing** confirmation | Long, ran fast | Engulfing close → immediate follow-through |
| P2 bad | PRICE ~24:37 | PPI 1m gap, consolidation, **fought >15 min** | Should not have taken | Tight/choppy delivery, fight-timeout |
| R1 | RISK (**2025-10-02**) | bullish HTF; long off hourly gap + 4H FVG + overnight lows; later **hourly inverts** → short | Long then flip short | Confluence stack; flip on gap inversion |

> Note on dates: transcript timestamps are class times; dated examples identify the trading
> day separately. Verify each against the chart when reconstructing.

---

## Part C — Candidate golden sessions (for quantitative hand-grading)

Sessions we can reconstruct on the chart and grade end-to-end. **Next concrete step** —
needs real chart data (TV Desktop CDP 9225 / replay):

1. **2026-02-09 NY** (X1) — multi-alignment A+ long. Best first case; Lanto gives the exact
   structure.
2. **2026-06-09 NY-AM** — already a repo tape (`tests/tapes/2026-06-09-ny-am-replay.tape.json`),
   GXNQ hand-graded (Inversion short). Re-use as a known fidelity case.
3. **2025-12-12** (B1) — bearish 2/3 B day; tests the grade count + open-reaction read.
4. **2025-10-02** (R1) — long-then-flip; tests confluence + bias flip on inversion.

For each: write Lanto's expected bias / grade / model / side / entry / stop / target, then
check the rebuilt chain reproduces it.

---

## Part D — Per-session oracle entries (the gate)

The verdict each reconstructed session must reproduce. **Status** says how grounded each
field is: `documented` = Lanto's own stated call (authoritative); `hand-grade` = applied
the Part-A rubric, **needs your sign-off**; `reconstruct` = exact entry/stop/TP pin to the
real FVG/level on the chart (the grade/model/side don't change, only the ticks). Entry /
stop / TP are written as the **level or FVG** (pass bar = same array element ±~2–3 MNQ pts),
not a fabricated tick.

### D1 · 2026-02-09 NY-AM — A+ long (multi-alignment)  ·  status: graded (replay + transcript-confirmed)
- **Grade A+ — and WHY (Lanto's own words, ENTRY 27:05):** the A+ comes from the **entry model**,
  not a 3/3 bias: *"this entry model with today's trade was [an] A plus because we ended up
  utilizing a five-minute gap rebalance… and also an inversion fair value gap entry… in one"* —
  **two imbalances confirming one long.** He calls bias + price the *"two other main component
  factors."* (31:25: *"perfect… textbook… two and one."*) This is the case that set our
  **alignment+conviction** grade model — a **multi-alignment** entry (this two-and-one) elevates an
  aligned 2/3 day to A+; a single clean entry does not.
- **Bias (replay): ~2/3 bullish, elevated by the entry.** HTF **bullish via arrays** (h1 **fresh**
  bull FVG at price + h4 bull FVG at price — tiny/marginal, tl-light; daily near-price arrays
  invalidated, so the old "daily bear MSS reclaimed + 1H bull MSS" *structure* language is dropped —
  re-derived 2026-06-22); NY-open bullish (rallied 25553 → 25864, bull MSS 09:50, **swing-tier** bull
  BoS 11:30 at 25855); overnight **chop** (net −92 = non-vote). The HTF vote is **marginal** (tiny
  fresh array) — consistent with Lanto's "A+ from the ENTRY, not a 3/3 bias." Price-action good
  (sustained +310 trend).
- **Model / side:** multi-alignment long (5m bullish FVG rebalance + 1m bearish→bullish iFVG, in one).
- **Entry (1m-pinned): ~25630–25635** — the 1m bullish-inversion close on the reclaim (~09:54–09:56)
  inside the 5m bull FVG, after the **swing-tier bull MSS 09:47** (25665) and the **5m FVG CE-tap** at
  the **25611** pullback (09:53). The two imbalances in one: 5m bull FVG rebalance + the 1m bearish FVGs
  (≈25610–25631) inverting bullish on the reclaim. **Structural stop anchor ~25605** (below the 25611 reclaim/inversion
  low; structural alt ~25575 below the 25581 dip). Executable broker stop **25604.50** after
  the universal two-tick buffer → packet risk ≈ **27.5 pts**.
- **Draws (untaken buy-side above):** Lanto's target cluster is **NYAM.H ~25707 / LO.H 25723 (~2.6–3.0R)**;
  the deterministic no-lookahead packet uses the closed-bar packet-time **NYAM.H 25696.75** because `25707`
  is not present in the 09:54–09:56 evidence window. **TP2 = AS.H 25855.25 (~7.3R — HIT**, price ran
  to 25864); ultimate **PWH 26536**. **BE → entry (25630) at TP1.**
- **Discriminator the chain must get right:** two imbalances confirming the *same* move → A+ even at
  2/3 bias; a single ordinary FVG entry on the same day would be a B.

### D2 · 2026-06-09 NY-AM — B Inversion short  ·  status: graded (Option A evidence-backed replay packet)
- **Setup:** overnight rallied (+301) and NY **swept the highs** (AS.H/NYAM.H/PDH) at the 30136
  spike → reversed **down off the HTF bear draw** (fresh bear daily FVG *at price* + 4H/1H bear
  FVGs) → **swing-tier bear MSS 10:45** (29595, dp 152) → sold off to 29154. Bias bearish; the
  bullish overnight was the **liquidity grab** that set up the reversal (not a conflict).
- **Model / side:** **Inversion short** — the bullish FVGs **29743–29776** violated to bearish
  (inverted) on the retrace into the bear FVGs; the 1m violation close confirms.
- **Entry: 29760** — the first evidence-backed 1m inversion confirmation close after stale 10:00 ET
  low-coherence inversions are suppressed. **Structural stop anchor: 29818.75** (failed-leg extreme from the visible 1m
  bars at packet time). Executable broker stop **29819.25** after the universal two-tick
  buffer. **1R = 59.25 pts.**
- **Draws (untaken sell-side below):** **TP1 = AS.L 29595.25 (~2.78R on the buffered stop)** — nearest sell-side draw;
  **TP2 = PDL 29113.75 (11.00R)** then **PWL 29071.25 (11.73R)** — the ultimate HTF draw (price hit
  29154 ≈ PDL). **BE → entry (29760) when TP1 fills**.
- **Grade B — aligned bearish inversion, but no verified two-and-one.** The tape supports the
  significant buy-side grab, bearish reversal delivery, and draw hit. It does **not** support the prior
  A+ claim: no same-direction took-liq 5m FVG overlaps the 1m entry zone, so the multi-alignment
  elevator does not fire.
- **Corrections to GXNQ's label:** logged TP1 **29302** maps to no level/pool (dropped); logged
  **TP2 "28779 PWL"** is wrong — actual **PWL is 29071.25**; logged `29731.25` is a later 1m bar open
  with no production-general entry anchor; logged `29851.50` is an h1 FVG candle-open, not the 1m
  inversion invalidation anchor. Option A demotes the row to the evidence-backed B packet above.

### D3 · 2025-12-12 NY-AM — 2/3-B bearish day (the documented B1)  ·  status: transcript-grounded bias; exact trade levels retired pending re-derive — engine HTF over-read flagged
- **Lanto's own words (BIAS class, THIS day):** *"we didn't end up using higher time frame today…
  there wasn't anything massive… we ended up utilizing overnight price **two out of the three
  components** — overnight price and the opening range move"* (25:44/27:42); *"the whole week we
  didn't have a clear ultra HTF look"* (21:29). So **2/3-B, no HTF.** This IS B1 (not a different date).
- **Bias:** overnight **bearish** (Asia consolidated, London sold off); NY-open **bearish** — swept
  the London lows then **displaced down on the 9:40 5m sequence**, confirming downside. HTF **not
  used** (no clean near-price array). 2/3 → **B**.
- **No reversal long:** Lanto passed the long when the London lows were swept + price bounced —
  *"we didn't see major displacement… overnight was bearish"* (26:46). A sweep without mass
  displacement is not a reversal.
- **Trade expectation:** retired until re-derived. Older versions of this oracle pinned exact
  instrument/entry/SL/TP from ambiguous callout-derived material; those levels must not be used as
  authority. Keep only the transcript-backed bias/grade facts above until the trade vehicle and price
  levels are reconstructed from chart evidence and explicitly user-approved.
- **Working lessons that remain valid from the transcripts/spec:** (1) the traded vehicle must be
  confirmed per session, not assumed; (2) stops anchor structurally to the entry array / invalidation
  level, not by a generic swing-high rule; (3) compare stop tightness on the same instrument or normalized
  by risk/price, never by raw points across index products.
- **ENGINE HTF OVER-READ (key fidelity finding):** my engine read graded this **3/3** (daily bear
  MSS **dp 837** + 4H/1H bear MSS = "strong HTF bearish"), but Lanto says **2/3 / no HTF**. The daily
  break (level 25168) is **~1150 pts BELOW** the open (26317) — a stale/distant/reclaimed structure,
  not a near-price actionable draw. **Tweak (corrected):** Lanto's HTF primitives are **only PD
  arrays (FVG/iFVG) + buy/sell liquidity** (BIAS 02:48), and the bias is the **reaction (reject /
  invert) off the near-price displacive took-liq array** (BIAS 11:14). **Structure (MSS/BoS) does
  NOT vote on HTF bias** — it's the entry model + open-reaction read. (My `is_reclaimed` idea patched
  the wrong primitive.) Open question: calibrating the "clean/significant-enough array" threshold —
  Lanto's *"massive"* vs *"nothing crazy"*. Stage-C build item. See [[engine-htf-overread]].

### D4 · 2025-10-02 (R1) NY-AM — B long that FAILED → flip short, on **MNQ**  ·  status: graded (replay schema-4 + transcript-confirmed; instrument **MNQ confirmed** 2026-06-23 — ES was the SMT *leader* drawing lower, NQ the vehicle. Exact entry/SL/TP **not shown in the video** → engine reconstruction retained.)
- **Lanto's own words (RISK class, THIS day, 25:11–31:34):** *"coming into New York open I [was]
  bullish higher time frame… overnight we had massive buy sequence creating a new all-time high…
  I remain bullish"* (25:11); the draw was *"this hourly gap… an hourly internal low… that small
  4-hour FVG fill… overnight low / London lows sitting right here"* (26:07); the long *"jabbed out…
  the only reason you see invalidation is because ES had interest in drawing lower"* (26:59/31:34);
  *"price never showcased that true interest and pivot… you want engulfing displacement… never an
  MSS off a 1m/5m low, especially with the type of open we had — really bearish"* (28:47–30:39);
  then *"price traded below this hourly disrespecting it… inverting this gap, you see me shift
  narrative and go short… price kind of slowed down after that"* (27:00).
- **Bias: 2/3 bullish** (arrays+reaction read) — HTF bull (fresh bull h1 FVG 25881.75–25901, dist
  21.75, took-liq, + the confluence FVGs, all `size:tiny`) + overnight bull (+155.5 to a new ATH);
  NY-open reaction did **NOT** confirm (the bounce off the confluence failed). 2/3 → capped **B**.
- **Confluence draw (~25786–25811):** h1 bull FVG 25785.75–25804.25 + h4 bull FVG 25794.75–25801 +
  London low LO.L 25811.5 + swept PDH 25794.75 / PWH 25785.
- **Setup A — LONG (the primary trade, B, FAILED):** entry ~25805 (reclaim above the h1 gap after
  the 09:50 tap of 25786.75), **stop ~25780** (below the 09:50 low / swept overnight lows; 1R = 25 pts).
  **TP1 AS.H 25834.5 (1.18R) — FILLED** (bounce ran to 25846 @10:40); **TP2 LO.H 25937.75 (5.31R) —
  MISSED**; runner **jabbed out at BE**. Marginal entry — tiny gaps + non-engulfing reversal off a low
  after a bearish open (the MSS-quality gate Lanto warns against).
- **Setup B — FLIP SHORT (reactive scalp):** hourly gap **inverts** (close 25780.5 @10:55) → bear BoS
  25772 @11:05 → **short ~25780**, stop above the 25846 swing high (~25850 — structural R poor, TP1 only
  0.3R) or tight above the inverted gap 25804.25 (24 pts). **TP1 AS.L 25758.75 — tagged** (low 25753.5)
  then **slowed/chopped**; TP2 NYAM.L 25483.75 not reached in window.
- **Setup C — bearish-FVG SHORT (found 2026-06-22; the divergent-structure winner Lanto's bias skipped):**
  the open's bear MSS leg (bear MSS 09:35 internal → swing 09:50 @25801) left a **fresh bearish FVG
  25839.5–25871 (CE 25855, took-liq)** that stayed live ~65 min; price **retraced into its lower edge
  (25839–25846, 10:25–10:40) and rejected** (10:45 bearish close 25822). **Short ~25830, stop ~25873**
  (above FVG top), **TP1 AS.L/NYAM.L ~25755 ≈ 1.7R — hit** (low 25753.5 @11:05). Mechanically a clean
  MSS-leg-FVG-retrace short that **WORKED** — but it is **counter to Lanto's HTF-bull bias**, so by his
  own bias rule he passes it (he was long, and lost). This is the divergent-day lesson made concrete:
  the intraday structure offered the winner the bias said skip. Same "carry the MSS-leg FVG forward"
  entry as 06-16; I missed it on the first D4 pass [[lanto-entry-on-prior-leg-fvg]].
- **KEY ORACLE VALUE — the SMT + displacement teaching case:** a textbook confluence long that Lanto
  was *"really convinced in"* still **lost**, for the two gates the engine can't yet see: (1) **SMT** —
  ES (the leader) drew lower and dragged NQ out; (2) **MSS displacement quality** — the reversal off
  the pivot was not engulfing. Both are Stage B–F build items (§6 SMT, displacement-speed gate). Grade
  going in was **B** (2/3, marginal entry); outcome a **loss → modest flip**.
- **Calibration note (open threshold):** all the HTF arrays were `size:tiny`, yet Lanto still read
  himself *"bullish higher time frame"* — so a tiny-but-fresh, took-liq, near-price array DOES carry an
  HTF vote when overnight reinforces it. Data point for the *"massive" vs "nothing crazy"* threshold
  ([[engine-htf-overread]]).
- **Discriminator:** the chain must (a) read HTF bull from the arrays + the confluence, grade **B** (not
  A+: open-reaction unconfirmed + tiny gaps), and (b) flip short on the gap inversion — while the SMT +
  displacement gates explain WHY the long was not an A+ winner.

---

## Part E — Fresh out-of-sample sessions (to capture + hand-grade)

The documented cases above are pre-cutoff (truth = Lanto's stated call). To prove the chain
on data it has **not** seen, grade **post-cutoff** sessions by applying the Part-A rubric
**without recalling outcomes** (constraint #10); your approval is the independence check.
Capture each via TV Desktop replay on the deployed schema-4 engine. Target coverage:

| Slot | Model to exercise | What it tests |
|---|---|---|
| E1 | **Reversal (MSS)** | significant sweep + reversal-speed-match gate (D3 of the build) |
| E2 | **Continuation (Trend)** | retrace-to-FVG/CE in an established trend |
| E3 | **No-trade / chop** | price-quality filter (the "28pt/3h = stand aside" test) |
| E4 | **2/3 → B** | the grade count caps at B with one missing vote |

Capture step (per session): `replay_start` at the date → step into the session → record the
multi-TF schema-4 evidence (D/4H/1H/30m/15m/5m/1m) → hand-grade → fill the D-style entry.
**Grade the FULL move** — extend the window past the open chop until structure resolves, and
read the full `structures[]` event list (not just `most_recent_structure`). See the 06-16
lesson below.

### Graded OOS sessions

**E? · 2026-06-16 NY-AM — B short (Reversal, bias-ALIGNED bearish)  ·  status: graded (user-confirmed; HTF re-derived + 1m entry pinned + grade corrected 2026-06-22)**
- **HTF: bearish via the near-price BEARISH FVG ARRAY** (NOT long — the old "daily dp 548 → long" was
  a structure over-read). The vote is the **fresh bearish FVG 30883.75–30894.25** (from the 08:24 swing
  MSS leg) sitting just above price → bearish lean (price expected to reject it). **Liquidity is the
  DRAW, NOT a vote** — marking buy/sell side ≠ a bias (BIAS 09:21: *"we haven't even had a bias yet"*);
  the draw is **down** (highs AS.H 30869 / NYAM.H 30887 swept, sell-side AS.L 30755 / LO.L 30783 / NYAM.L
  30561 untaken below), but that is the target, not the third vote. The daily/4H arrays were failed
  (daily bull FVG inverted w/o displacement ds 0.06; 4H all invalidated). Overnight: **chop** (−21 =
  neutral, no opposing anchor → freer to follow the reaction, BIAS 27:42). **Bias 2/3 at best** (bear
  FVG array + open-reaction; overnight chop) — **arguably 1/3** if that intraday FVG isn't "significant"
  enough to count as the HTF vote (BIAS 27:42 *"nothing massive"*).
- **Model / side: Reversal — swing-tier bear MSS** (level 30793.5, displacement+sweep). **Short,
  bias-ALIGNED** (bearish FVG + the open-reaction reversal toward the sell-side draw). A genuine
  **reversal**, not a retrace — significant grab (AS.H/NYAM.H) + **mass displacement** (swing-tier
  MSS): Lanto's exact test (BIAS 28:38, RISK 29:43).
- **Grade B (corrected from a wrong "A" 2026-06-22).** The entry is clean and high-R, but it is a
  **single** MSS-retrace — and a single clean entry **does NOT elevate to A+**. Lanto reserves the
  elevation for **multi-alignment** (*"two-and-one"*, two imbalances in one — ENTRY 27:05/31:25); a
  strongly-displaced single entry is only the bar to *trade* it (B), per daily-bias §1. With a 2/3-at-
  best bias + a single entry → **B**. (My earlier "A" conflated clean+high-R with A+-worthy, and leaned
  on a non-existent "liquidity-draw vote" for the 2/3.)
- **The move:** high **30869.75 @ 09:55** → broke down **10:20** → bottomed at **NYAM.L 30561.75 @10:59**;
  **AS.L 30755 + LO.L 30783 swept** en route (lower draws taken).
- **Entry / stop / TP (1m-pinned 2026-06-22): MSS-leg FVG retrace.** The **08:24 swing bear MSS** leg
  left a **fresh bearish FVG 30883.75–30894.25 (CE 30889)** that stayed live ~90 min; at **09:55 the
  high tapped CE 30889 exactly** (also sweeping AS.H/NYAM.H), and the **09:56 candle closed bearish with
  a ~1pt upper wick** (O 30883 → C 30864) = the confirmation. **Entry 30864.25**, **stop 30905.00**
  (user-corrected 2026-06-30: stop belongs on the first FVG candle, not the tighter 30896 CE/FVG-high proxy;
  never threatened — max bounce 30867). **TP1 30750.75 (~2.79R; user-corrected 2026-07-01 to the anchor, hit at 10:20 ET);
  TP2/runner NYAM.L 30561.75 (~7.42R) — reached.** (NYAM.L = 30561.75 on the 1m engine, not the ~30601
  in the earlier 5m note.)
- **Discriminator:** a near-price-bearish-FVG + open-reaction-reversal day is **bias-aligned** (NOT
  "counter-HTF divergent" — that was the structure over-read), and grades **B** — a single clean entry
  does not make A+ (only multi-alignment does). The chain must (a) take the HTF vote from a **significant
  near-price array**, not from the liquidity map (liquidity = the draw/target), (b) require **mass
  displacement** to call the reversal real, (c) **carry the MSS-leg FVG forward** and fire the entry on
  the retrace into it, and (d) hold the short through the open chop to the lower draw.
- **Grading lessons (2026-06-22):** (1) my first pass called this NO-TRADE (window ended 10:15, one bar
  early; read only `most_recent_structure`) — grade through structure resolution + the full event list.
  (2) the HTF re-derivation found the original "counter-HTF long" was a **structure over-read**; the
  HTF vote comes from a **significant near-price array + reaction**, NOT the liquidity map — liquidity
  is the draw/target, not a vote (BIAS 09:21) [[engine-htf-overread]]. (3) **the clean entry was an
  MSS-leg FVG retrace I first MISSED** by windowing to 09:45+ — the entry FVG formed at 08:22 in the
  08:24 MSS leg. **Carry prior-leg FVGs forward**; the entry is the retrace into a held array, not the
  impulse break [[lanto-entry-on-prior-leg-fvg]].

**E3 · 2026-06-17 NY-AM — no-trade (conflicted + choppy)  ·  status: graded (user-confirmed)**
- **Bias re-derived (arrays + liquidity, 2026-06-22): ~2/3 bearish, NOT "conflicted."** HTF
  **bearish**: daily bull FVG **inverted *with* displacement** (ds 0.84), 4H **fresh bear FVG** (ds
  0.73 normal), 1H bear arrays — and the swept AS.H 30546 leaves the draw toward the untaken sell-side.
  Overnight **bull (+213)** was the **liquidity grab** that set up the reversal (like D2 06-09), not a
  conflicting vote. NY-open **bearish** (opened 30527 → bull pop → bear MSS 10:00 `break` dp 125 → sold
  30384, swept NYAM.L then LO.L). HTF + open-reaction agree bearish (~2/3); the old "daily macro bullish
  dp 548 → mixed/conflicted" was the arrays-only/structure over-read.
- **Verdict: no-trade — on PRICE QUALITY, not a bias conflict.** Range *normal* (rvn ≤ 1.68), two-sided
  (sold to 30384, **bounced to 30509 ≈85% recovery**, ground to 30359); all structure **internal-tier**
  (no swing-tier confirmation); neither candidate entry was clean (10:00 MSS whipsawed +120 against;
  10:25 retrace-short ground 40 min). A tradeable-direction bias but **no clean fast entry + choppy
  two-sided quality = stand aside** (Pillar 2/3 veto, not a Pillar 1 conflict).
- **Discriminator:** the bearish move eventually reached the lower draw, but a setup with no clean fast
  entry + marginal two-sided quality is NOT tradeable — stand aside, don't chase the eventual delivery.
  Contrast 06-16 (swing-tier MSS + clean breakdown + mass displacement = tradeable B).
- **Fresh MES counterpart review (2026-07-01):** fresh MES surfaced an early mechanical **B Inversion
  short** at **10:11 ET** (`7587.25 / 7593.5 / 7577.75 / 7295`) but it stopped at **10:13 ET** before
  later reaching TP1 at **10:41 ET**. There was no second clean short before the TP1 move; later candidates
  were blocked by the current one-primary-packet session latch (`session_primary_already_taken`) after the
  first `packet_ready`. Preserve MES as rejected/diagnostic provenance; it does not invalidate the MNQ
  no-trade row. A controlled retry-after-early-stop rule, if desired, is a future implementation/risk
  decision, not oracle truth for this row.

**E2 · 2026-06-18 NY-AM — marginal B long (Continuation / Trend)  ·  status: graded (user-confirmed)**
- **Bias bullish ALIGNED (2/3–3/3; re-derived 2026-06-22):** overnight bull **+448** (swept
  AS.H/NYAM.H/PDH — the dominant vote); HTF **bull** via near-price 4H/1H **bear FVGs inverted UP**
  (tiny) + the buy-side draw (daily arrays invalidated — drop the old "daily dp 548" anchor, that was
  the structure over-read); NY-open bull (shallow dip 30402 → bull BoS 10:25 → higher highs to 30646,
  swept LO.H+PDH). Model/side: **Continuation (Trend), long.**
- **Exact entry:** ~**30452.75** (CE of the dip-reclaim bull FVG **30448.25–30457.25**, formed 09:45,
  took-liq, ds 0.82; long the 1m reclaim ~09:46). **Structural stop anchor 30400** (below the 30402.5 dip low); executable broker stop **30399.50**
  after the universal two-tick buffer (risk ≈ 53.25). **TP1 30615** (NYAM.H — the only untaken draw above; ≈ +162 / **~3.0R**) — **filled**
  (ran to 30646). TP2 = trail to the next HTF draw.
- **Why B not A+ (and near no-trade):** the 3/3 bias is A+-*grade*, but the entry is marginal —
  not in-money-fast (−34 pt drawdown to 30418 before working), the entry FVG **invalidated** mid-trade
  (structural anchor 30400 / executable stop 30399.50 held), the window is choppy (FVGs print "invalidated" bar-after-bar), the open
  dip **swept no significant low** (NYAM.L 30392 never reached), and the structure breaks are weak
  (internal-tier, dp ~24-25). Caps at B.
- **Discriminator + lesson:** an aligned-bias trend day with a tradeable-but-sloppy entry = B, not A+.
  **Drilling to the 1m exact entry is what separates a clean A+ from a marginal B** — the 5m "dip then
  rally" looked cleaner than the 1m delivery actually was.

**E5 · 2026-06-25 NY-AM — no-trade (post-open dump + chop / no convincing leader)  ·  status: graded (user-confirmed)**
- **User chart read (2026-07-01):** short bias was technically correct, but the 09:30 open had already
  dumped hard and the rest of NY-AM chopped up/down without clean continuation — "nothing really went
  nowhere." Both the MNQ long and MES short mechanical candidates could be argued in isolation, which is
  exactly why this is a hard stand-aside day rather than a trade oracle.
- **Pair/leader read:** displacement leader **null** (MNQ `0.88`, MES `0.93`, margin `0.05` below the
  `0.10` threshold) and SMT leader **null** (`no_divergence_measured`). Current live code would default a
  null leader to **MNQ1!** for continuity, but the oracle truth for this row is **no convincing leader**,
  not an MNQ approval.
- **Rejected mechanical candidates:** fresh MNQ emitted a **B Inversion long** at **10:52 ET**
  (`29728.25 / 29595.5 / 30198.5 / 30264.25`) and stopped at **11:12 ET**. Fresh MES emitted an
  **A+ Inversion short** at **10:14 ET** (`7441 / 7454.5 / 7390`) and stopped at **10:21 ET**. Preserve
  both as rejected provenance; neither is the oracle row.
- **Verdict: no-trade — on post-open exhaustion/chop + pair conflict, not because short bias was wrong.**
  The correct lesson is: after an opening dump, if pair evidence is inconclusive and both directions can
  be argued while price goes two-sided, do not force either side.

**E6 · 2026-06-22 NY-AM — MES B Inversion short  ·  status: graded (user-confirmed)**
- **Approved instrument:** MES only. MNQ fresh fold had **no setup** with divergent context; keep the MNQ
  label neutral/unknown as paired context rather than turning it into a no-trade oracle row.
- **Pair/leader read:** displacement leader **null** (MNQ `0.95`, MES `0.90`, margin `0.05` below the
  `0.10` threshold) and SMT leader **null** (`no_divergence_measured`). This row approves the MES packet
  from fresh tape/chart review; it does **not** promote a general pair-leader rule.
- **Packet:** **B Inversion short** at **10:18 ET** from `zone:7584-7588.25` / `violation_close_bridge`.
  Entry **7580.5**, stop **7591.75** (`bars.last_5_bars[extreme]`), TP1 **7556.75**
  (`gates.engine.pillar3.swings.swing[7]`), TP2/LO.L **7552.5**.
- **Outcome path:** TP1 hit at **10:31 ET**; TP2/LO.L touched at **10:32 ET**; stop never hit in the tape
  path. Maximum favorable excursion after entry was about **53.25 points**, with about **7 points** max
  adverse before TP1.
- **Verdict: approve MES B Inversion short.** The correct lesson is to allow the clean MES short packet
  while preserving the null leader evidence as a caution, not as a standalone leader-selection rule.

**E7 · 2026-06-15 NY-AM — MES B Trend long, buffered-stop TP1  ·  status: graded (user-corrected)**
- **Approved instrument:** MES only. MNQ fresh fold had **no setup** with clean context; keep the MNQ label
  neutral/unknown as paired context.
- **Pair/leader read:** displacement leader **null** (MNQ `0.91`, MES `0.92`, margin `0.01` below the
  `0.10` threshold) and SMT leader **null** (`no_divergence_measured`). This is an MES packet approval,
  not a pair-leader rule.
- **Packet:** **B Trend long** at **11:24 ET** from `zone:7627.75-7629.75` / `trend_wick_tap_confirm`.
  Entry **7630.5**. User-corrected structural stop anchor **7626.50** = first FVG candle low (`c1l`),
  not the older `7627.00` full1m fallback. Executable broker stop uses the universal two-tick buffer:
  **7626.00**. User-corrected TP1 **7641.50** = H4 bearish FVG first-candle high
  (`engine_by_tf.h4.fvgs[15].c1h`), not the generic `7640.00` psych fallback. TP2 **7650**.
- **Outcome path:** the structural anchor **7626.50** was wicked at **11:33 ET**, but the buffered
  executable stop **7626.00** was not hit; corrected TP1 **7641.50** was reached at **11:50 ET**.
  Execution risk **4.5 points**; TP1 pays **2.44R**.
- **Second-entry note:** no retry is needed for this row under the buffered-stop rule. Controlled
  retry-after-true-execution-stop remains a separate future implementation/risk question, not oracle truth
  for this row.
- **Verdict: approve MES B Trend long as a valid setup with buffered-stop TP1 outcome.** The structural
  anchor remains the strategy invalidation level; execution, sizing, brackets, and grading use the buffered
  broker stop.


**E8 · 2026-06-24 NY-AM — MNQ B Inversion long, stopped; second-entry policy blocker  ·  status: graded (user-confirmed)**
- **Approved instrument:** MNQ only. MES fresh fold had **no context / no setup** (`no_bias`, marginal
  price quality) and remains neutral paired context.
- **Pair/leader read:** displacement leader **null** (MNQ `0.86`, MES `0.88`, margin `0.02` below the
  `0.10` threshold). SMT showed divergence with **MNQ1!** as leader but `bias_dir=short`, so this is not
  a clean pair-leader long rule.
- **Packet:** **B Inversion long** at **09:51 ET**. Entry **29722.25**; structural stop anchor **29564**;
  executable broker stop **29563.5** after the universal two-tick buffer; TP1 **29843.5**; TP2 **29874**.
- **Outcome path:** executable stop hit first at **10:20 ET**. TP1 was reached later at **10:46 ET** and
  TP2 at **10:48 ET**, so the approved first trade scores as a **loss / -1R**.
- **Second-entry lesson:** trace shows **one** actual `packet_ready`/`bestPacket`, then **14** later
  confirmed walkers killed by `session_primary_already_taken`. The key likely retry was a later
  **Inversion long confirmed at 10:32 ET**, after the stop and before the 10:46/10:48 target run; user
  notes it would probably have been valid and won. Treat this as future `retry_after_true_execution_stop`
  design work, not as a rewrite of the first trade's outcome.
- **Verdict: approve MNQ B Inversion long as a valid losing setup and preserve the second-entry issue as
  implementation-review evidence.**

**E9 · 2026-04-06 NY-AM — MNQ B Inversion short packet-only / unresolved  ·  status: review evidence (not scored)**
- **Packet:** fresh MNQ direct-brief fold surfaced **B Inversion short** at **10:04 ET**: entry **24625**,
  structural stop anchor **24745.75**, executable stop **24746.25**, TP1 **24337**, TP2 **24273.75**.
- **Outcome path in NY-AM tape:** stop was not hit; TP1/TP2 were not hit. Post-entry max high was
  **24684** at **10:21 ET**; post-entry min low was **24545.25** at **11:33 ET**. The row is unresolved
  inside the tape window and is **not R-scored**.
- **Pair context:** displacement leader **null** (`0.98` vs `0.96`, margin `0.02`); SMT leader **MES1!**
  with `bias_dir=short`; MES had no context/no setup (`no_bias`, marginal price quality).
- **Verdict: preserve as packet-only unresolved review evidence.** Do not promote to a scored trade or
  no-trade without extended replay/user review.

**E10 · 2026-01-29 NY-AM — no-trade / stand-aside  ·  status: graded (user-confirmed)**
- **MNQ:** context built and chain status was clean; open reaction read AS.L rejection -> bullish aligned,
  A+ cap; nevertheless no actual `bestPacket` / `packet_ready` formed.
- **MES:** displacement leader signal was present, but MES had poor Pillar 2 and divergent context; no
  actual `bestPacket` / `packet_ready` formed.
- **Pair/leader read:** displacement leader **MES1!** (`secondary_higher_disp_score`, margin `0.18` above
  threshold); SMT leader **null** (`no_divergence_measured`). Leader evidence alone is not tradable
  without price quality and a setup.
- **Verdict: approve no-trade / stand-aside.** No setup on either instrument; do not promote the MES
  leader signal into a standalone rule.

---

## Pass bar

A reconstructed session **passes** if the deterministic chain matches the docs/transcripts-backed,
user-approved oracle on **bias direction, grade tier, entry model, and side**, with entry / stop /
TP1 within tolerance (same FVG/level, or ±~2–3 MNQ pts). A miss on any of bias / grade / model /
side is a **fail** — those are the load-bearing decisions, not the exact tick.

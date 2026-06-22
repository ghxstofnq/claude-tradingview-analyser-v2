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
    3/3 bias *or* an **exceptional entry** (multi-alignment / clean displacement) on an
    otherwise-aligned, good-price day. (2026-02-09: 2/3 bias but A+ multi-alignment entry → A+.)
  - **B** = aligned but **one element marginal** — a sloppy/ordinary entry *even at 3/3*, or 2/3
    with an ordinary entry.
  - **No-trade** = a real **conflict** among bias inputs (open-reaction **reverses** the bias →
    **hands off**), a missing/weak pillar, or no clean entry.
  - A **neutral** input (chop overnight / no HTF) is a non-vote, not a conflict. The entry only
    **elevates an already-aligned day**; multi-alignment in a conflicted/choppy tape is still no-trade/B.

**Pillar 2 — price quality (filter):**
- [ ] Displacement present; engulfing/flush, not mass wicks/dojis.
- [ ] Gap size is a real magnet (not a ~20pt 4H gap).
- [ ] Not tight consolidation (the "28pt/3h = stand aside" test).

**Pillar 3 — entry + confirmation (filter):**
- [ ] Model identified: Reversal (MSS) or Continuation (Trend), entered via FVG-retrace or
  inversion (or multi-alignment).
- [ ] Best gap: displacement + took liquidity while forming.
- [ ] MSS only: significant swept liquidity + reversal speed matches/exceeds the down-move.
- [ ] Confirmation = 1m candle close, deliberate/engulfing, not a tap alone, doesn't fight
  >10–15 min.

**Risk/management (filter):**
- [ ] Stop structural (MSS low / FVG edge / swing). TP1 ≈ 1–1.5R intraday liquidity;
  ultimate ≈ 2R+ HTF draw. Management = trail / BE per style.

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
| X1 | ENTRY ~25:13 (**2026-02-09**, real Discord trade) | **5m bullish FVG rebalance** + **1m bearish FVG go bullish-invert**, in one | A+ long | Two imbalances confirming one move |

### Bias / price-quality (whole-session reads)
| # | Source | Setup | Lanto's call | Discriminator |
|---|---|---|---|---|
| B1 | BIAS (**2026-12-12**... see note) | overnight bearish (London sold off); NY swept London lows then **displaced down 9:40** | Bearish, **2/3 = B** (no strong HTF) | Overnight + open-reaction agree; HTF absent |
| B2 | BIAS ~26:46 | took London lows then bounced, but **no major displacement** up | Did NOT flip long | Reversal needs mass displacement vs strong overnight |
| B3 | BIAS ~36:32 | NQ weaker than ES; ES showed the sell first | Flipped on **ES**, rode NQ | SMT / leading asset |
| P1 good | PRICE ~19:00 | 1m FVG retest, **engulfing** confirmation | Long, ran fast | Engulfing close → immediate follow-through |
| P2 bad | PRICE ~24:37 | PPI 1m gap, consolidation, **fought >15 min** | Should not have taken | Tight/choppy delivery, fight-timeout |
| R1 | RISK (**2025-10-02**) | bullish HTF; long off hourly gap + 4H FVG + overnight lows; later **hourly inverts** → short | Long then flip short | Confluence stack; flip on gap inversion |

> Note on dates: transcript timestamps are class times; the *trade* dates are as labelled
> by Lanto (he marks real Discord trades with a date). Verify each against the chart when
> reconstructing.

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
  **alignment+conviction** grade model — an exceptional entry elevates an aligned 2/3 day to A+.
- **Bias (replay): ~2/3 bullish, elevated by the entry.** HTF bullish (daily had a bear MSS dp 416
  but price **reclaimed up** through it; 1H fresh bull MSS 25632; 4H bull FVG at price); NY-open
  bullish (rallied 25553 → 25864, bull MSS 09:50, **swing-tier** bull BoS 11:30 at 25855);
  overnight **chop** (net −92 = non-vote). Price-action good (sustained +310 trend).
- **Model / side:** multi-alignment long (5m bullish FVG rebalance + 1m bearish→bullish iFVG, in one).
- **Entry (1m-pinned): ~25630–25635** — the 1m bullish-inversion close on the reclaim (~09:54–09:56)
  inside the 5m bull FVG, after the **swing-tier bull MSS 09:47** (25665) and the **5m FVG CE-tap** at
  the **25611** pullback (09:53). The two imbalances in one: 5m bull FVG rebalance + the 1m bearish FVGs
  (≈25610–25631) inverting bullish on the reclaim. **Stop ~25605** (below the 25611 reclaim/inversion
  low; structural alt ~25575 below the 25581 dip) → **1R ≈ 28 pts.**
- **Draws (untaken buy-side above):** **TP1 = NYAM.H 25707 / LO.H 25723 cluster (~2.6–3.0R)**;
  **TP2 = AS.H 25855.25 (~7.3R — HIT**, price ran to 25864); ultimate **PWH 26536**. **BE → entry (25630)
  at TP1.**
- **Discriminator the chain must get right:** two imbalances confirming the *same* move → A+ even at
  2/3 bias; a single ordinary FVG entry on the same day would be a B.

### D2 · 2026-06-09 NY-AM — A+ Inversion short  ·  status: graded (replay-confirmed; GXNQ's logged draws corrected)
- **Setup:** overnight rallied (+301) and NY **swept the highs** (AS.H/NYAM.H/PDH) at the 30136
  spike → reversed **down off the HTF bear draw** (fresh bear daily FVG *at price* + 4H/1H bear
  FVGs) → **swing-tier bear MSS 10:45** (29595, dp 152) → sold off to 29154. Bias bearish; the
  bullish overnight was the **liquidity grab** that set up the reversal (not a conflict).
- **Model / side:** **Inversion short** — the bullish FVGs **29743–29776** violated to bearish
  (inverted) on the retrace into the bear FVGs; the 1m violation close confirms.
- **Entry: 29731.25** (1m inversion close, **~10:29–10:34** — NOT 09:50; the documented time was
  ~40 min early). **Stop: 29851.50** (above the 29836 retrace swing). **1R = 120.25 pts.**
- **Draws (untaken sell-side below):** **TP1 = AS.L 29595.25 (1.13R)** — nearest sell-side draw;
  **TP2 = PDL 29113.75 (5.13R)** then **PWL 29071.25 (5.49R)** — the ultimate HTF draw (price hit
  29154 ≈ PDL). **BE → entry (29731.25) when TP1 fills** (no-trim ride-the-trail).
- **Grade A+:** significant grab (swept AS.H/NYAM.H/PDH) + swing-tier reversal + clean inversion +
  reached the draw.
- **Corrections to GXNQ's label:** logged TP1 **29302** maps to no level/pool (dropped); logged
  **TP2 "28779 PWL"** is wrong — actual **PWL is 29071.25**; logged entry time **09:50** is ~40 min
  early (actual ~10:30).

### D3 · 2025-12-12 (B1) — bearish 2/3 = B  ·  status: documented (levels: reconstruct)
- **Bias:** bearish, **2/3 → B** (overnight + open-reaction agree; **no strong HTF read**).
  Overnight bearish (London sold off); NY swept the London lows then **displaced down ~09:40**.
- **Model / side:** continuation of the bearish overnight via the open-reaction displacement.
  **Short.** **Entry:** the post-sweep displacement-down FVG; **stop:** above the sweep high;
  **TP1:** next sell-side pool below.
- **Discriminator:** the missing HTF vote **caps it at B** — the chain must not promote a
  clean 2/3 day to A+.

### D4 · 2025-10-02 (R1) — long, then flip short  ·  status: documented (levels: reconstruct)
- **Setup A — long:** bullish HTF; entry off the **hourly gap + 4H FVG + overnight lows**
  confluence. **Long.** Grade high (confluence stack). Stop below the overnight lows; TP at
  the HTF draw above.
- **Setup B — flip short:** later the **hourly gap inverts** → **short** (Inversion). Entry
  on the close through the inverted hourly gap; stop above it.
- **Discriminator:** the chain must (a) stack confluence into the long and (b) **flip** on the
  gap inversion — two distinct, correctly-sided decisions in one session.

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

**E? · 2026-06-16 NY-AM — B short (counter-HTF Reversal)  ·  status: graded (user-confirmed; 1m entry to pin)**
- **HTF:** **long** (daily structure broke up, dp 548; price ran to ~30811). Overnight: chop.
- **Model / side:** **Reversal — swing-tier bear MSS** (level 30793.5, displacement+sweep).
  **Short**, against the HTF long → **divergent day → capped at B**.
- **The move:** high **30869.75 @ 09:55** → broke down **10:20** → **30601 by 11:00**; **AS.L
  30755 + LO.L 30783 swept** (lower draws taken), bottoming near NYAM.L ~30601.
- **Entry / stop / TP:** 1m confirming close into the breakdown (~10:15–10:20 retrace to a
  bearish 5m FVG — exact tick to pin). **Stop:** above the 09:55 high 30869.75 (/ NYAM.H
  30887). **TP1:** AS.L 30755 / LO.L 30783; **ultimate:** NYAM.L ~30601.
- **Discriminator:** counter-HTF reversal — the side gate must allow it but **cap at B**, not
  promote to A+; and the system must hold the short through the open chop to the lower draw.
- **Grading lesson (2026-06-22):** my first pass called this NO-TRADE because the window
  ended at 10:15 (one bar before the breakdown) and only read `most_recent_structure`. Always
  grade through structure resolution + read the full event list.

**E3 · 2026-06-17 NY-AM — no-trade (conflicted + choppy)  ·  status: graded (user-confirmed)**
- **Votes conflict:** overnight **bullish** (+213, swept AS.H 30546); NY-open **bearish** (opened
  30527 → sold 30384, bear MSS 10:00 `break` dp 125, swept NYAM.L then LO.L) — the open **reversed**
  the bullish overnight. HTF **mixed**: daily macro bullish (dp 548) but the near-price daily bull
  FVG is inverted and 4H+1H carry fresh bear FVGs at price.
- **Verdict: no-trade.** Quality marginal — range *normal* (rvn ≤ 1.68), two-sided (sold to 30384,
  **bounced to 30509 ≈85% recovery**, ground to 30359); all structure **internal-tier** (no
  swing-tier confirmation); neither candidate entry was clean (10:00 MSS whipsawed +120 against;
  10:25 retrace-short ground 40 min). Conflicted bias + choppy quality + no fast confirmation = stand aside.
- **Discriminator:** the bearish move eventually reached the lower draw, but a setup with no clean
  fast entry under conflicting bias is NOT tradeable — the system must stand aside, not chase the
  eventual delivery. Contrast 06-16 (swing-tier MSS + clean breakdown = tradeable B).

**E2 · 2026-06-18 NY-AM — marginal B long (Continuation / Trend)  ·  status: graded (user-confirmed)**
- **Bias 3/3 bullish ALIGNED:** overnight bull (+448, swept AS.H/NYAM.H/PDH); HTF bull (daily macro
  dp 548 + near-price 4H/1H bear FVGs **inverted** up); NY-open bull (shallow dip 30402 → bull BoS
  10:25 → higher highs to 30646, swept LO.H+PDH). Model/side: **Continuation (Trend), long.**
- **Exact entry:** ~**30452.75** (CE of the dip-reclaim bull FVG **30448.25–30457.25**, formed 09:45,
  took-liq, ds 0.82; long the 1m reclaim ~09:46). **Stop 30400** (below the 30402.5 dip low; risk
  ≈ 52.75). **TP1 30615** (NYAM.H — the only untaken draw above; ≈ +162 / **~3.1R**) — **filled**
  (ran to 30646). TP2 = trail to the next HTF draw.
- **Why B not A+ (and near no-trade):** the 3/3 bias is A+-*grade*, but the entry is marginal —
  not in-money-fast (−34 pt drawdown to 30418 before working), the entry FVG **invalidated** mid-trade
  (structural stop 30400 held), the window is choppy (FVGs print "invalidated" bar-after-bar), the open
  dip **swept no significant low** (NYAM.L 30392 never reached), and the structure breaks are weak
  (internal-tier, dp ~24-25). Caps at B.
- **Discriminator + lesson:** an aligned-bias trend day with a tradeable-but-sloppy entry = B, not A+.
  **Drilling to the 1m exact entry is what separates a clean A+ from a marginal B** — the 5m "dip then
  rally" looked cleaner than the 1m delivery actually was.

---

## Pass bar

A reconstructed session **passes** if the deterministic chain matches Lanto on **bias
direction, grade tier, entry model, and side**, with entry / stop / TP1 within tolerance
(same FVG/level, or ±~2–3 MNQ pts). A miss on any of bias / grade / model / side is a
**fail** — those are the load-bearing decisions, not the exact tick.

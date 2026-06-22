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
- **Draw-bias pillar = votes aligned:** 1/3 → no-trade · 2/3 → caps at B · 3/3 →
  A+-eligible (2/3 trades with no HTF read). **Overall grade is nested:** A+ only if
  draw-bias 3/3 **and** price-action good **and** entry-model clean; any pillar weaker → B.
  An open-reaction that **reverses** the bias = **hands off**.

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

### D1 · 2026-02-09 NY — multi-alignment A+ long  ·  status: documented (levels: reconstruct)
- **Bias:** bullish. **Grade:** A+ (the flagship 3/3 + clean case Lanto walks live).
- **Model / side:** Reversal entered by **multi-alignment** — 5m bullish FVG rebalance **and**
  a 1m bearish FVG that goes bullish-invert, in one move (ENTRY ~25:13). **Long.**
- **Entry:** the overlap of the 5m bullish FVG and the 1m iFVG, on the 1m confirming close.
  **Stop:** below the swept low / the FVG that created the move. **TP1:** nearest intraday
  buy-side liquidity (~1–1.5R); **ultimate:** the HTF draw above (~2R+).
- **Discriminator the chain must get right:** two imbalances confirming the *same* move →
  A+, not two separate B setups.

### D2 · 2026-06-09 NY-AM — Inversion short  ·  status: hand-grade (one open question)
- **Bias:** bearish (sell-side delivered the morning; swing-tier structure was MSS-bear).
- **Model / side:** **Inversion, short** — a bullish FVG violated to an iFVG after the high
  was taken. (High confidence on model + side.)
- **Confirming candle — CONFIRMED (2026-06-22):** the **1m violation close** at 09:52 ET.
  Lanto uses 1m confirmation on every gap and for inversion the violating close *is* the
  confirmation ([confirmation.md](confirmation.md)). The old 5m close (09:55 ET, entry
  29731.25) was the bot's behavior and is **superseded**.
- **Entry / stop / TP1:** **29792 / 29847 / 29659.25** (the 1m violation close).
- **Grade:** recorded as **A+**; confirm the 3-vote count from the evidence when the session
  is fully reconstructed (could be B if only 2/3).

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

---

## Pass bar

A reconstructed session **passes** if the deterministic chain matches Lanto on **bias
direction, grade tier, entry model, and side**, with entry / stop / TP1 within tolerance
(same FVG/level, or ±~2–3 MNQ pts). A miss on any of bias / grade / model / side is a
**fail** — those are the load-bearing decisions, not the exact tick.

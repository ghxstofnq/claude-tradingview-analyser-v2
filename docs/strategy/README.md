# Lanto Strategy — specification

This folder is the authoritative spec for the trading methodology the bot implements:
**Lanto's three-pillar ICT framework.** Every doc here is written from his own class
transcripts (vendored in `transcripts/`) and distilled in
[`lanto-source-of-truth.md`](lanto-source-of-truth.md), which also tracks where the
bot's current behavior diverges from the spec.

> These docs describe **Lanto's method (the target)** — confirmed line-by-line against
> his transcripts (see [`lanto-source-of-truth.md`](lanto-source-of-truth.md) and the
> decisions ledger in `docs/plans/`). The system is being **rebuilt** to implement them
> faithfully; correctness is judged by **hand-grading sessions against Lanto**, not by the
> old backtest baseline (retired).

## The system: three pillars

A trade is taken **only** when all three pillars are acceptable. Otherwise: no trade.

1. **Pillar 1 — Draw & Bias** → [`daily-bias.md`](daily-bias.md)
   Where price is drawn and which way today leans: HTF (Daily/4H/1H) + overnight
   (Asia/London) + the NY-open reaction.
2. **Pillar 2 — Price-Action Quality** → [`price-action.md`](price-action.md)
   Is the environment tradable: displacement, gap size, candle anatomy, consolidation.
3. **Pillar 3 — Entry Model + Confirmation** →
   [`entry-models.md`](entry-models.md) + [`confirmation.md`](confirmation.md)
   Two models (Reversal / Continuation), each entered via FVG-retrace or gap-inversion;
   always triggered by a 1-minute candle-close confirmation.

Risk, sizing, and trade management: [`risk-and-management.md`](risk-and-management.md).

## The grade (nested — three pillars)

A trade needs **all three pillars** present — draw-bias, price-action, entry-model.
*"Without all three, there are no takes."* The overall grade is how strongly all three
align.

The **draw-bias pillar** is scored by **counting three bias components** — HTF analysis,
overnight price, and the NY-open reaction:

| Bias components aligned | Draw-bias pillar |
|---|---|
| 1 of 3 | unclear → **no trade** |
| 2 of 3 | clear, **capped at B** |
| 3 of 3 | fully confirmed → **A+-eligible** |

> "One out of three — don't trade. Two out of three — not A+ but you can trade. Three out
> of three — A+." *(BIAS ~22:25)* … "your draw bias is completely confirmed once you have
> these three settled." *(BIAS 21:29)*

**A+ = all three pillars strong** (draw-bias 3/3 **and** price-action good **and**
entry-model clean). Any pillar weaker → **B**. **Price-action is a grading pillar, not
just a gate** *(PRICE 02:13–03:09)*. A **2/3 day is tradable with no HTF read** (overnight
+ open-reaction alone). If the open-reaction **reverses** the bias, it's **hands off** —
timing isn't there yet *(BIAS 18:42)*, not a B trade.

## 7-step checklist

1. **HTF bias** — mark the best (displacive, liquidity-taking) PD arrays near price on
   Daily/4H/1H; define the primary draw. → [`daily-bias.md`](daily-bias.md) §2
2. **Overnight** — mark Asia/London H/L, note untaken liquidity, read overnight
   direction (recency). → [`daily-bias.md`](daily-bias.md) §3
3. **Price quality** — range, displacement, candle anatomy; stand aside if bad. →
   [`price-action.md`](price-action.md)
4. **NY-open reaction** — wait 15–30 min; reject vs invert (open reversing the bias =
   hands off). → [`daily-bias.md`](daily-bias.md) §4
5. **Entry model** — Reversal / Continuation × FVG-retrace / inversion. →
   [`entry-models.md`](entry-models.md)
6. **Confirmation & execution** — tap → 1m close in direction → enter, structural stop.
   → [`confirmation.md`](confirmation.md)
7. **Sizing & management** — grade × day-of-week; TP1 at intraday liquidity, ultimate
   at the HTF draw. → [`risk-and-management.md`](risk-and-management.md)

## How strategy citations work

Analysis output cites strategy authority with `(strategy.<doc>)` tokens — e.g.
`(strategy.sizing-table)` for the canonical sizing table (which lives in
[`risk-and-management.md`](risk-and-management.md)). Numeric prices are cited
separately with JSON paths (see CLAUDE.md constraint #6).

## Authority policy

Use this folder and the vendored transcripts as the strategy authority:

- `docs/strategy/*.md` — the canonical, reviewed strategy spec.
- `docs/strategy/transcripts/` — the source class transcripts used to derive it.

Do **not** use or cite Lanto callout / alerted-trade-derived files as
strategy authority. Those materials are retired because they are easy to
misunderstand. If an older doc, fixture, or script mentions an expectation from those files,
treat it as stale until the expectation is re-derived from this spec,
the transcripts, chart evidence, and/or explicit user approval.

## Legacy section-citation map

The codebase has many comments citing the old single-file spec by section number
(`§2.3`, `§7 Step 7`, `EM MSS §4`, …). Those sections were split into the topic docs
above. This table resolves any legacy citation:

| Legacy citation | Now in |
|---|---|
| §1 (framework) | this README |
| §2 / §2.1 (HTF) | [`daily-bias.md`](daily-bias.md) §2 |
| §2.2 (overnight) | [`daily-bias.md`](daily-bias.md) §3 |
| §2.3 (NY-open / LTF bias) | [`daily-bias.md`](daily-bias.md) §4 |
| §2.4 (flexibility / alignment) | [`daily-bias.md`](daily-bias.md) §5 |
| §3 (price quality) | [`price-action.md`](price-action.md) |
| §4 (entry models) | [`entry-models.md`](entry-models.md) |
| §5 (confirmation) | [`confirmation.md`](confirmation.md) |
| §6 (risk / stops) | [`risk-and-management.md`](risk-and-management.md) |
| §7 (checklist) | this README |
| §7 Step 1 / 2 / 4 | [`daily-bias.md`](daily-bias.md) §2 / §3 / §4 |
| §7 Step 3 | [`price-action.md`](price-action.md) |
| §7 Step 5 | [`entry-models.md`](entry-models.md) |
| §7 Step 6 | [`confirmation.md`](confirmation.md) |
| §7 Step 7 | [`risk-and-management.md`](risk-and-management.md) |
| EM MSS / Trend / Inversion §N | [`entry-models.md`](entry-models.md) (same sub-numbers, preserved) |

> Citations like "resolver spec §3.4" refer to the open-reaction resolver design, not
> this spec — leave those unchanged.

---

*Implementation status & bot-vs-spec gaps: [`lanto-source-of-truth.md`](lanto-source-of-truth.md).*

# Lanto Strategy — specification

This folder is the authoritative spec for the trading methodology the bot implements:
**Lanto's three-pillar ICT framework.** Every doc here is written from his own class
transcripts (vendored in `transcripts/`) and distilled in
[`lanto-source-of-truth.md`](lanto-source-of-truth.md), which also tracks where the
bot's current behavior diverges from the spec.

> These docs describe **Lanto's method (the target)**. The bot does not yet implement
> all of it — see the "Implementation status" footer in each doc and the audit in
> `lanto-source-of-truth.md`. Behavioral changes toward this spec are folded
> old-vs-new on the full-year corpus and approved one lever at a time.

## The system: three pillars

A trade is taken **only** when all three pillars are acceptable. Otherwise: no trade.

1. **Pillar 1 — Draw & Bias** → [`daily-bias.md`](daily-bias.md)
   Where price is drawn and which way today leans: HTF (Daily/4H/1H) + overnight
   (Asia/London) + the NY-open reaction.
2. **Pillar 2 — Price-Action Quality** → [`price-action.md`](price-action.md)
   Is the environment tradable: displacement, gap size, candle anatomy, consolidation.
3. **Pillar 3 — Entry Model + Confirmation** →
   [`entry-models.md`](entry-models.md) + [`confirmation.md`](confirmation.md)
   MSS / Trend / Inversion, always triggered by a 1-minute candle-close confirmation.

Risk, sizing, and trade management: [`risk-and-management.md`](risk-and-management.md).

## The grade (count the three bias components)

Lanto grades the day by **counting how many of three bias components align** — HTF
analysis, overnight price, and the NY-open reaction:

| Components aligned | Grade | Action |
|---|---|---|
| 1 of 3 | — | **No trade** |
| 2 of 3 | **B** | Trade, lower conviction/size |
| 3 of 3 | **A+** | Trade, full conviction/size |

> "One out of three — don't trade. Two out of three — it's not A+, but you can trade.
> Three out of three — it is A+." — *How I Develop Daily Bias, ~21:29*

Crucially, **a 2/3 day is tradable even with no clean HTF read** (overnight + open
reaction alone). Price-quality (Pillar 2) and a valid entry model + confirmation
(Pillar 3) are gating filters on top of the bias grade, not extra vote counts.

## 7-step checklist

1. **HTF bias** — mark the best (displacive, liquidity-taking) PD arrays near price on
   Daily/4H/1H; define the primary draw. → [`daily-bias.md`](daily-bias.md) §2
2. **Overnight** — mark Asia/London H/L, note untaken liquidity, read overnight
   direction (recency). → [`daily-bias.md`](daily-bias.md) §3
3. **Price quality** — range, displacement, candle anatomy; stand aside if bad. →
   [`price-action.md`](price-action.md)
4. **NY-open reaction** — wait 15–30 min; reject vs invert; extension vs retrace day. →
   [`daily-bias.md`](daily-bias.md) §4
5. **Entry model** — MSS / Trend / Inversion. → [`entry-models.md`](entry-models.md)
6. **Confirmation & execution** — tap → 1m close in direction → enter, structural stop.
   → [`confirmation.md`](confirmation.md)
7. **Sizing & management** — grade × day-of-week; TP1 at intraday liquidity, ultimate
   at the HTF draw. → [`risk-and-management.md`](risk-and-management.md)

## How strategy citations work

Analysis output cites strategy authority with `(strategy.<doc>)` tokens — e.g.
`(strategy.sizing-table)` for the canonical sizing table (which lives in
[`risk-and-management.md`](risk-and-management.md)). Numeric prices are cited
separately with JSON paths (see CLAUDE.md constraint #6).

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

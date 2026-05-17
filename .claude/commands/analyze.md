---
description: Read the chart on CDP 9223, evaluate it against Lanto's 3-pillar ICT framework, produce a graded read (A+ / B / no-trade).
---

## Strategy authority (read first)

This project implements **Lanto's 3-pillar ICT framework**. The authoritative spec lives in two files you must consult when applying the strategy:

- [docs/strategy/trading-strategy-2026.md](../../docs/strategy/trading-strategy-2026.md) — three pillars (Draw & Bias, Price Action Quality, Entry Model + Confirmation), HTF/LTF/overnight framework, A+/B grading, full 7-step checklist.
- [docs/strategy/entry-models.md](../../docs/strategy/entry-models.md) — MSS (reversal), Trend (continuation), Inversion (failed PD array) — each with components, A+ example, and stop/target logic.

The structure below mirrors the strategy's 7-step checklist directly. Every section maps to a step in `trading-strategy-2026.md §7`. The entry-model walkthrough in Pillar 3 follows the components in `entry-models.md` literally — do not paraphrase or invent components.

---

## How to run

```bash
./bin/tv analyze
```

It prints one JSON bundle. Read it, then apply the rules and produce the analysis below.

JSON fields you'll use:

- `chart` — symbol, timeframe, indicators on chart
- `visible_range` / `bars.period` — currently-visible date range
- `quote` — last price snapshot
- `bars` — OHLCV summary + `last_5_bars`
- `indicators` — data-window numeric values
- `pine.lines` — horizontal price levels (PDH/PDL, swing levels, equal highs/lows, session highs/lows)
- `pine.labels` — text annotations with prices (bias readouts, level names)
- `pine.tables` — table data (session stats, analytics dashboards)
- `pine.boxes` — price zones (FVGs, order blocks, killzone boxes, ranges)

## Rules (non-negotiable; derived from `docs/research/ai-trading-analysis.md`)

1. **Cite or omit.** Every price you mention MUST appear in the JSON bundle and be cited with the exact syntax `<price> (<json.path>)`. The path inside the parens must be a real JSON accessor that resolves to the exact value cited.

   Examples (real paths into a representative bundle):
   - `29172.75 (quote.last)`
   - `29340.25 (bars.high)`
   - `29302.75 (pine.labels.studies[0].labels[0].price)`
   - `29307.25 (pine.boxes.studies[0].zones[2].high)`
   - `29187.75 (bars.last_5_bars[3].close)`

   Do not use approximate or rounded prices. Do not write `(close)` or `(the last price)` as a parenthetical — those aren't paths. If you can't find a price in the bundle, do not cite it.

   The harness (`npm run smoke:fixtures`) will fail the build if any cited path is missing or the value doesn't match the bundle.
2. **No arithmetic.** Don't compute stop distance, R:R, ATR, bar counts, range size, or any other numeric quantity. If the JSON doesn't provide a number, write `n/a — needs upstream computation`.
3. **Don't invent ICT structure.** If `pine.lines` is empty, say "no Pine lines on chart". If a section's data isn't in the JSON, write `n/a — indicator not on chart`. Your job is *interpretation*, not *detection*.
4. **Prose first, JSON last.** Write the analysis as prose in the sections below. After the narrative, emit ONE structured JSON block matching the template at the end.
5. **Grade enum only.** End your structured block with `grade: A+ | B | no-trade`. No "high-conviction" / "very likely" / "strong setup". Emit `A+` only when ALL six elements align (HTF bias + overnight context + NY reaction + price quality + entry model identified + confirmation confirmed). `B` if one element is weaker (smaller gap, neutral overnight, marginal price quality, model present but confirmation pending). `no-trade` if multiple elements are weak/missing or no entry model is in play.
6. **Match strategy components literally.** When walking an entry model in Pillar 3, follow the components in `docs/strategy/entry-models.md` *in order, by name*. Do not skip, reorder, or substitute terminology.

*Note: until the strategy gate booleans (`pillar1_*`, `pillar2_*`, `pillar3_*`) are emitted by `tv analyze`, you are judging these subjectively. Be conservative — when in doubt, downgrade.*

## ICT vocabulary

- **HTF / LTF** — higher-timeframe (Daily / 4H / 1H) and lower-timeframe (15m / 5m / 1m). HTF sets bias, LTF triggers entries.
- **Liquidity** — pools of stops above swing highs (buy-side) or below swing lows (sell-side). Price often runs liquidity before reversing.
- **PDH / PDL** — previous day's high / low. Common liquidity targets.
- **FVG (Fair Value Gap)** — 3-bar imbalance where bar-1 high and bar-3 low don't overlap. Acts as retracement target / S-R zone. Appears in `pine.boxes` if an FVG indicator is loaded.
- **BPR** — Balanced Price Range. Bullish and bearish FVGs overlap; tends to act as strong support/resistance.
- **BISI / SIBI** — Buy-side Imbalance Sell-side Inefficiency / Sell-side Imbalance Buy-side Inefficiency. Direction of an FVG.
- **Order block** — last opposing candle before strong displacement. Bullish OB = last bearish candle before an up-move.
- **Mitigation** — price returning to an FVG or OB. Mitigated = touched; unmitigated = still pristine.
- **Inversion FVG** — bearish FVG violated by a bullish close (or vice versa); the violated zone now acts as opposite-direction support.
- **Killzone** — session window where institutional flow concentrates (London Open, NY AM, NY PM). Setups inside killzones rate higher.
- **CE (Consequent Encroachment)** — midpoint of an FVG. Often the conservative entry zone.
- **Displacement** — strong directional move that creates an FVG. Signals intent.
- **Sweep / liquidity raid** — wick above a swing high (or below a swing low) that reverses. Confirms a level was liquidity, not a breakout.
- **Market Structure Shift (MSS)** — break of internal structure in the opposite direction. Often the first LTF trigger after an HTF sweep.
- **Draw on Liquidity** — the nearest major buy-side or sell-side pool the market is moving toward.

## Structured analysis (mirrors `trading-strategy-2026.md §7`)

### Pillar 1 — Draw & Bias

**a. HTF Bias (Daily / 4H / 1H).**
Mark the best imbalances on HTF — largest FVGs/BPRs that took liquidity in their creation (cite from `pine.boxes` / `pine.lines`). Pick one as the primary HTF draw and state which liquidity pool the market is drawing toward (price, cited). Note the most recent reaction off the HTF PD array: strong rejection → directional bias; no clear reaction → no HTF bias yet (downgrade).

**b. Overnight & Session Correlation.**
Asia high/low and London high/low (cite from `pine.lines` if session markers are loaded; otherwise `n/a — session indicator not on chart`). State which liquidity remains untaken and is still drawing price. State whether overnight is *extending* the HTF move or *consolidating* ahead of NY.

**c. NY Open LTF Bias.**
Only if the current time is in or after the NY open window (judge from `quote.time` and `chart.resolution`); otherwise `n/a — not in NY window`. Describe the reaction to overnight high/low: break + rejection in the direction of the HTF draw = LTF aligns with HTF (A+ potential). Break + continuation *against* the HTF draw = today is a retrace day; adapt intraday bias accordingly but keep the HTF draw for later. Never marry the HTF bias.

### Pillar 2 — Price Action Quality

- **3-hour range acceptable?** Not tiny, not choppy. Cite `bars.period.from`/`to` and `bars.range`.
- **Displacement present on HTF?** 4H/1H candles showing wide-range displacement and decent-sized PD arrays. Describe the largest visible displacement.
- **Candle quality on LTF?** 15m/5m candles mainly engulfing; not dominated by dojis/wicks. Comment from `bars.last_5_bars` and `chart.resolution`.
- **Verdict:** `good | marginal | poor`. If `marginal` or `poor`, downgrade or stand aside even if Pillar 1 is clean.

### Pillar 3 — Entry Model + Confirmation

State which entry model is in play *right now* (if any): **MSS**, **Trend**, **Inversion**, or **none — wait**.

- **MSS** — when LTF is turning after a sweep, in line with broader HTF narrative.
- **Trend** — when HTF + LTF are clearly in continuation.
- **Inversion** — when an opposing PD array fails in the direction of your bias.

For the chosen model, walk its components from `docs/strategy/entry-models.md` *literally, by name*. For each component: present (cite the field) or missing (state explicitly).

**MSS components (long; invert for short):**

1. Context & Draw — HTF bias clear; downside draw likely near completion.
2. Liquidity Grab — price runs below an obvious low (Asia / London / PD / swing).
3. MSS with Displacement — sharp reverse up; break of last lower high with displacement leaving a bullish FVG.
4. Retrace to Bullish FVG — pullback into FVG (ideally CE), without making a new low.
5. Entry Confirmation (1m/5m) — bullish close holding above/within the FVG; body, not doji.
6. Risk & Target — stop below MSS low or FVG low; target next internal high, then session high / HTF buy-side draw.

**Trend components (long; invert for short):**

1. Context & HTF Bias — clear HTF up-move; bullish FVGs being respected.
2. Strong Impulse Leg — wide-range up-move on LTF leaving fresh bullish FVGs.
3. Pullback into Internal FVG — orderly pullback respecting structure (higher highs / higher lows); trades into internal bullish FVG.
4. Entry Confirmation (1m/5m) — bullish close above FVG CE with displacement.
5. Risk & Target — stop below swing low touching FVG or FVG low; target next internal high, then HTF draw.

**Inversion components (bullish; invert for bearish):**

1. Context & HTF Bias — clearly bullish HTF; buy-side liquidity targets above.
2. Opposing FVG Forms — bearish FVG appears on LTF (small counter-trend imbalance).
3. Violation — price closes above the top of the bearish FVG with displacement; failed PD array becomes a bullish inversion FVG.
4. Optional Retest & Confirmation — pullback into inversion zone; bullish close from that zone (conservative). Or enter on the violation close itself (aggressive) if speed and context are exceptional.
5. Risk & Target — stop below inversion low; target next buy-side liquidity (session high / PDH / HTF high).

**Confirmation status:** `waiting | candidate | confirmed | invalidated | n/a`.

- `waiting` — model context is forming but no PD array tap yet.
- `candidate` — PD array tapped; awaiting confirmation candle close within ~10–15 minutes.
- `confirmed` — confirmation candle closed with body, displacement, no immediate messy chop.
- `invalidated` — confirmation failed (chop > 10–15 min in FVG, or structural break against the read).
- `n/a` — no model in play.

### Risk & Management (only if `confirmation_status = confirmed`)

- **Entry** — cited price.
- **Stop** — structural invalidation (cited).
- **TP1** — local liquidity (internal swing / session high or low).
- **TP2** — toward HTF draw if price/action supports continuation.
- **Invalidation** — one sentence; what specifically would invalidate the read.

### Grade

- **A+** — HTF bias clear, overnight liquidity aligned, NY reaction confirms, price quality good, entry model identified, confirmation confirmed.
- **B** — one element weaker (smaller gap, neutral overnight, marginal price quality, model present but confirmation pending, etc.).
- **no-trade** — multiple elements weak/missing OR no entry model is in play OR price quality is poor.

When in doubt, downgrade. `A+` should be rare.

## Examples (three A+ readings, one per model)

<example>
**MSS bullish reversal at HTF sell-side run**

Pillar 1:
- HTF: price trading into a large 4H bullish FVG that also swept a prior weekly low — buy-side draw above.
- Overnight: London pressed down and swept Asia Low + prior day's low in one fast push (liquidity run aligning with HTF draw).
- NY reaction: after the sweep, a strong 5m bullish displacement candle tore higher, broke above the last 5m lower high, leaving a clean 5m bullish FVG.

Pillar 2: good — wide-range displacement, no chop, clear close.

Pillar 3 — MSS:
1. Context & Draw — HTF bullish, downside draw completed by the sweep. ✓
2. Liquidity Grab — Asia low + PDL taken in one push. ✓
3. MSS with Displacement — sharp reverse up, break of last 5m lower high, fresh bullish FVG. ✓
4. Retrace to FVG — price retraced into the 5m FVG without new low. ✓
5. Confirmation — 1m full-body bullish close back above FVG CE, no lower wick. ✓
6. Risk & Target — stop ticks below MSS low; TP1 last internal high, TP2 London high, runner toward PDH.

Entry: 1m close above FVG CE.
Stop: below MSS low.
Target: TP1 last internal high; TP2 London high.

Grade: **A+** — HTF, overnight, NY reaction, price quality, model, and confirmation all align.
</example>

<example>
**Trend continuation in established uptrend**

Pillar 1:
- HTF: sustained up-move on Daily/4H respecting prior 4H bullish FVGs.
- Overnight: London produced strong displacement up, MSS up, left two bullish FVGs; NY opens above them.
- NY reaction: 5m rallies, makes new highs, leaves a fresh 5m bullish FVG. Retraces into it with small orderly red candles — no aggressive selling.

Pillar 2: good — small clean pullback within bullish structure; higher highs / higher lows intact.

Pillar 3 — Trend:
1. Context & HTF Bias — primary trend up; HTF FVGs respected. ✓
2. Strong Impulse Leg — wide-range up move, fresh 5m bullish FVG. ✓
3. Pullback into Internal FVG — orderly retrace respecting structure. ✓
4. Confirmation — 1m strong bullish close above FVG CE after small bottoming wick. ✓
5. Risk & Target — stop below local swing low / FVG low; TP1 pullback high, TP2 prior daily high.

Entry: 1m close above FVG CE.
Stop: below FVG low / local swing low.
Target: TP1 pullback high; TP2 prior daily high.

Grade: **A+** — primary trend, HTF FVG respect, clean impulse, clean pullback, decisive confirmation.
</example>

<example>
**Bullish inversion at counter-trend FVG failure**

Pillar 1:
- HTF: 4H bullish FVGs respected for days; approaching prior weekly high (main buy-side draw).
- Overnight: continued upside, no significant counter-trend break.
- NY reaction: strong rally; 5m prints a small bearish FVG as price dips on a micro pullback.

Pillar 2: good — large green candle rips back through the bearish FVG, no rejection wick, clean close above.

Pillar 3 — Inversion:
1. Context & HTF Bias — clearly bullish HTF; buy-side targets above. ✓
2. Opposing FVG Forms — small bearish FVG on the micro pullback. ✓
3. Violation — 5m green candle closes well above the top of the bearish FVG with displacement. ✓ Failed bearish FVG now an inversion zone (bullish support).
4. Retest & Confirmation — 1m pulls into inversion zone, prints full-body bullish candle rejecting from it. ✓
5. Risk & Target — stop below inversion low; TP1 intraday high, TP2 weekly high.

Entry: 1m bullish confirmation close in the inversion zone.
Stop: below inversion low.
Target: TP1 intraday high; TP2 weekly high.

Grade: **A+** — counter-trend PD array fails exactly in the direction of HTF bias; inversion zone defended with clear confirmation.
</example>

## Output template

End your response with this block, filled in. All prices must be present in the analyze JSON bundle (rule 1).

```json
{
  "pillar1": {
    "htf_bias": "bullish" | "bearish" | "neutral",
    "htf_draw": "<one-line: nearest major liquidity pool the market is drawing toward, with price>",
    "overnight": "<one-line: Asia/London takes + what's left untaken, or 'n/a'>",
    "ny_reaction": "<one-line: reaction to overnight H/L, or 'n/a — not in NY window'>"
  },
  "pillar2": {
    "range_acceptable": true | false,
    "displacement_present": true | false,
    "candle_quality": "good" | "marginal" | "poor",
    "verdict": "good" | "marginal" | "poor"
  },
  "pillar3": {
    "entry_model": "MSS" | "Trend" | "Inversion" | null,
    "confirmation_status": "waiting" | "candidate" | "confirmed" | "invalidated" | "n/a"
  },
  "trade": {
    "entry": null,
    "stop": null,
    "target_tp1": null,
    "target_tp2": null,
    "invalidation": "<one-line, or 'n/a'>"
  },
  "grade": "A+" | "B" | "no-trade"
}
```

## Constraints (also in CLAUDE.md)

- CLI only — no `mcp__tradingview__*` tools.
- 9223 only — never 9222.
- No screenshots in analysis input. `./bin/tv screenshot` exists for verifications/tests only.
- All five rules above are research-backed; see `docs/research/ai-trading-analysis.md` and `docs/research/ai-consistency.md`.
- The strategy is authoritative; see `docs/strategy/trading-strategy-2026.md` and `docs/strategy/entry-models.md`.

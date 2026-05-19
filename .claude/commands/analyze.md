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
./bin/tv analyze --out state/last-analyze.json
```

The `--out` flag writes the (often >200KB) bundle to disk and prints only the file path to stdout. This is required because the bundle exceeds Bash output truncation limits when multi-TF Pine is included. After the command returns, use the `Read` tool on `state/last-analyze.json` to load the bundle into context.

(For interactive debugging without the file step, `./bin/tv analyze` still prints the full bundle to stdout, but it will be truncated for any non-trivial bundle. Always use `--out` from inside `/analyze`.)

The bundle is a single JSON object with:

- `chart` — symbol, timeframe, indicators on chart
- `visible_range` / `bars.period` — currently-visible date range
- `quote` — last price snapshot
- `bars` — OHLCV summary + `last_5_bars` at the chart's *current* timeframe
- `bars_by_tf` — OHLCV summaries at multiple resolutions: `daily` (D), `h4` (240), `h1` (60), `m15` (15), `m5` (5), `m1` (1). Each entry has `{bar_count, period, range, change_pct, open, close, high, low, avg_volume, last_5_bars, tv_resolution}`. Use these for Pillar 1a HTF bias (compare `bars_by_tf.daily.change_pct` and `.h4.change_pct`) and Pillar 2 HTF displacement. Cite as e.g. `29302 (bars_by_tf.m1.open)`, `29709 (bars_by_tf.m15.open)`. If a TF errored, that key has `{error, tv_resolution}` only.
- `pine_by_tf` — Pine **boxes + labels** at each resolution (`daily / h4 / h1 / m15 / m5 / m1`), trimmed to the four tracked studies (FVG/iFVG, Anchored Structures, Killzones, BPR) and capped at ~30 most-recent entries per study per TF. This is where **HTF FVGs and HTF structure points** live — the strategy's "scan Daily/4H/1H for best imbalances" runs against these. Each entry: `{tv_resolution, boxes: { studies[].{ name, total_boxes, showing, all_boxes[] } }, labels: { studies[].{ name, total_labels, showing, labels[] } }}`. Box entries include verbose fields `{id, high, low, x1, x2, borderColor, bgColor}` — `bgColor` decodes to FVG direction via the same ABGR mapping as `gates.pillar3.fvg_by_type` (bullish_fvg 0x94ab22, bullish_ifvg 0xf57931, bearish_fvg 0x5f52f7, bearish_ifvg 0x26a7ff). Label entries include `{id, text, price, x, textColor}`. Cite as `29513.25 (pine_by_tf.h4.boxes.studies[0].all_boxes[0].high)`.
- `indicators` — data-window numeric values
- `pine.lines` — horizontal price levels (PDH/PDL, swing levels, equal highs/lows, session highs/lows) — *current TF only*
- `pine.labels` — text annotations with prices (bias readouts, level names) — *current TF only*
- `pine.tables` — table data (session stats, analytics dashboards) — *current TF only*
- `pine.boxes` — price zones (FVGs, order blocks, killzone boxes, ranges) — *current TF only*
- `gates` — deterministic facts computed in code (not LLM-judged). Read these FIRST and don't recompute them:
  - `gates.session.{label, in_ny_open_window, in_killzone, in_killzone_detail, is_weekend, is_market_closed, timestamp_et, replay}` — what session is active right now, clock-based. `label` ∈ `{NY Open, NY AM, NY PM, London Open, Asia, Inter-session, Closed}`. `is_market_closed` = true on Sat, Fri after 17:00 ET, Sun before 18:00 ET, and the daily 17:00–18:00 ET futures-settlement break. `replay.{active, autoplay, current_date}` — when `replay.active = true`, the bundle reflects a HISTORICAL chart state, NOT live data; the analyzer's verdict should be treated as a fixture exercise, not live trading guidance.
  - `gates.price_context.{last, inside_boxes[]}` — which pine boxes contain current price.
  - `gates.pillar1.session_levels.{PWH, PWL, PDH, PDL, AS_H, AS_L, LO_H, LO_L, NYAM_H, NYAM_L, NYPM_H, NYPM_L}` — each is `{label, price, position_vs_price, taken}`. The chart's original label text (e.g. `AS.H`) is preserved in `.label`; the JSON key uses underscore form (`AS_H`) so it's citation-safe. `taken` is true if `bars.high > price` for highs or `bars.low < price` for lows.
  - `gates.pillar1.untaken_sell_side_below[]` and `gates.pillar1.untaken_buy_side_above[]` — sorted arrays of session levels that have NOT been taken yet. These are the strategy's "draw" targets per §2.2 ("which liquidity remains untaken").
  - `gates.pillar1.bias_labels[]` — any Pine label whose text matches `/bias/i` (e.g. "Bias Long", "Bias Short"). Empty array if no indicator publishes them; treat HTF bias as inferred from `bars_by_tf` + session-level structure in that case.
  - `gates.pillar2.{range_value, range_per_bar, range_acceptable, avg_body_ratio_last_5, candle_quality_heuristic}` — mechanical range + current-TF candle metrics.
  - `gates.pillar2.current_tf.{body_ratios_last_5, avg_body_ratio_last_5, candle_quality_heuristic, engulfing_count_last_5, doji_count_last_5, last_bar}` — full current-TF stats. Same shape under `gates.pillar2.m5.*` (5m bars) and `gates.pillar2.m15.*` (15m bars) — the strategy-aligned TFs for Pillar 2 candle anatomy. The `last_bar` sub-object has the same shape as `gates.pillar3.last_bar` (`{time, open, high, low, close, body_ratio, direction, range, close_position_in_range}`) but for the most-recent bar at that specific TF — used for evaluating 1m vs 5m vs 15m confirmation closes per strategy §5.
  - `gates.pillar3.most_recent_structure.{ST_HH, ST_HL, ST_LH, ST_LL, IT_HH, IT_HL, IT_LH, IT_LL, LT_HH, LT_HL, LT_LH, LT_LL}` — each is `{label, price, x}`. `x` is the Pine bar-index — *higher x = more recent*. Sort across keys by `x` to find the most-recent structural point overall, which tells you the current LTF structure state.
  - `gates.pillar3.fvg_by_type{,_above,_below}` — counts of FVGs by direction: `bullish_fvg`, `bullish_ifvg`, `bearish_fvg`, `bearish_ifvg` (decoded from the indicator's bgColor). `_above` = boxes wholly above current price (potential resistance), `_below` = wholly below (potential support).
  - `gates.pillar3.last_bar` — single-bar confirmation facts for the most recent bar: `{time, open, high, low, close, body_ratio, direction, range, close_position_in_range}`. `direction` is `bullish | bearish | doji`. `close_position_in_range` is 0 = closed at the low, 1 = closed at the high, 0.5 = midpoint — a fast read on whether the bar closed STRONG in its direction (>0.7 bull / <0.3 bear) or WEAK / rejected. `body_ratio` is the single-bar version of Pillar 2's 5-bar avg.
  - `gates.pillar3.last_bar_age_seconds` — `quote.time - last_bar.time`. Tiny value = bar just closed / live; large value = data is stale (market closed or chart paused).
  - Numeric gate fields can be cited under rule 1 just like any other JSON value (e.g. `29089.5 (gates.pillar1.session_levels.NYAM_L.price)` or `29160 (gates.pillar3.most_recent_structure.ST_LL.price)`). Boolean/string gates are referenced inline ("gates.session.in_ny_open_window = false") and don't need verifier-style citation.

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
First check `gates.pillar1.bias_labels[]`. If non-empty, the chart publishes explicit Bias readouts — cite them directly and use as HTF bias. If empty (current state), *infer* HTF bias from `bars_by_tf.daily / .h4 / .h1` by comparing `change_pct` across the three HTF resolutions — agreement = directional bias; mixed signs = no clear HTF bias. Cite e.g. `25916.75 (bars_by_tf.daily.open)`, `29231.75 (bars_by_tf.daily.close)`.

For the **HTF PD arrays** the strategy actually trades around, read `pine_by_tf.daily.boxes`, `pine_by_tf.h4.boxes`, `pine_by_tf.h1.boxes`. Filter to the FVG/iFVG study to identify HTF FVGs (decode `bgColor` to direction); filter to Anchored Structures to see HTF swing zones. Pick the most material HTF FVG (large size, recent x1, opposite to current price for a retrace target) as the "primary HTF draw." Cite as e.g. `29513.25 (pine_by_tf.h4.boxes.studies[0].all_boxes[0].high)`.

The strategy's "main HTF draw" is the intersection of: HTF direction (from bars_by_tf) + nearest untaken session level (from `gates.pillar1.untaken_*`) + nearest material HTF FVG (from `pine_by_tf.*.boxes`). State it explicitly.

**b. Overnight & Session Correlation.**
Read `gates.pillar1.session_levels.*` and the two pre-sorted arrays `gates.pillar1.untaken_sell_side_below` / `untaken_buy_side_above`. Cite each level you reference by its safe key (e.g. `29089.5 (gates.pillar1.session_levels.NYAM_L.price)`). State which liquidity is `taken` and which remains untaken — the untaken pools are the strategy's "draw" per §2.2. State whether overnight is *extending* the HTF move (lots of taken levels on one side) or *consolidating* (mixed). If `PWH` / `PWL` are null, note that weekly markers aren't published on this chart resolution.

**c. NY Open LTF Bias.**
Read `gates.session.in_ny_open_window` and `gates.session.label`. If `in_ny_open_window = false` (or `label ∈ {Asia, Inter-session, NY PM, Closed}`), write `n/a — not in NY open window (gates.session.label = <label>)`. If `is_market_closed = true`, market is closed entirely (Sat / Sun pre-18:00 / Fri post-17:00 / daily break) — no live action to read; expect stale data. If `in_ny_open_window = true`, describe the reaction to overnight high/low: break + rejection in the direction of the HTF draw = LTF aligns with HTF (A+ potential). Break + continuation *against* the HTF draw = today is a retrace day; adapt intraday bias accordingly but keep the HTF draw for later. Never marry the HTF bias.

### Pillar 2 — Price Action Quality

Strategy §7 step 3 asks for three checks: 3-hour range, HTF (4H/1H) displacement, and **5m/15m candle anatomy** (NOT whichever TF the chart is on). The gates reflect that:

- **Range.** Cite `gates.pillar2.range_value` and `gates.pillar2.range_per_bar`. `range_acceptable` heuristic; override if you disagree.
- **Displacement on HTF.** Read `bars_by_tf.h4.range` + `change_pct` and `bars_by_tf.h1.range` + `change_pct`. Large clean range with strong directional close = displacement present. Choppy `change_pct` near zero with non-trivial range = consolidation.
- **5m candle anatomy.** Read `gates.pillar2.m5.{body_ratios_last_5, avg_body_ratio_last_5, candle_quality_heuristic, engulfing_count_last_5, doji_count_last_5}`. The strategy wants "mainly engulfing, not dominated by dojis" — interpret as: at least ~2 engulfings out of 4 transitions, doji_count ≤ 1.
- **15m candle anatomy.** Same fields under `gates.pillar2.m15.*`.
- **Current-TF stats** (`gates.pillar2.avg_body_ratio_last_5`, `gates.pillar2.candle_quality_heuristic`, `gates.pillar2.current_tf.*`) are a live LTF gauge — useful when chart is on 1m/3m as a "what's happening *right now*" read — but **do not use them in place of m5/m15** for the Pillar 2 verdict.
- **Verdict.** `good | marginal | poor`. Synthesize from m5 and m15 stats together. If `marginal` or `poor` on either, downgrade or stand aside even if Pillar 1 is clean.

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

When walking the components, leverage:

- `gates.price_context.inside_boxes` — which Pine boxes contain price right now (do not enumerate `pine.boxes.studies[*].zones[*]` manually).
- `gates.pillar3.most_recent_structure.*` — the most recent labeled swing point of each kind, sorted by `x` (Pine bar-index). For MSS detection: find the structure point with the highest `x` overall (the freshest event), then check whether subsequent bars closed beyond the appropriate threshold. E.g. if the most-recent label is `ST_LL` and price subsequently closed above the most-recent `ST_LH`, that's an MSS up.
- `gates.pillar3.fvg_by_type_above` / `fvg_by_type_below` — counts of FVGs by direction relative to current price. **Bullish IFVG below** = a bearish FVG that was violated bullish-ly; now acts as bullish support. **Bearish IFVG above** = a bullish FVG that was violated bearish-ly; now acts as bearish resistance. Use these counts to assess overhead supply vs underneath demand, and to identify Inversion-model candidates.

For the **confirmation candle** check, the strategy allows 1m OR 5m close (§5 / §7 step 6 / each entry model's "Entry Confirmation (1m/5m)"). Read the per-TF `last_bar` gates:

- **1m close** — `gates.pillar3.last_bar` (current-TF, identical to `gates.pillar2.current_tf.last_bar` when chart is on 1m).
- **5m close** — `gates.pillar2.m5.last_bar`. This is the strategy-aligned 5m confirmation source.
- **15m fallback** — `gates.pillar2.m15.last_bar`. Available but rarely used per strategy; the A+ examples in `entry-models.md` all show 1m precision-timed entries.

Per-bar fields each `last_bar` exposes: `{time, open, high, low, close, body_ratio, direction, range, close_position_in_range}`.

A clean confirmation candle has: `direction` matching the setup, `body_ratio >= 0.6`, and `close_position_in_range` on the favorable side (>0.7 for bullish, <0.3 for bearish). For MSS / Trend the close must also be ABOVE the watched FVG midpoint; for Inversion the close must be back FROM the inversion zone (cross-reference against `pine.boxes` or `pine_by_tf.*.boxes` for the relevant TF). Use `gates.pillar3.last_bar_age_seconds` to sanity-check live-ness on the 1m feed; if it's much larger than the chart's bar interval, the data is stale.

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

## Watchman briefing (write this file before ending the response)

After the structured-output block above, use the `Write` tool to save a watchman briefing to `state/watch/briefing.json`. This is the handoff that lets `./bin/tv watch` start polling Pillar 3 — strategy §7 is sequential, so the watchman REQUIRES this file and a `verdict: ready` before it fires any alerts.

The briefing's `stage` reflects what's known at grading time. Strategy §2.3: "wait the first 15–30 minutes of NY to see the reaction". User's chosen cadence: grade twice, at 09:30 ET (pre-reaction, stage 1) and 09:45 ET (post-reaction, stage 2). Same for NY PM at 13:30 / 13:45 ET. London Open / Asia: single grade at session open.

Schema:

```json
{
  "ts": "<ISO 8601 with TZ>",
  "stage": "stage_1_pre_reaction" | "stage_2_post_reaction" | "single",
  "session": "NY AM" | "NY PM" | "London Open" | "Asia",
  "symbol": "<from chart.symbol>",
  "pillar1": {
    "htf_bias": "bullish" | "bearish" | "neutral",
    "htf_draw": "<one-line, with cited price>",
    "overnight": "<one-line>",
    "ny_reaction": "<one-line or 'pending' (stage 1) or 'n/a'>"
  },
  "pillar2": {
    "verdict": "good" | "marginal" | "poor"
  },
  "verdict": "ready" | "pending" | "stand_aside",
  "watchman_directive": {
    "active": true | false,
    "side": "long" | "short" | "both",
    "priority_zones": [
      {
        "study": "<exact study name from the bundle, e.g. 'FVG/iFVG (Nephew_Sam_)'>",
        "high": <number>,
        "low": <number>,
        "direction": "bullish_fvg" | "bullish_ifvg" | "bearish_fvg" | "bearish_ifvg" | "unknown",
        "rationale": "<one-line on why this zone matters for the bias>"
      }
    ]
  },
  "grade": "A+" | "B" | "no-trade"
}
```

Rules:
- **`verdict: ready`** ONLY in stage 2 (or single-grade sessions) with `pillar1.htf_bias != neutral` AND `pillar2.verdict != poor` AND a clear NY reaction (or n/a for non-NY sessions). Otherwise `pending` (stage 1, still waiting) or `stand_aside`.
- **`watchman_directive.active: true`** only if `verdict: ready`. Otherwise `false` — watchman won't run.
- **`watchman_directive.side`** matches `pillar1.htf_bias`: bullish → long, bearish → short, neutral → both (rare; usually means stand_aside).
- **`priority_zones`** are the specific FVG/iFVG/BPR zones from the bundle that the watchman should fire on. Pick zones aligned with bias direction (a bullish bias watches bullish FVGs being retested OR bearish FVGs being broken through; same logic inverted for bearish). Maximum 6 zones — focus, don't dump everything. Use exact `high` and `low` values from `pine.boxes` or `pine_by_tf.*` so the watchman can match against `gates.price_context.wick_tapped_boxes`.
- **No invented zones.** Each `high`/`low` must appear in the bundle.

## Constraints (also in CLAUDE.md)

- CLI only — no `mcp__tradingview__*` tools.
- 9223 only — never 9222.
- No screenshots in analysis input. `./bin/tv screenshot` exists for verifications/tests only.
- All five rules above are research-backed; see `docs/research/ai-trading-analysis.md` and `docs/research/ai-consistency.md`.
- The strategy is authoritative; see `docs/strategy/trading-strategy-2026.md` and `docs/strategy/entry-models.md`.

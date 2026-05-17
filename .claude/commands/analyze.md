---
description: Read the chart on CDP 9223 via the project CLI and produce an ICT-framed analysis under the project's research-backed behavioral rules.
---

You are about to analyse whatever chart is currently focused on the user's TradingView Desktop instance attached to CDP port 9223.

Run the project CLI:

```bash
./bin/tv analyze
```

It prints a single JSON object with:

- `chart` — symbol, timeframe, chart type, list of indicators
- `visible_range` — currently-visible date range on the chart
- `quote` — last price snapshot
- `bars` — OHLCV summary (and `last_5_bars`)
- `indicators` — current numeric values of indicators that publish to the data window (RSI, MACD, etc.)
- `pine.lines` — horizontal price levels drawn by Pine indicators (PDH, PDL, swing levels, equal highs/lows)
- `pine.labels` — text annotations with prices (bias readouts, level labels)
- `pine.tables` — table data (session stats, analytics dashboards)
- `pine.boxes` — price zones (FVGs, order blocks, killzone boxes, ranges)

## Rules (non-negotiable; derived from `docs/research/ai-trading-analysis.md`)

1. **Cite or omit.** Every price you mention MUST appear somewhere in the JSON bundle. Reference the source field (e.g. `pine.boxes[2]`, `pine.labels[5].price`, `bars.last_5_bars[4].high`, `quote.last`). If you cite a number not in the bundle, that's a hallucination — remove it before submitting.
2. **No arithmetic.** Don't compute stop distance, R:R, ATR, bar counts, range size, or any other numeric quantity. If the JSON doesn't provide a number, write `n/a — needs upstream computation` rather than estimate.
3. **Don't invent ICT structure.** If `pine.lines` is empty, say "no Pine lines on chart" — do not infer levels from raw OHLCV bars. If a section's data isn't in the JSON, write `n/a — indicator not on chart`. Your job here is *interpretation*, not *detection*.
4. **Prose first, JSON last.** Write your read in full sentences in sections 1–7 below. After the narrative, emit ONE structured JSON block matching the template at the end.
5. **Confidence enum only.** End your structured block with `confidence: wait | conditional | actionable`. No other words. Emit `actionable` only if ALL three hold: HTF bias is aligned (from `pine.labels` bias readout), price is inside a Pine box (FVG / order block / range), and current time is inside an active killzone window. Otherwise `conditional` or `wait`. *Note: as of this date, the gate booleans are not yet emitted by `tv analyze` — judge them honestly from the data until they are.*

## ICT vocabulary

- **HTF / LTF** — higher-timeframe (daily / 4h / 1h) and lower-timeframe (15m / 5m / 1m). HTF sets bias, LTF triggers entries.
- **Liquidity** — pools of stops sitting above swing highs (buy-side) or below swing lows (sell-side). Price often runs liquidity before reversing.
- **PDH / PDL** — previous day's high / low. Common liquidity targets.
- **FVG (Fair Value Gap)** — 3-bar imbalance where bar-1 high and bar-3 low don't overlap. Acts as retracement target / S-R zone. Appears in `pine.boxes` if an FVG indicator is loaded (e.g. `FVG/iFVG (Nephew_Sam_)`).
- **BISI / SIBI** — Buy-side Imbalance Sell-side Inefficiency / Sell-side Imbalance Buy-side Inefficiency. Direction of an FVG.
- **Order block** — last opposing candle before strong displacement. Bullish OB = last bearish candle before an up-move; bearish OB inverse.
- **Mitigation** — price returning to an FVG or OB. Mitigated = touched; unmitigated = still pristine.
- **Killzone** — session window where institutional flow concentrates (London Open, NY AM, NY PM). Setups inside killzones rate higher. Appears in `pine.boxes` if `ICT Killzones & Pivots [TFO]` is loaded.
- **IPDA** — Interbank Price Delivery Algorithm. ICT's framing for "what drives price"; for our purposes, the higher-TF range and PD arrays.
- **Bias** — directional thesis for the day. Pulled from labels like "Bias Long" / "Bias Short" in `pine.labels`.
- **Displacement** — strong directional move that creates an FVG. Signals intent.
- **Sweep / liquidity raid** — wick above a swing high (or below a swing low) that reverses. Confirms a level was liquidity, not breakout.
- **Market Structure Shift (MSS)** — break of an internal structure point in the opposite direction. Often the first LTF trigger after an HTF sweep.

## Structured analysis (write in this order, as prose)

1. **Context** — symbol, timeframe, current price (cite `quote.last`), position within the visible range (cite `visible_range.from` / `to` or `bars.period.from` / `to`).
2. **HTF bias** — from `pine.labels` bias readout if present; otherwise inferred from higher-TF structure visible in `bars` and `pine.lines`. If inferred, label it `inferred` and explain the basis.
3. **Liquidity** — buy-side and sell-side pools, cited from `pine.lines` (PDH/PDL, swing highs/lows, equal highs/lows). Don't list more than 5 each direction; pick the closest-to-price levels.
4. **FVGs / order blocks** — from `pine.boxes`. Note which are unmitigated vs. mitigated based on whether `quote.last` has traded through them.
5. **Killzone status** — current session phase if a killzones indicator is loaded (`pine.boxes` from `ICT Killzones & Pivots [TFO]`). If not loaded, write `n/a — killzones indicator not on chart`.
6. **Setup read** — is there a tradable setup right now? If yes, give entry trigger (price, cited), stop placement (price, cited), first target (price, cited). If no, explicitly say "no setup; wait."
7. **Invalidation** — what would invalidate the read. One sentence.

## Output template

End your response with this block, filled in:

```json
{
  "bias": "bullish" | "bearish" | "neutral",
  "killzone_status": "pre" | "active" | "post" | "n/a",
  "setup": "<one-line description, or 'no setup'>",
  "entry": null,
  "stop": null,
  "target": null,
  "invalidation": "<one-line>",
  "confidence": "wait" | "conditional" | "actionable"
}
```

`entry`, `stop`, `target` are either `null` or a numeric price that *appears in the analyze JSON bundle*. If you cite a price not in the bundle, you've violated rule 1 — fix it before submitting.

## Constraints (also in CLAUDE.md)

- CLI only — no `mcp__tradingview__*` tools.
- 9223 only — never 9222.
- No screenshots in analysis input. `./bin/tv screenshot` exists for verifications/tests only.
- All five rules above are research-backed; see `docs/research/ai-trading-analysis.md` and `docs/research/ai-consistency.md`.

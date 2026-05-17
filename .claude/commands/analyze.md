---
description: Read the chart on CDP 9223 via the project CLI and produce an ICT-framed analysis.
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
- `bars` — OHLCV summary
- `indicators` — current numeric values of every visible indicator (RSI, MACD, EMAs, etc.)
- `pine.lines` — horizontal price levels drawn by Pine indicators (PDH, PDL, swing levels, equal highs/lows, etc.)
- `pine.labels` — text annotations with prices (bias readouts, level labels)
- `pine.tables` — table data (session stats, analytics dashboards)
- `pine.boxes` — price zones (FVGs, order blocks, ranges)

Read the JSON, then write a structured ICT-framed analysis covering, in order:

1. **Context** — symbol, timeframe, current price, position within the visible range.
2. **HTF bias** — from the HTF Pine labels/lines (e.g. "Bias Long" / "Bias Short") if present; otherwise inferred from higher-TF structure in the data.
3. **Liquidity** — buy-side and sell-side pools, from Pine `lines` (PDH/PDL, swing highs/lows, equal highs/lows).
4. **FVGs / order blocks** — from `pine.boxes`. Note which are unmitigated vs. mitigated.
5. **Killzone status** — current session phase if a killzones indicator is loaded.
6. **Setup read** — is there a tradable setup right now? If yes, give entry trigger, stop placement, first target. If no, explicitly say "no setup; wait."
7. **Invalidation** — what would invalidate the read.

If a section's data is not present in the JSON, write `n/a — indicator not on chart` and move on. Do not invent ICT levels that aren't in the Pine output.

Constraints:

- Use only `./bin/tv` commands. Do NOT use any `mcp__tradingview__*` tool — this project is CLI-only.
- Do not write to `~/.tradingview-mcp/`. Project state lives under `./state/`.
- Screenshots from `./bin/tv screenshot` are for verifications/tests only, not analysis input.

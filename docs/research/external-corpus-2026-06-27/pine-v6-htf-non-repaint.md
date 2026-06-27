# Pine v6 — non-repainting HTF data (engine correctness note)

From the TradingView Pine v6 docs (context7). Relevant to `pine/ict-engine.pine` if it
ever pulls higher-timeframe series in-Pine.

## The rule

Any `request.security()` for a **higher** timeframe repaints on the realtime bar unless
you both (a) reference a **confirmed** value (`close[1]`, not `close`) and (b) pass
`lookahead = barmerge.lookahead_on`. This returns data up to one HTF bar late but never
changes after the fact — identical on historical and realtime bars.

```pine
//@version=6
// non-repainting daily close on an intraday chart
float dailyClose = request.security(syminfo.tickerid, "1D", close[1], lookahead = barmerge.lookahead_on)
// guard against running on a chart TF >= the requested TF
if timeframe.in_seconds() >= timeframe.in_seconds("1D")
    runtime.error("Chart timeframe must be less than 1D.")
```

The same pattern with the generic multiplier helper:

```pine
string tf = timeframe.from_seconds(timeframe.in_seconds() * mult)
float htf = request.security(syminfo.tickerid, tf, ta.wma(close, len)[1], lookahead = barmerge.lookahead_on)
```

## Why it matters for us (and why we mostly sidestep it today)

- Our engine emits **per-chart-TF** and the CLI **switches the chart** across TFs
  (`captureMultiTf` / `tf-capture.js`) to assemble `engine_by_tf` — so the live HTF read
  is the engine recomputed on the actual HTF chart, not an in-Pine `request.security`.
  That avoids the repaint class entirely.
- The note matters if we ever add in-Pine HTF series (e.g. an HTF FVG overlaid on the LTF
  chart). If so: confirmed value + `lookahead_on`, or the live bar will lie.
- It's also a useful audit lens for any third-party ICT indicator we compare against —
  many repaint their HTF zones, which makes their backtest look better than live.

## Source
[TradingView Pine docs — other timeframes & data](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data) ·
[repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting)

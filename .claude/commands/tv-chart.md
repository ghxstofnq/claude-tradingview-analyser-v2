# /tv-chart — change symbol / timeframe / session reliably (verified, fail-closed)

Switch the analysis chart (TV Desktop, CDP 9225) without the silent races that fold the wrong
symbol's or wrong TF's bars into a bundle. All via `packages/core/chart.js` + `cli/lib/tf-capture.js`.

## Symbol
- `chart.setSymbol({symbol})` then `waitForChartReady(symbol)` — polls until symbol + resolution
  match AND bar-count is stable across two reads (mid-switch the series briefly holds the old
  TF's bars; pacing prevents the accumulating-corruption wedge).
- **Pairs (MES + MNQ): fail closed.** After capture, assert the bundle's `quote.symbol` /
  `chart.symbol()` equals the requested bare symbol; throw `symbol_mismatch` rather than fold the
  wrong symbol's bars (the 2026-06-12 MES-under-MNQ hijack). `chart.symbol()` is exchange-prefixed
  (`CME_MINI:MNQ1!`) — strip `^[A-Z_]+:` before comparing.

## Timeframe
- `chart.setTimeframe({timeframe})` then verify the engine re-emitted at that TF:
  `tfMatchesMeta(tv, engine.meta.tf)` (daily emits `1D` for `D`; minute resolutions match directly).
- Never trust a fixed-sleep single read after a TF switch — the engine re-render lags and you'll
  record the previous TF's table.

## Extended hours (ETH)
- `chart.setExtendedHours(true)` — sets the main series `sessionId` to "extended"; **idempotent**
  (reads current first, only writes — which reloads bars — when it differs). Required so overnight
  Asia/London bars exist. `chart.getState().session` surfaces the current value.

## Multi-TF capture (the whole sweep)
- `captureMultiTfWithHealth({tfs, originalTf, deps})` — accepts a per-TF read ONLY when
  `meta.tf` matches the request, retries failed TFs once, and emits `capture_health`
  (`{ok, missing[], by_tf}`) so "no data" is a first-class state, not a silent null. Falls back to
  a saved baseline (age-capped) for still-missing TFs.
- The engine runs on **Daily / 4H / 1H / 30m / 15m / 5m / 1m**.

## Notes
- The analysis chart is TV Desktop on 9225 — never drive the in-app 9223 webview for analysis
  (that's the user's display surface; CLAUDE.md constraint #1).
- After any change, /tv-health confirms the right engine is still live.

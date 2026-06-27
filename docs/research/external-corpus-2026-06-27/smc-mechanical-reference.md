# SMC mechanical reference — `joshyattridge/smart-money-concepts` vs our engine

The most-used open-source Python ICT library (MIT, ~pip `smartmoneyconcepts`). A clean,
deterministic cross-check for our Pine `ict-engine.pine` + walker detection. Raw source:
[`smc-source-reference.py`](smc-source-reference.py) (987 lines). Upstream:
[github.com/joshyattridge/smart-money-concepts](https://github.com/joshyattridge/smart-money-concepts).

Public functions: `fvg`, `swing_highs_lows`, `bos_choch`, `ob`, `liquidity`,
`previous_high_low`, `sessions`, `retracements`.

## Algorithm notes (verified against the source)

### `fvg(ohlc, join_consecutive=False)`
- **3-candle** gap, direction taken from the **middle candle's body**:
  - bullish: `high[-1] < low[+1]` AND middle `close > open` → top=`low[+1]`, bottom=`high[-1]`
  - bearish: `low[-1] > high[+1]` AND middle `close < open`
- Mitigation: first later candle (from `i+2`) whose wick re-enters the gap edge.
- `join_consecutive` merges stacked same-direction FVGs into one (max top / min bottom).
- **vs us:** our engine adds displacement scoring, took-liquidity, lifecycle state
  (fresh/tapped/inverted/invalidated), CE, size-quality — a **strict superset**. SMC's
  value here is the dead-simple baseline definition + the `join_consecutive` idea
  (we currently keep stacked FVGs separate; merging could de-noise the walker spawn set).

### `swing_highs_lows(ohlc, swing_length=50)`
- Pivot = highest high / lowest low across `swing_length` candles **before and after**
  (fractal). Then a dedup pass removes consecutive same-type pivots, keeping the extreme.
- **vs us:** the engine's swing tier is similar (confirmed pivots). Note SMC's default
  `swing_length=50` is large; ours is tighter. The **dedup-consecutive** pass is a good
  reference for keeping one pivot per leg.

### `bos_choch(ohlc, swing_highs_lows, close_break=True)`
- BOS = continuation break of the prior swing in trend; **CHoCH = first break against**
  the established swing sequence (= our MSS/change-of-character). Computed off confirmed
  swings, not raw sweeps.
- **vs us / gap #3:** this is the stricter structural definition the source-of-truth
  wants for the **MSS significance gate** — a CHoCH is "break of a real swing pivot,"
  not "any rejected sweep." Useful to compare against our `structure_event` logic.

### `liquidity(ohlc, swing_highs_lows, range_percent=0.01)`
- Clusters swing highs (or lows) that sit **within `range_percent` (default 1%) of the
  chart's total H-L range** of each other → an equal-highs / equal-lows pool. Records the
  pool level, its extent, and the **swept** candle (first bar to exceed the range).
- **vs us:** concrete recipe for equal-high/low **liquidity-pool** detection. Our engine
  emits `liquidity_pools` already; SMC's `range_percent` clustering is a clean tunable if
  we want to tighten/loosen pool grouping. Directly relevant to draw-target selection
  (strategy §2.1).

### `sessions(ohlc, session, start_time, end_time, time_zone="UTC")`
- Tags bars inside a session window + tracks that session's high/low. Same idea as our
  session levels (AS/LO/NYAM/NYPM) — confirms our approach is standard.

### `retracements(ohlc, swing_highs_lows)`
- Current retracement % between the last two swings (the OTE/fib leg). The CTI daily-bias
  guide pairs this with **62–79% OTE** entries — matches our retrace logic.

## What's reusable

1. **`join_consecutive` FVG merge** — candidate de-noiser for walker spawns (fold-test).
2. **`bos_choch` CHoCH definition** — reference for the stricter MSS significance gate (gap #3).
3. **`liquidity` `range_percent` clustering** — tunable for equal-high/low pool detection.
4. Nothing here is ahead of our engine on lifecycle/displacement; it's a **baseline +
   cross-check**, not a replacement. Our Pine engine is a strict superset on FVG/BPR.

## License
Upstream is MIT — algorithms can be referenced/ported with attribution.

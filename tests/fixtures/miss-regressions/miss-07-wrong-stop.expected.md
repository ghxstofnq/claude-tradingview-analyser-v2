# miss-07: stop_options[0] is candle 1 low when bars + FVG present

This bundle has all 3 FVG formation candles in bars_by_tf.m5.last_5_bars. Candle 1 low (29981.25) is 1pt below the swing low pivot (29982.25). The original miss had the model picking a wider FVG-bottom stop (29992.5) instead of the candle-1 stop.

Detector requirements:

- `best_candidate.stop_options[0].kind` MUST be `"fvg_candle1_low"`.
- `best_candidate.stop_options[0].value` MUST be 29981.25.
- swing_pivot at 29982.25 comes second; fvg_bottom (29992.5) third.

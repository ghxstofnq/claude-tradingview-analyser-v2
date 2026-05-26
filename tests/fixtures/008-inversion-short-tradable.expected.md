# Fixture 008: Inversion-short tradable

Detector should emit:

- `best_candidate.model: "Inversion"` (fresh ifvg + tap_into_ifvg present)
- `best_candidate.side: "short"`
- `best_candidate.grade_proposed: "A+"` (all 5 components + clean displacement)
- `best_candidate.tradable: true`
- `best_candidate.stop_options[0].kind: "fvg_candle3_high"` (candle 3 of the original FVG)

Cited values:

- 29995.5 (quote.last)
- 30007 (engine_by_tf.m5.fvgs[0].top)
- 29950 (brief_digest.symbols.MNQ1!.pillar1.untaken_pools_below[0].price)
- 29880 (brief_digest.symbols.MNQ1!.pillar1.untaken_pools_below[1].price)

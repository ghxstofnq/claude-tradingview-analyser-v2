# Fixture 006: MSS-bull tradable

Detector should emit:

- `best_candidate.model: "MSS"`
- `best_candidate.side: "long"`
- `best_candidate.grade_proposed: "A+"` (all 6 components + clean displacement)
- `best_candidate.grade_capped: "A+"` (no caps applied in this fixture)
- `best_candidate.tradable: true`
- `best_candidate.stop_options[0].kind: "fvg_candle1_low"` (first structure candle of the 3-candle FVG formation)
- `best_candidate.tp1` cites the first entry in `untaken_above[]` (29998.5 ← 30015)
- `best_candidate.tp2` cites the second entry (29998.5 ← 30119)

Cited values (price (json.path)):

- 29998.5 (quote.last)
- 29992.5 (engine_by_tf.m5.fvgs[0].bottom)
- 30015 (brief_digest.symbols.MNQ1!.pillar1.untaken_pools_above[0].price)
- 30119 (brief_digest.symbols.MNQ1!.pillar1.untaken_pools_above[1].price)
- 29982.25 (gates.engine.pillar1.sweeps[0].price)

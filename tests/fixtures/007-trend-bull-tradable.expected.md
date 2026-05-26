# Fixture 007: Trend-bull tradable

Detector should emit:

- `best_candidate.model: "Trend"` (BoS in direction, no MSS failure swing)
- `best_candidate.side: "long"`
- `best_candidate.grade_proposed: "A+"` (all 5 components + clean displacement)
- `best_candidate.tradable: true`

Cited values:

- 29998.5 (quote.last)
- 29992.5 (engine_by_tf.m5.fvgs[0].bottom)
- 30015 (brief_digest.symbols.MNQ1!.pillar1.untaken_pools_above[0].price)
- 30002.25 (gates.engine.pillar3.most_recent_structure.level)

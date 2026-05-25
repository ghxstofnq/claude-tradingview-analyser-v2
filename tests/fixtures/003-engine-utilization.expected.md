# 003 — engine-utilization fixture

**Purpose:** smoke-test that every new gate field introduced by the 2026-05-26
ICT-engine-utilization PR resolves as a citation under
`scripts/verify-citations.js`. **Not** a graded analysis — this fixture exists
solely so the citation verifier exercises the new JSON paths.

**Captured:** live MES1! 1m, asia session, no trade.

---

## Bundle provenance

The engine emitted at 7545.5 (quote.last) with a Wilder ATR of 1.5
(gates.engine.pillar2.current_tf.atr_17) and the 14-period equivalent at 1.5
(gates.engine.pillar2.current_tf.atr_14). The engine self-tagged its session as
asia (gates.engine.meta.engine_session); cross-check with the clock-derived
`gates.session.phase` is left to the LLM.

## FVG ranking

Top-ranked FVG by the new `fvgs_ranked` ordering centres at 7546.5
(gates.engine.pillar3.fvgs_ranked[0].ce) with a displacement score of 0.9
(gates.engine.pillar3.fvgs_ranked[0].disp_score).

## Proximity

Nearest opposing FVG above current price has its CE at 7546.5
(gates.engine.price_context.nearest_opposing_fvg_above.ce). Signed distance
to that CE is -1 (gates.engine.price_context.nearest_opposing_fvg_above.distance_to_ce).

## Failure-swing pool

The engine flagged a failure-swing MSS at 7557
(gates.engine.pillar3.failure_swings[0].level).

## Liquidity pools

The closest untaken EQL below price sits at 7356
(gates.engine.pillar1.untaken_pools_below[0].price).

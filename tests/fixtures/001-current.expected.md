# Fixture 001 — Expected Analysis (seed, Claude-graded)

**Captured:** 2026-05-17 (working-tree time)
**Bundle:** `001-current.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 1-minute resolution
**Bundle time window:** 2026-05-15 19:20 UTC → 20:59 UTC (Friday NY PM session, just after cash close)

**Note to reviewer:** this expected output was produced by Claude applying `trading-strategy-2026.md §7` mechanically to the bundle. Review and amend — if the user disagrees with any verdict here, edit this file. Future regression runs of `/analyze` against this bundle should produce roughly the same pillar verdicts (the exact prose will vary).

---

## Pillar 1 — Draw & Bias

**a. HTF Bias (Daily / 4H / 1H).**
The chart is on 1-minute, so HTF analysis depends on which HTF indicators are loaded. `ICT Anchored Market Structures with Validation [LuxAlgo]` provides multi-TF structure labels: ST-HL @ 29302.75 (pine.labels.studies[0].labels[0].price), IT-LL @ 29282.25 (pine.labels.studies[0].labels[1].price), IT-HH @ 29324 (pine.labels.studies[0].labels[2].price). No explicit "Bias Long / Bias Short" readout is present in `pine.labels`. **HTF bias: `inferred`** — the visible bar window swept from 29340.25 (bars.high) down to 29110.75 (bars.low) and recovered to 29172.75 (quote.last). 8 FVGs sit above current price (gates.price_context.fvgs_above.count = 8) with the nearest at 29187.75 (gates.price_context.fvgs_above.nearest.low) — consistent with a down-move that left unmitigated bearish inefficiencies above; HTF tilts mildly bearish.

**b. Overnight & Session Correlation.**
No Asia / London session-high or session-low markers are visible in `pine.lines` or `pine.labels`. **n/a — explicit overnight session markers not on chart.**

**c. NY Open LTF Bias.**
Per gates: `session.label = Inter-session`, `session.in_ny_open_window = false`. Bundle captures Friday after the NY PM killzone closed (16:59 ET per `gates.session.timestamp_et`). **n/a — not in NY open window.** This is post-close action, not opening reaction.

## Pillar 2 — Price Action Quality

- **Range.** 229.5 (gates.pillar2.range_value) across ~100 bars = 2.295 per bar (gates.pillar2.range_per_bar). `gates.pillar2.range_acceptable = true`. Range is acceptable, not tiny.
- **Displacement on HTF.** Not directly visible from a 1-minute bundle. The drop from 29340.25 (bars.high) to 29110.75 (bars.low) is displacement on this LTF.
- **Candle quality (last 5 bars).** `gates.pillar2.avg_body_ratio_last_5 ≈ 0.51` → `candle_quality_heuristic = marginal`. Bar 3 of the last 5 was a wide recovery from 29166.5 (bars.last_5_bars[3].open) to 29187.75 (bars.last_5_bars[3].close); bar 4 faded back to 29172.75 (bars.last_5_bars[4].close). Last bars are losing definition; closer to consolidation than clean displacement.
- **Verdict: `marginal`.** Range OK, candle quality not strongly engulfing.

## Pillar 3 — Entry Model + Confirmation

Price 29172.75 (gates.price_context.last) sits inside 4 indicator boxes (`gates.price_context.inside_boxes`), including 2 ICT Killzone boxes (zones[1]: 29469.5 / 29140.75; zones[2]: 29382.5 / 29089.5) and 2 ICT Anchored Market Structure zones. Being inside a killzone box marks the area as historically active, but `gates.session.in_killzone = false` — there is no live killzone *right now*.

The down-and-bounce pattern is shape-of-MSS. Walking the MSS components from `entry-models.md` literally:

1. **Context & Draw** — HTF inferred bearish; partial completion of downside. **Partial.**
2. **Liquidity Grab** — 29110.75 (bars.low) is a candidate sweep, but no overlay of "Asia low / London low / PD low" is present to confirm *which* pool was taken. **Partial / uncertain.**
3. **MSS with Displacement** — No single wide-range displacement candle is visible in `bars.last_5_bars`. The recovery has been gradual. **Missing.**
4. **Retrace to Bullish FVG** — A bullish MSS would need a fresh bullish FVG formed on the recovery leg. `gates.price_context.fvgs_above` are 8 unmitigated FVGs *above* current price (likely bearish, from the down-move); `gates.price_context.fvgs_below` are 3 (likely violated). No fresh bullish FVG on the recovery is identifiable. **Missing.**
5. **Entry Confirmation** — No FVG to retest. **n/a.**

There IS a possible Inversion read: 3 FVGs are now below price (gates.price_context.fvgs_below.count = 3), with the nearest at 29172 (gates.price_context.fvgs_below.nearest.high) — essentially at current price. These are FVGs price has closed above; if HTF were clearly bullish they'd be inversion candidates. But HTF here is `inferred` and tilts mildly bearish, so the precondition for a *bullish* Inversion (HTF clearly bullish per `entry-models.md` Inversion step 1) is not met.

**Entry model: `null` — neither MSS nor Inversion components fully present given the inferred HTF context.**
**Confirmation status: `n/a`.**

## Risk & Management

n/a — no confirmed setup.

## Grade

**`no-trade`.** Pillar 1 HTF is `inferred` only (no explicit label), overnight markers `n/a`, NY window `n/a` (post-close), Pillar 2 `marginal`, Pillar 3 no entry model in play. Multiple weak elements per strategy §7. The strategy says A+ should be rare — capturing a random post-close fixture is firmly in no-trade territory.

---

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "neutral",
    "htf_draw": "inferred bearish — 8 unmitigated FVGs above 29172.75 (quote.last), nearest at 29187.75 (gates.price_context.fvgs_above.nearest.low); no explicit HTF draw label",
    "overnight": "n/a — session indicators not on chart",
    "ny_reaction": "n/a — not in NY open window (gates.session.label = Inter-session, post-close 16:59 ET)"
  },
  "pillar2": {
    "range_acceptable": true,
    "displacement_present": true,
    "candle_quality": "marginal",
    "verdict": "marginal"
  },
  "pillar3": {
    "entry_model": null,
    "confirmation_status": "n/a"
  },
  "trade": {
    "entry": null,
    "stop": null,
    "target_tp1": null,
    "target_tp2": null,
    "invalidation": "n/a"
  },
  "grade": "no-trade"
}
```

# Fixture 001 — Expected Analysis (seed, Claude-graded)

**Captured:** 2026-05-17 (working-tree time)
**Bundle:** `001-current.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 1-minute resolution
**Bundle time window:** 2026-05-15 19:20 UTC → 20:59 UTC (Friday NY PM session, just after cash close)

**Note to reviewer:** this expected output was produced by Claude applying `trading-strategy-2026.md §7` mechanically to the bundle. Review and amend — if the user disagrees with any verdict here, edit this file. Future regression runs of `/analyze` against this bundle should produce roughly the same pillar verdicts (the exact prose will vary).

---

## Pillar 1 — Draw & Bias

**a. HTF Bias (Daily / 4H / 1H).**
The chart is on 1-minute, so HTF analysis depends on what HTF indicators are loaded. The chart has `ICT Anchored Market Structures with Validation [LuxAlgo]`, which provides multi-TF structure labels. Recent structure labels include ST-HL @ 29302.75 (pine.labels.studies[0].labels[0].price), IT-LL @ 29282.25 (pine.labels.studies[0].labels[1].price), and IT-HH @ 29324 (pine.labels.studies[0].labels[2].price). No explicit "Bias Long / Bias Short" readout is present in `pine.labels`. **HTF bias: `inferred`** — the visible bar range shows a down move from 29340.25 (bars.high) to 29110.75 (bars.low), with all FVGs in `pine.boxes.studies[0]` sitting *above* current price 29172.75 (quote.last). Unmitigated FVGs above are consistent with a sell-side delivery that left bearish inefficiencies; HTF tilts mildly bearish but is not explicitly confirmed by a directional label.

**b. Overnight & Session Correlation.**
No Asia / London session-high or session-low markers are visible in `pine.lines` or `pine.labels` (no labels matching that convention). The `ICT Killzones & Pivots [TFO]` indicator emits broad zone boxes rather than per-session H/L levels. **n/a — explicit overnight session markers not on chart.**

**c. NY Open LTF Bias.**
The bundle covers 2026-05-15 19:20 → 20:59 UTC, which is 15:20 → 16:59 ET — *NY PM, around and just after cash close*. This is **outside** the NY open window (which is 09:30–10:00 ET). **n/a — not in NY open window; bundle captures end-of-day action, not opening reaction.**

## Pillar 2 — Price Action Quality

- **3-hour range acceptable?** Bundle period is 100 minutes (`bars.period.from` = 1778872800, `bars.period.to` = 1778878740), not three hours. Within that window the range is 229.5 (bars.range) — substantial for MNQ. Range is not tiny/choppy, but the *3-hour* check cannot be answered from this bundle alone.
- **Displacement present on HTF?** Not directly visible — the bundle is 1-minute only. The drop from 29340.25 (bars.high) to 29110.75 (bars.low) within ~100 minutes implies displacement on this LTF, leaving the FVGs visible in `pine.boxes.studies[0]`.
- **Candle quality on LTF (last 5 bars).** Mixed: `bars.last_5_bars[3]` shows a wide-body bullish recovery from 29166.5 (bars.last_5_bars[3].open) to 29187.75 (bars.last_5_bars[3].close), then `bars.last_5_bars[4]` fades back to 29172.75 (bars.last_5_bars[4].close) — recovery momentum is cooling. Candles are not strongly engulfing; this is closer to consolidation than directional displacement.
- **Verdict: `marginal`.** Range acceptable, displacement was present earlier in the window, but the most recent 5 bars are losing definition.

## Pillar 3 — Entry Model + Confirmation

The down-move-then-bounce pattern *suggests* MSS framing (liquidity grab at 29110.75 → reversal up to 29198 high in `bars.last_5_bars[4].high`). Walking the MSS components literally from `entry-models.md`:

1. **Context & Draw** — HTF inferred bearish, but no clear *completion* of HTF downside draw (no "swept HTF sell-side" label). Component is **partial**.
2. **Liquidity Grab** — The low at 29110.75 (bars.low) is a candidate sweep, but no overlay of "Asia low / London low / PD low" is present in the bundle to confirm *which* pool was taken. Component is **partial / uncertain**.
3. **MSS with Displacement** — There is no clear single displacement candle in the visible `bars.last_5_bars`; the recovery from 29110.75 has been gradual rather than a single wide-range break above the last lower high. Component is **missing**.
4. **Retrace to Bullish FVG** — All FVGs in `pine.boxes.studies[0]` are *above* 29172.75 (quote.last), not below — these read as bearish/unmitigated FVGs created during the down-move, not bullish FVGs that would form on a displacement up. The nearest FVG above is at high 29307.25 (pine.boxes.studies[0].zones[2].high) / low 29298.75 (pine.boxes.studies[0].zones[2].low). For a bullish MSS, we'd need a *new* bullish FVG formed on the recovery leg — not visible. Component is **missing**.
5. **Entry Confirmation** — No FVG to retest, no confirmation candle. **n/a**.

**Entry model: `null` — MSS context suggestive but key components (displacement candle, bullish FVG) are missing.**
**Confirmation status: `n/a`.**

Price 29172.75 is inside the Killzone zone `pine.boxes.studies[2].zones[1]` (high 29469.5, low 29140.75) but a killzone box around price doesn't equal an active setup — the box is a session-window marker, not an entry trigger.

## Risk & Management

n/a — no confirmed setup.

## Grade

**`no-trade`** — Pillar 1 HTF bias is `inferred` only (no explicit label), Pillar 2 verdict is `marginal`, Pillar 3 has no entry model in play. Multiple weak elements per strategy §7. Clearly no-trade.

This matches the strategy's principle that **A+ should be rare**: capturing a random fixture mid-session is most likely to land in no-trade territory.

---

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "neutral",
    "htf_draw": "inferred bearish — unmitigated FVGs above 29172.75 (quote.last); no explicit HTF draw label",
    "overnight": "n/a — session indicators not on chart",
    "ny_reaction": "n/a — not in NY open window (bundle is NY PM close, 16:59 ET)"
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

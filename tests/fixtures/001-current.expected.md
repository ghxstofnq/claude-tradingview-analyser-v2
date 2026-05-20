# Fixture 001 — Expected Analysis (seed, Claude-graded)

**Bundle:** `001-current.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 1-minute resolution
**Bundle time:** 2026-05-18 07:18 ET (`gates.session.timestamp_et`) — Monday morning, post-London-killzone, pre-NY.
**Session label:** `Inter-session` (`gates.session.label`); `is_market_closed = false`; `replay.active = false`.

**Note to reviewer:** Claude-graded baseline applying `trading-strategy-2026.md §7` to the bundle. Review and amend. *Corrected 2026-05-20: the `HL`/`LH` structure reads in Pillar 3 had been inverted — the AMS indicator names pivots `[type][modifier]`, so `ST_LH` is a Higher Low and `ST_HL` a Lower High. Pillar 3 commentary re-graded accordingly; grade unchanged (`no-trade`, driven by Pillar 2 `poor`).*

---

## Pillar 1 — Draw & Bias

**a. HTF Bias.** No explicit bias label (`gates.pillar1.bias_labels = []`). Inferring from `bars_by_tf.*.change_pct`:
- Daily +11.8% (bars_by_tf.daily.change_pct) — strong long-term uptrend, but softening from previous reads (was +12.4%).
- 4H +7.81% (bars_by_tf.h4.change_pct) — still bullish, consistent with daily.
- 1H -0.77% (bars_by_tf.h1.change_pct), 15m -0.52% (bars_by_tf.m15.change_pct) — visible LTF weakness over the overnight session.

**HTF bias: `bullish but weakening on LTF`.** Daily and 4H still up; the LTF pullback is now non-trivial (>0.5% on 15m), worth respecting.

**b. Overnight & Session Correlation.** Session levels (`gates.pillar1.session_levels.*`):
- **Sell-side taken:** PDL 29089.5 (gates.pillar1.session_levels.PDL.price) and NYAM_L 29089.5 (gates.pillar1.session_levels.NYAM_L.price) — same price, both raided overnight.
- **Sell-side still untaken below (3, sorted nearest first):** LO_L 29050 (gates.pillar1.session_levels.LO_L.price), AS_L 28924 (gates.pillar1.session_levels.AS_L.price), PWL 28741.25 (gates.pillar1.session_levels.PWL.price).
- **Buy-side untaken (5 above):** LO_H 29249 (gates.pillar1.session_levels.LO_H.price), AS_H 29283.75 (gates.pillar1.session_levels.AS_H.price), NYAM_H 29382.5 (gates.pillar1.session_levels.NYAM_H.price), PDH 29733.5 (gates.pillar1.session_levels.PDH.price), PWH 29783.75 (gates.pillar1.session_levels.PWH.price).

Reading: London session pushed through PDL/NYAM_L (29089.5 confluence) but bounced. **LO_L (29050) is the next sell-side draw below** — current price 29102.25 (quote.last) is only ~52 ticks above it. If LO_L breaks, AS_L (28924) becomes the next target. If LO_L holds and bounces, the HTF bullish bias remains intact.

**c. NY Open LTF Bias.** `gates.session.in_ny_open_window = false`; Monday 07:18 ET, NY opens at 09:30 ET. **n/a — pre-NY by ~2 hours.** No NY-reaction signal yet.

## Pillar 2 — Price Action Quality

- **Range.** 163.75 (gates.pillar2.range_value) across 100 m1 bars = 1.64 per bar (gates.pillar2.range_per_bar). `range_acceptable = true`.
- **HTF displacement.** 4H range 2793 (bars_by_tf.h4.range) with +7.81% — clear bullish HTF displacement on the wider window; recent 1H/15m drift counter-trend.
- **5m candle anatomy (`gates.pillar2.m5`).** Avg body ratio 0.58 (gates.pillar2.m5.avg_body_ratio_last_5), 1 engulfing (gates.pillar2.m5.engulfing_count_last_5), 1 doji (gates.pillar2.m5.doji_count_last_5). Most recent 5m bar (`gates.pillar2.m5.last_bar`): direction `bearish`, body_ratio 0.15 (gates.pillar2.m5.last_bar.body_ratio) — doji-ish weak close. Close at 29102.75 (gates.pillar2.m5.last_bar.close), range 13.5 (gates.pillar2.m5.last_bar.range), close_position_in_range 0.63.
- **15m candle anatomy (`gates.pillar2.m15`).** Avg body ratio 0.18 (gates.pillar2.m15.avg_body_ratio_last_5) → `poor`. 1 engulfing, 1 doji. Most recent 15m bar (`gates.pillar2.m15.last_bar`): bearish, body_ratio 0.19 — small-bodied. Sets the 15m verdict at `poor` per the heuristic.
- **Verdict: `poor`** — m15 anatomy is clearly weak (avg 0.18). Strategy §3 says "If Draw & Bias are good but Price Quality is bad, he will often stand aside or heavily downsize." Stand aside.

## Pillar 3 — Entry Model + Confirmation

**Most recent structure (sorted by `x`):**

| Label | Price | x |
|-------|-------|---|
| ST_LH | 29094.25 (gates.pillar3.most_recent_structure.ST_LH.price) | 1511 (gates.pillar3.most_recent_structure.ST_LH.x) |
| ST_HH | 29108 (gates.pillar3.most_recent_structure.ST_HH.price) | 1510 (gates.pillar3.most_recent_structure.ST_HH.x) |
| IT_LL | 29050 (gates.pillar3.most_recent_structure.IT_LL.price) | 1509 (gates.pillar3.most_recent_structure.IT_LL.x) |
| ST_HL | 29104.25 (gates.pillar3.most_recent_structure.ST_HL.price) | 1507 (gates.pillar3.most_recent_structure.ST_HL.x) |
| ST_LL | 29092 (gates.pillar3.most_recent_structure.ST_LL.price) | 1506 (gates.pillar3.most_recent_structure.ST_LL.x) |

Notable: the **`IT_LL` (intermediate-term lower low) at 29050 (gates.pillar3.most_recent_structure.IT_LL.price) sits at LO_L 29050 (gates.pillar1.session_levels.LO_L.price)** — confluence sell-side. If price tests LO_L, that's also the intermediate-term swing low. A clean reject from 29050 is a *bullish Inversion candidate* in the HTF-bullish context. A break below 29050 invalidates intermediate-term support and opens the path to AS_L 28924.

The two most recent structure events: ST_HH 29108 (gates.pillar3.most_recent_structure.ST_HH.price) at x 1510, then ST_LH 29094.25 (gates.pillar3.most_recent_structure.ST_LH.price) at x 1511. Under the AMS `[type][modifier]` convention, `LH` is a **higher low** — so short-term structure just printed a higher high then a higher low. **Bullish micro-structure, aligned with the HTF bullish bias.**

**FVG context (`gates.pillar3.fvg_by_type_*`):**
- Above price: 5 bearish_fvg + 4 bearish_ifvg = 9 zones (all bearish-leaning). Heavy overhead resistance.
- Below price: 1 bullish_fvg + 2 bullish_ifvg = 3 zones (all bullish-leaning).

**Confirmation-candle facts at each TF (the new gates):**
- **1m close (`gates.pillar3.last_bar` / `gates.pillar2.current_tf.last_bar`):** bullish, body_ratio 0.81 (strong-bodied), close 29102.25 (gates.pillar3.last_bar.close), close_position_in_range 0.81. **Bullish strong-bodied 1m close in the upper portion of its range** — fits the 1m confirmation shape per §5/§7 step 6.
- **5m close (`gates.pillar2.m5.last_bar`):** bearish, body_ratio 0.15 — does NOT fit the strategy's "clear body (not a doji)" confirmation criterion.
- **15m close (`gates.pillar2.m15.last_bar`):** bearish, body_ratio 0.19 — same problem.

So the 1m close is constructive, but the 5m and 15m are weak. Per strategy: a 1m close is a valid confirmation TF, but only if it's against the specific FVG being traded — and only if context (Pillar 1 + 2) supports.

**Entry-model walk:**
- **MSS up:** an MSS-up needs a displacement close *above the most recent swing high* after a sell-side liquidity grab. The recent swing highs are ST_HL 29104.25 (gates.pillar3.most_recent_structure.ST_HL.price) and ST_HH 29108 (gates.pillar3.most_recent_structure.ST_HH.price); current price 29102.25 (quote.last) sits below both, and the 1m bar is small-bodied (no displacement). **No MSS-up trigger** — though the recent higher-high / higher-low pair means short-term structure is already constructive.
- **Trend up:** HTF bullish but LTF is in a counter-trend pullback. Not in continuation phase.
- **Inversion long candidate:** the watched zone would be LO_L 29050 / IT_LL 29050 confluence. Price is currently NOT in that zone (above it at 29102.25); no tap yet, so no confirmation event possible. *Inversion long if LO_L holds on test* is the watch-list setup.

**Entry model: `null` — no model fully engaged.**
- 1m bullish close is mildly constructive but lacks PD-array tap context.
- LO_L 29050 is the watched zone for a potential bullish Inversion, but price hasn't tapped it.
- Pillar 2 `poor` (m15 avg 0.18) overrides any setup until candle anatomy improves.

**Confirmation status: `n/a`.**

## Risk & Management

n/a — no confirmed setup. Watch-list: bullish 1m/5m close from a tap into LO_L 29050 zone, ideally during the NY-open window. Stop below 29050; target NYAM_H 29382.5 or PDH 29733.5.

## Grade

**`no-trade`.** Pillar 2 `poor` (m15 avg 0.18) is the primary downgrade — strategy §3 says stand aside when Draw & Bias OK but Price Quality bad. Also outside NY window (pre-NY by 2h), no Pillar 3 confirmation. Multiple A+ criteria not met. Watch LO_L 29050 for an Inversion-long opportunity when NY opens.

---

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "bullish",
    "htf_draw": "HTF bullish (Daily +11.8%, 4H +7.81%) but LTF in pullback. Near-term sell-side: LO_L 29050 (also IT_LL confluence) is the immediate downside draw; if reclaimed, AS_L 28924, PWL 28741.25 deeper. Buy-side: LO_H 29249 first, then NYAM_H 29382.5, PDH 29733.5.",
    "overnight": "Overnight took PDL/NYAM_L 29089.5 (gates.pillar1.session_levels.PDL.price) — raided sell-side. LO_L 29050 still untaken below as the next downside draw. Buy-side ladder intact above.",
    "ny_reaction": "n/a — not in NY open window (Monday 07:18 ET; NY opens 09:30 ET)"
  },
  "pillar2": {
    "range_acceptable": true,
    "displacement_present": true,
    "candle_quality": "poor",
    "verdict": "poor"
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

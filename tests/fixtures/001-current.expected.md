# Fixture 001 — Expected Analysis (seed, Claude-graded)

**Bundle:** `001-current.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 1-minute resolution
**Bundle time:** 2026-05-17 18:57 ET (`gates.session.timestamp_et`) — Sunday evening, Asia futures session.
**Session label:** `Asia` per `gates.session.label`; `gates.session.is_market_closed = false`; `gates.session.replay.active = false` — live, post-Sunday-Globex-reopen.

**Note to reviewer:** Claude-graded baseline applying `trading-strategy-2026.md §7` to the bundle. Review and amend.

---

## Pillar 1 — Draw & Bias

**a. HTF Bias (Daily / 4H / 1H).**
No explicit bias label is published (`gates.pillar1.bias_labels = []`). Inferring from `bars_by_tf.*.change_pct`:
- **Daily:** open 26027.5 (bars_by_tf.daily.open) → close 29235 (bars_by_tf.daily.close), change +12.32% (bars_by_tf.daily.change_pct). Strong long-term uptrend.
- **4H:** open 26941.75 (bars_by_tf.h4.open) → close 29231.75 (bars_by_tf.h4.close), change +8.5% (bars_by_tf.h4.change_pct). Consistent bullish HTF.
- **1H:** -0.27% (bars_by_tf.h1.change_pct) — flat.
- **15m:** -1.53% (bars_by_tf.m15.change_pct) — minor recent dip.

**HTF bias: `bullish`.** Daily and 4H both clearly up; the 1H/15m drift is too small to call counter-trend.

**HTF FVGs (from `pine_by_tf.*.boxes`):** the nearest 4H bearish FVG above current price still coincides with `LO_H` (29469.5) — buy-side liquidity + HTF bearish FVG at the same level, classic confluence resistance if price extends up. Below, the daily-FVG support shelf sits well below (long-horizon).

**b. Overnight & Session Correlation.**
Full session map mechanical via `gates.pillar1.session_levels.*`:
- **Sell-side already taken below price:** LO_L 29140.75 (gates.pillar1.session_levels.LO_L.price).
- **Sell-side untaken (below price, draws), sorted nearest first:** AS_L 29112 (gates.pillar1.session_levels.AS_L.price) — bars.low has touched exactly this level (29112) but not gone *below*, so it's borderline; PDL 29089.5 (gates.pillar1.session_levels.PDL.price); NYAM_L 29089.5 (gates.pillar1.session_levels.NYAM_L.price) — same price as PDL, confluence; PWL 28741.25 (gates.pillar1.session_levels.PWL.price) further below.
- **Buy-side untaken (all five highs above):** AS_H 29283.75 (gates.pillar1.session_levels.AS_H.price), NYAM_H 29382.5 (gates.pillar1.session_levels.NYAM_H.price), LO_H 29469.5 (gates.pillar1.session_levels.LO_H.price), PDH 29733.5 (gates.pillar1.session_levels.PDH.price), PWH 29783.75 (gates.pillar1.session_levels.PWH.price).
- Read: weekend re-open swept LO_L from below, then bounced; AS_L (29112) reached on this bar but not penetrated. PDL/NYAM_L (29089.5 confluence) remains as the deeper sell-side draw. Buy-side ladder intact above — full magnet stack in line with HTF bullish.

**c. NY Open LTF Bias.**
`gates.session.in_ny_open_window = false`; Sunday 18:57 ET is pre-NY by ~15 hours. **n/a — not in NY open window.** No live NY-reaction signal yet.

## Pillar 2 — Price Action Quality

- **Range.** 171.75 (gates.pillar2.range_value) across 100 1m bars = 1.72 per bar (gates.pillar2.range_per_bar). `range_acceptable = true`.
- **HTF displacement.** 4H range 3103.75 (bars_by_tf.h4.range) with +8.5% change — strong directional 4H displacement at the HTF scale.
- **5m candle anatomy (`gates.pillar2.m5`).** Body ratios over last 5 m5 bars: [0.69, 0.22, 0.67, 0.1, 0.37] (gates.pillar2.m5.body_ratios_last_5). Avg 0.41 (gates.pillar2.m5.avg_body_ratio_last_5) → `marginal`. 2 engulfings (gates.pillar2.m5.engulfing_count_last_5), 1 doji (gates.pillar2.m5.doji_count_last_5). Strategy threshold: at-least-2 engulfings ✓, doji_count ≤ 1 ✓ — acceptable, not strong.
- **15m candle anatomy (`gates.pillar2.m15`).** Body ratios: [0.02, 0.68, 0.38, 0.52, 0.44] (gates.pillar2.m15.body_ratios_last_5). Avg 0.41 (gates.pillar2.m15.avg_body_ratio_last_5). 2 engulfings (gates.pillar2.m15.engulfing_count_last_5), 1 doji (gates.pillar2.m15.doji_count_last_5) — the doji is the oldest bar (ratio 0.02), bookended by stronger candles. Similar profile to 5m.
- **Verdict: `marginal`.** Range OK, HTF displacement present, but candle anatomy on both 5m and 15m is borderline (avg ratio at exactly the 0.4 cutoff between marginal and good; one doji on each TF; engulfings present but not dominant). Typical Sunday-Asia choppy.

## Pillar 3 — Entry Model + Confirmation

**Most recent structure (sorted by `x` descending, `gates.pillar3.most_recent_structure.*`):**

| Label | Price | x |
|-------|-------|---|
| ST_LL | 29200 (gates.pillar3.most_recent_structure.ST_LL.price) | 1516 (gates.pillar3.most_recent_structure.ST_LL.x) |
| ST_HL | 29258.25 (gates.pillar3.most_recent_structure.ST_HL.price) | 1515 (gates.pillar3.most_recent_structure.ST_HL.x) |
| ST_LH | 29253.5 (gates.pillar3.most_recent_structure.ST_LH.price) | 1511 (gates.pillar3.most_recent_structure.ST_LH.x) |
| IT_HH | 29274.5 (gates.pillar3.most_recent_structure.IT_HH.price) | 1510 (gates.pillar3.most_recent_structure.IT_HH.x) |
| ST_HH | 29271.75 (gates.pillar3.most_recent_structure.ST_HH.price) | 1508 (gates.pillar3.most_recent_structure.ST_HH.x) |

Reading: most recent event is a fresh `ST_LL` at 29200 — a short-term lower low just printed. Current price 29232.5 (quote.last) has recovered above the ST_LL and above the immediately-prior ST_HL (29258.25 was a higher-low before this LL broke it).

For an MSS up to confirm, price would need to close above the most-recent ST_LH at 29253.5 with displacement — current price 29232.5 is *below* that, so MSS up is **not yet triggered**, just shaping.

**FVG context (`gates.pillar3.fvg_by_type_*`):**
- Above price: 0 bullish, 4 bearish_fvg, 3 bearish_ifvg = 7 zones (all bearish-leaning — overhead supply).
- Below price: 3 bullish_fvg, 5 bullish_ifvg = 8 zones (all bullish-leaning — underneath demand).

Bullish-skewed below + bearish-skewed above = price is in an asymmetric zone where retraces up will hit bearish FVGs and retraces down will hit bullish IFVGs (potential support).

**Last bar (`gates.pillar3.last_bar`):**
direction = `bullish`, open 29227.5 (gates.pillar3.last_bar.open), close 29232.5 (gates.pillar3.last_bar.close), high 29237.5 (gates.pillar3.last_bar.high), low 29223 (gates.pillar3.last_bar.low), body_ratio 0.34 (gates.pillar3.last_bar.body_ratio), close_position_in_range 0.66 (gates.pillar3.last_bar.close_position_in_range). Small-body bullish bar closed in the upper third — mild bullish reaction after the ST_LL print but not a strong confirmation candle.

**Entry-model walk:**
- **MSS up:** components forming — fresh ST_LL was the liquidity grab (price taking out the prior ST_HL 29258.25 then making 29200), but price has not yet closed above the most-recent ST_LH 29253.5 with displacement. The last bar is bullish but body_ratio 0.34 is below strong-displacement threshold. **Not confirmed; possibly setting up.**
- **Trend up:** HTF bullish but LTF structure just printed a fresh LL, so we're not in clean continuation. Skip.
- **Inversion (bullish):** 5 bullish_ifvg below price are violated-bearish FVGs that act as bullish support. If price taps one and bullish confirmation closes from it, that's a textbook Inversion long candidate. Not engaged yet (no clear tap-and-reject visible from the bundle).

**Entry model: `null` — MSS up *forming*: fresh ST_LL is a candidate liquidity grab in the HTF-bullish context, but no displacement close above ST_LH 29253.5 yet.**
**Confirmation status: `n/a` (no model engaged).**

## Risk & Management

n/a — no confirmed setup.

## Grade

**`no-trade`.** HTF bullish ✓, Pillar 2 marginal (range OK, anatomy borderline), Pillar 3 no confirmed model (MSS up shaping, not triggered). Also outside NY window — no killzone-aligned confirmation possible right now. Multiple A+ criteria not yet observable; clearly not a tradeable moment. Watch-list: (a) bullish close above ST_LH 29253.5 with displacement (MSS up trigger toward AS_H 29283.75 then NYAM_H 29382.5), or (b) tap into one of the bullish IFVGs below + bullish confirmation (Inversion long). The decision happens at or after NY open, not in Asia drift.

---

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "bullish",
    "htf_draw": "HTF bullish (Daily +12.32%, 4H +8.5%); near-term draws — AS_H 29283.75 (first buy-side magnet up), AS_L 29112 (tagged but not pierced), PDL/NYAM_L 29089.5 (deeper sell-side confluence)",
    "overnight": "Weekend gap → Asia open swept LO_L 29140.75; AS_L 29112 tagged but not penetrated. All 5 buy-side highs untaken above; PDL/NYAM_L 29089.5 + PWL 28741.25 untaken below",
    "ny_reaction": "n/a — not in NY open window (Sunday 18:57 ET; Asia session)"
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

# Fixture 001 — Expected Analysis (seed, Claude-graded)

**Bundle:** `001-current.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 1-minute resolution
**Bundle time:** 2026-05-17 18:46 ET (`gates.session.timestamp_et`) — Sunday evening, Asia futures session has just reopened after the weekend pause.
**Session label:** `Weekend/Closed` per `gates.session.label` — **note:** known edge in the session-detection code; CME Globex actually reopens at 18:00 ET Sunday for Asia, so the label is wrong here. The substance below treats this as early-Asia.

**Note to reviewer:** Claude-graded baseline applying `trading-strategy-2026.md §7` to the bundle. Review and amend.

---

## Pillar 1 — Draw & Bias

**a. HTF Bias (Daily / 4H / 1H).**
No explicit bias label is published (`gates.pillar1.bias_labels = []`). Inferring from `bars_by_tf.*.change_pct`:
- **Daily:** open 26027.5 (bars_by_tf.daily.open) → close 29259 (bars_by_tf.daily.close), change +12.42% (bars_by_tf.daily.change_pct). Strong long-term uptrend.
- **4H:** open 26941.75 (bars_by_tf.h4.open) → close 29257.75 (bars_by_tf.h4.close), change +8.6% (bars_by_tf.h4.change_pct). Consistent bullish HTF.
- **1H:** -0.19% (bars_by_tf.h1.change_pct) — flat.
- **15m:** -1.45% (bars_by_tf.m15.change_pct) — minor recent dip.

**HTF bias: `bullish`.** Daily and 4H clearly up; the 1H/15m drift is too small to call counter-trend.

**HTF FVGs (from `pine_by_tf.*.boxes`):**
The nearest 4H bearish FVG above current price coincides with `LO_H` (29469.5) — buy-side liquidity + HTF bearish FVG at the same price, classic confluence resistance if price extends up that far. Below, the daily-FVG support shelf sits at 28553.5 / 28247 (long-horizon — not near-term).

**b. Overnight & Session Correlation.**
Full session map mechanical via `gates.pillar1.session_levels.*`:
- **Sell-side taken (below price):** LO_L 29140.75 (gates.pillar1.session_levels.LO_L.price), AS_L 29112 (gates.pillar1.session_levels.AS_L.price). Both raided.
- **Sell-side untaken (below price, draws):** PDL 29089.5 (gates.pillar1.session_levels.PDL.price), NYAM_L 29089.5 (gates.pillar1.session_levels.NYAM_L.price) — they sit at the same level on this fixture, so it's a single 29089.5 confluence pool. PWL 28741.25 (gates.pillar1.session_levels.PWL.price) further below.
- **Buy-side untaken (all four highs above):** AS_H 29283.75 (gates.pillar1.session_levels.AS_H.price), NYAM_H 29382.5 (gates.pillar1.session_levels.NYAM_H.price), LO_H 29469.5 (gates.pillar1.session_levels.LO_H.price), PDH 29733.5 (gates.pillar1.session_levels.PDH.price), PWH 29783.75 (gates.pillar1.session_levels.PWH.price).
- Read: weekend re-open swept LO_L and AS_L (sell-side cleared close-in); PDL/NYAM_L (29089.5 confluence) is the deeper remaining sell-side draw if HTF wants more downside before continuation. Buy-side is entirely intact above — full ladder of magnets in line with HTF bullish.

**c. NY Open LTF Bias.**
`gates.session.in_ny_open_window = false`. We're at 18:46 ET Sunday — pre-NY by ~15 hours. **n/a — not in NY open window.** No live NY-reaction signal.

## Pillar 2 — Price Action Quality

- **Range.** 173 (gates.pillar2.range_value) across 100 bars on the current 1m TF = 1.73 per bar (gates.pillar2.range_per_bar). `range_acceptable = true`.
- **HTF displacement.** 4H range 3103.75 (bars_by_tf.h4.range) with +8.6% — strong directional 4H displacement at the HTF scale.
- **5m candle anatomy (`gates.pillar2.m5`).** Body ratios over the last 5 m5 bars: [0.73, 0.3, 0.69, 0.22, 0.77] (gates.pillar2.m5.body_ratios_last_5). Avg 0.54 (gates.pillar2.m5.avg_body_ratio_last_5) → heuristic `marginal`. 2 engulfings (gates.pillar2.m5.engulfing_count_last_5), 0 dojis (gates.pillar2.m5.doji_count_last_5). Strategy §7.3 wants "mainly engulfing, not dominated by dojis" — 2/4 transitions engulf, no dojis, so the 5m anatomy is acceptable.
- **15m candle anatomy (`gates.pillar2.m15`).** Body ratios: [0.02, 0.68, 0.38, 0.52, 0.63] (gates.pillar2.m15.body_ratios_last_5). Avg 0.45 (gates.pillar2.m15.avg_body_ratio_last_5) → `marginal`. 2 engulfings (gates.pillar2.m15.engulfing_count_last_5), 1 doji (gates.pillar2.m15.doji_count_last_5) — the doji is the oldest bar (ratio 0.02), bookended by strong-bodied candles. Not "dominated" by dojis.
- **Verdict: `marginal-to-good`.** Range OK, HTF displacement present, 5m and 15m bodies clean (no doji domination). 1m current-TF stats are weaker (avg 0.35 — wicky chop typical of pre-session) but Pillar 2 is meant to be judged on 5m/15m, not 1m.

## Pillar 3 — Entry Model + Confirmation

**Most recent structure (sorted by `x` descending, `gates.pillar3.most_recent_structure.*`):**

| Label | Price | x | Reading |
|-------|-------|---|---------|
| ST_HH | 29274.5 (gates.pillar3.most_recent_structure.ST_HH.price) | 1514 (gates.pillar3.most_recent_structure.ST_HH.x) | Freshest event — short-term *higher* high just made. |
| ST_LH | 29252.75 (gates.pillar3.most_recent_structure.ST_LH.price) | 1513 (gates.pillar3.most_recent_structure.ST_LH.x) | Prior ST lower-high. |
| IT_LH | 29198 (gates.pillar3.most_recent_structure.IT_LH.price) | 1510 (gates.pillar3.most_recent_structure.IT_LH.x) | Intermediate-term lower-high. |
| ST_HL | 29226.75 (gates.pillar3.most_recent_structure.ST_HL.price) | 1508 (gates.pillar3.most_recent_structure.ST_HL.x) | Prior ST higher-low. |
| IT_HL | 29264 (gates.pillar3.most_recent_structure.IT_HL.price) | 1506 (gates.pillar3.most_recent_structure.IT_HL.x) | IT higher-low. |

Reading: the most recent structure event is a fresh `ST_HH` at 29274.5 — short-term made a new high above the prior ST_LH 29252.75. That's bullish LTF micro-structure, consistent with HTF bullish. Current price 29254.25 (quote.last) has now pulled back slightly off that high.

**FVG context (`gates.pillar3.fvg_by_type_*`):**
- Above price: 1 bullish_fvg, 3 bearish_fvg, 1 bearish_ifvg = 5 zones (4 bearish-leaning).
- Below price: 4 bullish_fvg, 6 bullish_ifvg = 10 zones (all bullish-leaning). **Heavy bullish underneath**, including 6 IFVGs (bearish FVGs that were violated up; now bullish support).

**Last bar (`gates.pillar3.last_bar`):**
direction = bearish, open 29264 (gates.pillar3.last_bar.open), close 29254.25 (gates.pillar3.last_bar.close), high 29265.25 (gates.pillar3.last_bar.high), low 29253.5 (gates.pillar3.last_bar.low), body_ratio 0.83 (gates.pillar3.last_bar.body_ratio), close_position_in_range 0.06 (gates.pillar3.last_bar.close_position_in_range). A strong-bodied bearish bar closing at the low — minor pullback off the ST_HH. `last_bar_age_seconds = 0` (live/just-closed).

**Entry-model walk:**
- **MSS up:** doesn't fit — no fresh sell-side sweep just happened (29089.5 sell-side is still untaken; sweep is not "near completion"). The recent action is making *new highs*, not reversing from a low. Skip.
- **Trend up:** plausible — HTF bullish, LTF made fresh ST_HH, bullish FVGs underneath as support. But: no clean impulse leg + retrace + bullish-FVG-tap pattern with confirmation; the last bar is fading. Pillar 2 quality is marginal-to-good (5m/15m), not "good." Could be forming, not confirmed.
- **Inversion:** the 6 bullish IFVGs below price are FVGs that previously violated up (bearish FVGs broken bullish-ly). If price retraces down into one of those zones and rejects, that's a textbook bullish-Inversion entry candidate. Today's data shows the IFVG layer but no tap yet.

**Entry model: `null` — Trend or Inversion could form, neither is confirmed. Most recent bar is actively fading; we'd want to see the pullback stall and bullish confirmation before considering long.**

**Confirmation status: `n/a` (no setup engaged).**

## Risk & Management

n/a — no confirmed setup.

## Grade

**`no-trade`.** HTF bullish ✓, Pillar 2 marginal-to-good ✓, but Pillar 1 NY-reaction n/a (Sunday evening, far from NY open), Pillar 3 no confirmed model. Multiple A+ criteria not yet observable; clearly not a tradeable moment. The reasonable next-step is to watch for: (a) pullback into one of the bullish IFVGs below price + bullish confirmation = Inversion long, or (b) continuation up that taps the 4H bearish FVG at LO_H (29469.5) with rejection = short toward PDL/NYAM_L 29089.5. The decision happens at NY open, not now.

---

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "bullish",
    "htf_draw": "HTF bullish (Daily +12.42%, 4H +8.6%); main draw confluence: PDL/NYAM_L 29089.5 below (if downside) OR PDH 29733.5 above (if continuation). Near-term: AS_H 29283.75 first buy-side magnet up; PDL 29089.5 first sell-side draw down.",
    "overnight": "Weekend gap → Asia reopen swept LO_L 29140.75 and AS_L 29112; PDL/NYAM_L 29089.5 untaken below as residual sell-side draw; all buy-side above intact (AS_H, NYAM_H, LO_H, PDH, PWH)",
    "ny_reaction": "n/a — not in NY open window (Sunday 18:46 ET; pre-NY by ~15 hours)"
  },
  "pillar2": {
    "range_acceptable": true,
    "displacement_present": true,
    "candle_quality": "marginal-to-good",
    "verdict": "marginal-to-good"
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

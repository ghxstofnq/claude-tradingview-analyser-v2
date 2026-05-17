# Fixture 001 — Expected Analysis (seed, Claude-graded)

**Captured:** 2026-05-17 (working-tree time)
**Bundle:** `001-current.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 1-minute resolution
**Bundle time window:** 2026-05-15 19:20 UTC → 20:59 UTC (Friday NY PM session, just after cash close)

**Note to reviewer:** Claude-graded baseline applying `trading-strategy-2026.md §7` to the bundle. Review and amend.

---

## Pillar 1 — Draw & Bias

**a. HTF Bias (Daily / 4H / 1H).**
Multi-TF bars now in bundle (`bars_by_tf.*`):
- **Daily:** 100 daily bars from 25916.75 (bars_by_tf.daily.open) → close 29231.75 (bars_by_tf.daily.close), range 6823.25 (bars_by_tf.daily.range), change +12.79% (bars_by_tf.daily.change_pct) over the visible window. **Strong long-term uptrend.**
- **4H:** open 26978 (bars_by_tf.h4.open) → close 29172.75 (bars_by_tf.h4.close), range 3103.75 (bars_by_tf.h4.range), change +8.14% (bars_by_tf.h4.change_pct). **Intermediate trend up, consistent with daily.**
- **1H:** open 29297.25 (bars_by_tf.h1.open) → close 29172.75 (bars_by_tf.h1.close), range 1042.5 (bars_by_tf.h1.range), change −0.42% (bars_by_tf.h1.change_pct). **Minor recent pullback** — small magnitude, not a counter-trend break.
- **15m:** open 29709 (bars_by_tf.m15.open) → close 29172.75 (bars_by_tf.m15.close), range 649.5 (bars_by_tf.m15.range), change −1.81% (bars_by_tf.m15.change_pct). **Sharper LTF pullback** — this is Friday's down session.
- **5m / 1m:** small positive/negative drift around the recovery (`change_pct = +0.04%` on m5, `-0.44%` on m1).

**HTF bias: `bullish`** — Daily and 4H both up >+8%; the 1H/15m pullback is a counter-trend dip *within* a clear HTF uptrend. The buy-side draws above (PDH, AS_H, LO_H, NYAM_H) are the longer-horizon magnets; current LTF action is a retracement into the trend, not a reversal.

Untaken liquidity (from `gates.pillar1.untaken_*`):
- **Sell-side below (1):** NYAM_L 29089.5 (gates.pillar1.session_levels.NYAM_L.price) — the only sell-side pool below current price not yet taken. Could be a final draw before bullish continuation.
- **Buy-side above (4, ascending):** NYAM_H 29382.5, LO_H 29469.5, AS_H 29733.5, PDH 29783.75. PDH is the longest-horizon target.

Session levels already taken (sweeps already done):
- PDL 29448.25 (gates.pillar1.session_levels.PDL.price) — taken
- AS_L 29280 (gates.pillar1.session_levels.AS_L.price) — taken
- LO_L 29140.75 (gates.pillar1.session_levels.LO_L.price) — taken

Three sell-side pools below already raided this session; only NYAM_L remains. Combined with HTF bullish, this fits the strategy's "HTF sell-side near completion" setup (entry-models.md MSS step 1).

**b. Overnight & Session Correlation.**
Full session map mechanical (per gates above). Pattern read: overnight + early session swept down through three sell-side pools (PDL → AS_L → LO_L) and stalled at the LT_LL 29110.75 (gates.pillar3.most_recent_structure.LT_LL.price) without taking NYAM_L 29089.5. Recovery underway. **PWH/PWL are null** (weekly markers not on chart resolution); proceeding without them per strategy §2.1.

**c. NY Open LTF Bias.**
`gates.session.label = Inter-session`, `gates.session.in_ny_open_window = false`. Bundle captures Friday at 16:59 ET — post NY-PM killzone close. **n/a — not in NY open window.** No live NY-reaction signal; cannot confirm or challenge the HTF read intraday.

## Pillar 2 — Price Action Quality

- **Range (LTF).** 229.5 (gates.pillar2.range_value) across 100 bars on the 1m chart = 2.295 per bar (gates.pillar2.range_per_bar). `gates.pillar2.range_acceptable = true`.
- **Displacement (HTF).** 4H range 3103.75 (bars_by_tf.h4.range) over 100 4H bars with +8.14% change — large clean direction = displacement present at HTF scale. 1H range 1042.5 (bars_by_tf.h1.range) with only −0.42% change — modest range, drifty.
- **Candle quality (LTF, last 5 bars).** `gates.pillar2.avg_body_ratio_last_5 ≈ 0.51` → `candle_quality_heuristic = marginal`. Recent recovery bars (e.g. bars.last_5_bars[3] from 29166.5 → 29187.75) are wide-ish but bars.last_5_bars[4] fades back to 29172.75 (bars.last_5_bars[4].close). Mixed signal.
- **Verdict: `marginal`.** Range OK, HTF displacement present, but LTF candle quality is not strongly engulfing on the most recent bars.

## Pillar 3 — Entry Model + Confirmation

`gates.price_context.inside_boxes` shows price contained by 4 boxes (2 Anchored Structures volatility zones, 2 ICT Killzones boxes).

**Most recent structure (sorted by `x`, freshest first):**

| Label | Price | x | Reading |
|-------|-------|---|---------|
| ST_LL | 29160 (gates.pillar3.most_recent_structure.ST_LL.price) | 1517 (gates.pillar3.most_recent_structure.ST_LL.x) | Fresh short-term lower low. |
| ST_HH | 29175.5 (gates.pillar3.most_recent_structure.ST_HH.price) | 1514 (gates.pillar3.most_recent_structure.ST_HH.x) | Recent ST high. Above current price. |
| ST_HL | 29174.5 (gates.pillar3.most_recent_structure.ST_HL.price) | 1513 (gates.pillar3.most_recent_structure.ST_HL.x) | Recent ST higher-low. |
| ST_LH | 29168 (gates.pillar3.most_recent_structure.ST_LH.price) | 1512 (gates.pillar3.most_recent_structure.ST_LH.x) | Most-recent ST lower-high. |
| LT_LL | 29110.75 (gates.pillar3.most_recent_structure.LT_LL.price) | 1491 (gates.pillar3.most_recent_structure.LT_LL.x) | Session swing low; equals bars.low. |

Reading: most-recent event is a fresh ST_LL @ 29160 (x=1517). Current price 29172.75 has closed *above* the most-recent ST_LH at 29168 — that's a minor LTF structure shift up against the LL. For a clean MSS up, we'd want the close above ST_LH AND a wide-range displacement candle — `gates.pillar2.candle_quality_heuristic = marginal` argues this is **incipient, not confirmed**.

**FVG context (from `gates.pillar3.fvg_by_type_above` / `_below`):**
- **Above:** 6 bearish FVGs, 2 bearish IFVGs — heavy overhead supply, likely to resist retraces up. Nearest bearish FVG is close (within ~15 ticks).
- **Below:** 1 bullish FVG, 2 bullish IFVGs — modest underneath support. The bullish IFVGs are violated bearish FVGs that now act as bullish support if revisited.

**Walking MSS components (entry-models.md):**

1. **Context & Draw** — HTF bullish (`bars_by_tf.daily.change_pct = +12.79%`), and price has taken 3 of 4 sell-side pools (PDL, AS_L, LO_L). Only NYAM_L 29089.5 (gates.pillar1.session_levels.NYAM_L.price) remains untaken. The strategy says "HTF sell-side taken, OR price into a large HTF bullish FVG." Sell-side not fully taken — **partial** (NYAM_L still pending).
2. **Liquidity Grab** — LT_LL @ 29110.75 cleanly swept LO_L. Direction-of-grab aligns with HTF bullish setup (a sweep down to capture stops before reversing up). **Yes.**
3. **MSS with Displacement** — Closed above ST_LH 29168, but `candle_quality_heuristic = marginal`. **Partial.**
4. **Retrace to Bullish FVG** — 1 bullish FVG sits below price (gates.pillar3.fvg_by_type_below.bullish_fvg = 1). Whether it's the *displacement* FVG from the recovery leg is not deterministic from the bundle. **Possibly present.**
5. **Confirmation candle (1m/5m)** — `candle_quality_heuristic = marginal` and `gates.session.in_killzone = false` (no live killzone to confirm in). **Cannot confirm.**

**Entry model: `null` — MSS up *forming* (HTF bullish + LO_L swept + minor structure shift up) but NOT confirmed. NYAM_L below is a remaining downside draw target that could still play out; confirmation candle quality is marginal; we're outside the NY/killzone windows.**

**Confirmation status: `n/a` (Inter-session).**

## Risk & Management

n/a — no confirmed setup.

## Grade

**`no-trade`.** HTF bullish ✓ but NY closed (Inter-session) ✗ — strategy §7 grade requires NY reaction confirmation for A+. Price quality marginal ✗. Pillar 3 model only forming, not confirmed ✗. Multiple weak elements; clearly not A+. Could be a B watch-list candidate IF NY opens with bullish reaction (break + rejection above overnight low → LTF aligns with HTF), but right now no trigger.

What would change this (the watch-list version):
- **For long bias:** NY opens, reacts bullishly off LO_L/NYAM_L vicinity, confirmation candle on 1m/5m with displacement → MSS up valid → A+ candidate IF NYAM_L holds or is briefly tagged + reclaimed.
- **For short bias:** NY opens, fails above ST_HH 29175.5, displaces down toward NYAM_L 29089.5 to complete sell-side run → short with NYAM_L as draw target. But shorts against HTF bullish daily/4H are lower-conviction.

The HTF bullish + LTF sweep+recovery pattern favors longs on confirmation. Until NY opens, sit out.

---

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "bullish",
    "htf_draw": "HTF bullish (bars_by_tf.daily.change_pct = +12.79%, bars_by_tf.h4.change_pct = +8.14%) toward upside buy-side; nearest untaken buy-side: NYAM_H 29382.5; LO_L 29140.75 swept, NYAM_L 29089.5 still untaken below as final sell-side draw",
    "overnight": "3 sell-side pools taken (PDL 29448.25, AS_L 29280, LO_L 29140.75); only NYAM_L 29089.5 remains untaken below; all 4 highs above untaken (NYAM_H, LO_H, AS_H, PDH); pattern = extending HTF down-leg / pulling back into HTF uptrend",
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

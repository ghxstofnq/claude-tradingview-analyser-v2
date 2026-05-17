# Fixture 001 — Expected Analysis (seed, Claude-graded)

**Captured:** 2026-05-17 (working-tree time)
**Bundle:** `001-current.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 1-minute resolution
**Bundle time window:** 2026-05-15 19:20 UTC → 20:59 UTC (Friday NY PM session, just after cash close)

**Note to reviewer:** Claude-graded baseline applying `trading-strategy-2026.md §7` to the bundle. Review and amend.

---

## Pillar 1 — Draw & Bias

**a. HTF Bias (Daily / 4H / 1H).**
No explicit "Bias Long / Bias Short" label is published. HTF context is inferred from the strategy's session-level map (`gates.pillar1.session_levels`):
- Buy-side liquidity above (all untaken): PDH 29783.75 (gates.pillar1.session_levels.PDH.price), AS_H 29733.5 (gates.pillar1.session_levels.AS_H.price), LO_H 29469.5 (gates.pillar1.session_levels.LO_H.price), NYAM_H 29382.5 (gates.pillar1.session_levels.NYAM_H.price).
- Sell-side liquidity already taken: PDL 29448.25 (gates.pillar1.session_levels.PDL.price), AS_L 29280 (gates.pillar1.session_levels.AS_L.price), LO_L 29140.75 (gates.pillar1.session_levels.LO_L.price).
- Sell-side remaining untaken: **NYAM_L 29089.5 (gates.pillar1.session_levels.NYAM_L.price)** — the only sell-side pool below current price that hasn't been raided. Per strategy §2.2 ("a key low is *not yet taken* → that sell-side remains a draw"), this is the active downside draw.

**HTF bias: `inferred bearish`** — the visible session took out PDL, AS_L, and LO_L (three sell-side pools below) while leaving NYAM_L untaken, and stalled at the LT_LL (the deepest swing low). Path of least resistance per strategy framing is *toward NYAM_L* unless overnight or NY-open reaction proves otherwise. Buy-side above stays as a longer-horizon draw if/when LTF turns.

**b. Overnight & Session Correlation.**
Full session map is now mechanical (`gates.pillar1.session_levels.*`). State by side:
- **Highs (buy-side, all untaken):** NYAM_H 29382.5 → LO_H 29469.5 → AS_H 29733.5 → PDH 29783.75 (ascending order; see `gates.pillar1.untaken_buy_side_above`).
- **Lows (sell-side):** LO_L 29140.75 taken, AS_L 29280 taken, PDL 29448.25 taken — three sell-side pools already raided in this session. Only **NYAM_L 29089.5** remains (see `gates.pillar1.untaken_sell_side_below[0].price`).
- Weekly markers (PWH/PWL) are null in this bundle — strategy §2.1 deprioritizes weekly anyway, so we proceed without them.
- Read: the session *extended* HTF downside, taking three sell-side pools in sequence, but stopped short of NYAM_L. Either the move's exhausted near LT_LL 29110.75 (gates.pillar3.most_recent_structure.LT_LL.price) and we're consolidating before retracing up to fill bearish FVGs, or NYAM_L gets taken on the next session.

**c. NY Open LTF Bias.**
`gates.session.label = Inter-session`, `gates.session.in_ny_open_window = false`. Bundle captures Friday at 16:59 ET — *post* NY-PM killzone (which ends 16:00 ET). **n/a — not in NY open window.** No live NY-reaction signal.

## Pillar 2 — Price Action Quality

- **Range.** 229.5 (gates.pillar2.range_value) across ~100 bars = 2.295 per bar (gates.pillar2.range_per_bar). `gates.pillar2.range_acceptable = true`. Range is acceptable, not tiny.
- **Displacement on HTF.** Not directly assessable from a 1-minute-only bundle (HTF candles not present — pending multi-TF support). On the visible LTF, the drop from 29340.25 (bars.high) to 29110.75 (bars.low) is displacement-down of 229.5 ticks.
- **Candle quality (last 5 bars).** `gates.pillar2.avg_body_ratio_last_5 ≈ 0.51` → `candle_quality_heuristic = marginal`. The recovery candle (bars.last_5_bars[3]) was wide (open 29166.5 → close 29187.75) but the last bar (bars.last_5_bars[4]) faded back to 29172.75 (bars.last_5_bars[4].close) — recovery momentum stalling.
- **Verdict: `marginal`.** Range OK, candle quality not strongly engulfing on the most recent bars.

## Pillar 3 — Entry Model + Confirmation

`gates.price_context.inside_boxes` shows current price (29172.75) is contained by 4 Pine boxes: 2 small Anchored Structures zones (volatility around the recent ST points) and 2 of the 3 ICT Killzones boxes (zones[1] and zones[2]).

**Most recent structure (sorted by `x` from `gates.pillar3.most_recent_structure`):**

| Label | Price | x | Note |
|-------|-------|---|------|
| ST_LL | 29160 (gates.pillar3.most_recent_structure.ST_LL.price) | 1517 (gates.pillar3.most_recent_structure.ST_LL.x) | freshest event — short-term lower low just printed |
| ST_HH | 29175.5 (gates.pillar3.most_recent_structure.ST_HH.price) | 1514 (gates.pillar3.most_recent_structure.ST_HH.x) | prior short-term higher high |
| ST_HL | 29174.5 (gates.pillar3.most_recent_structure.ST_HL.price) | 1513 (gates.pillar3.most_recent_structure.ST_HL.x) | recent short-term higher low |
| ST_LH | 29168 (gates.pillar3.most_recent_structure.ST_LH.price) | 1512 (gates.pillar3.most_recent_structure.ST_LH.x) | recent short-term lower high |
| LT_LL | 29110.75 (gates.pillar3.most_recent_structure.LT_LL.price) | 1491 (gates.pillar3.most_recent_structure.LT_LL.x) | session swing low; matches bars.low |

Reading: most-recent event is **ST_LL @ 29160** — a fresh short-term lower low. For an **MSS up** to confirm, price would need to close above the most-recent ST_LH at 29168 — and 29172.75 (quote.last) IS above 29168. *That's a structural break against the most recent LL.* But a clean MSS up also expects a wide-range displacement candle, which `gates.pillar2.candle_quality_heuristic = marginal` argues against.

**FVG context (from `gates.pillar3.fvg_by_type_above` / `_below`):**
- Above price: 6 bearish FVGs, 2 bearish IFVGs, 0 bullish anything. Overhead supply is heavily one-sided.
- Below price: 1 bullish FVG, 2 bullish IFVGs, 0 bearish. Some underneath support; not deep.

The 8-vs-3 imbalance against the upside is consistent with the down-move that just happened. Retraces up will likely meet resistance at the nearest bearish FVG.

**Walking the MSS components (`entry-models.md`):**

1. **Context & Draw** — HTF inferred bearish; downside draw to NYAM_L not yet completed. For a *bullish* MSS, the strategy wants HTF draw "near completion" — partial: three sell-side pools taken, one still open. **Partial.**
2. **Liquidity Grab** — LT_LL at 29110.75 swept LO_L (29140.75) cleanly. Direction of sweep aligns with HTF bearish — but for a bullish MSS we need a sweep that *completes* the HTF downside, and NYAM_L is still pending. **Partial / premature.**
3. **MSS with Displacement** — Price closed above ST_LH 29168 (29172.75 > 29168), an internal structure break. But `gates.pillar2.candle_quality_heuristic = marginal` (avg body ratio ~0.51); not a clean wide-range displacement candle. **Marginal.**
4. **Retrace to Bullish FVG** — No fresh bullish FVG identifiable in the recovery (1 bullish FVG below price but it's old, not from this recovery leg). **Missing.**
5. **Entry Confirmation** — No FVG to retest. **n/a.**

**Entry model: `null` — MSS context is forming but not yet A+; HTF draw incomplete (NYAM_L untaken) and recovery displacement is marginal. No Trend setup (no clean uptrend). No Inversion setup (bearish IFVGs are above, not relevant for a bullish read).**

**Confirmation status: `n/a`.**

## Risk & Management

n/a — no confirmed setup.

## Grade

**`no-trade`.** Pillar 1 HTF bias inferred (no explicit label), session ended outside any killzone (`gates.session.label = Inter-session`), Pillar 2 marginal, Pillar 3 no clean entry model (HTF downside draw incomplete, MSS components only partial). Multiple weak elements per strategy §7. The strategy says A+ should be rare — capturing a fixture mid-recovery, post-close, no-killzone is clearly not it.

What would change this:
- If NYAM_L 29089.5 (gates.pillar1.session_levels.NYAM_L.price) gets taken next session → HTF downside completes → bullish MSS setup becomes valid candidate.
- Until then, the bias is *toward NYAM_L*, not against it.

---

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "bearish",
    "htf_draw": "NYAM_L at 29089.5 (gates.pillar1.session_levels.NYAM_L.price) — only untaken sell-side below; the natural downside draw",
    "overnight": "3 of 4 sell-side levels taken (PDL 29448.25, AS_L 29280, LO_L 29140.75); only NYAM_L 29089.5 remains; all 4 highs above are untaken (NYAM_H, LO_H, AS_H, PDH)",
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

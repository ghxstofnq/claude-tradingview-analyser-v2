# Fixture 001 — Expected Analysis (Claude-graded)

**Bundle:** `001-current.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 1-minute resolution
**Bundle time:** 2026-05-21 10:12 ET (`gates.session.timestamp_et`) — Thursday, NY AM.
**Phase:** `entry_hunt_ny_am` (`gates.session.phase`), +27m into phase; `is_market_closed = false`.

**Note to reviewer:** Claude-graded baseline applying `trading-strategy-2026.md §7` to the bundle, sourced entirely from the **ICT Engine** (`gates.engine.*`, `engine_by_tf`). Review and amend. *Captured 2026-05-21 as the first new-shape fixture after the ICT Engine migration (docs/plans/2026-05-21-ict-engine-migration.md). Structure labels use the textbook HH/HL/LH/LL convention.*

---

## Pillar 1 — Draw & Bias

**a. HTF Bias.** HTF momentum is firmly up — Daily ran from 25963 (bars_by_tf.daily.open) to 29305.75 (bars_by_tf.daily.close), +12.88% (`bars_by_tf.daily.change_pct`); 4H closed 29306.75 (bars_by_tf.h4.close), +7.56% (`bars_by_tf.h4.change_pct`). 1H is a flat 824-pt range — 824 (bars_by_tf.h1.range) — consolidation, not a turn. The engine's HTF structure agrees: `engine_by_tf.daily`, `.h4`, and `.h1` each carry a bullish `bos`/`mss` as their most recent `structures` entry.

Intraday structure is bullish too — `gates.engine.pillar3.structure_events` is a clean cascade of bullish `bos`/`mss` breaks, the latest a bullish BOS at 29314.75 (gates.engine.pillar3.most_recent_structure.level), `displacement: true`.

**HTF bias: `bullish` — HTF and LTF aligned.**

**b. Overnight & Session Correlation.** Session levels (`gates.engine.pillar1.session_levels`):
- **Swept:** AS.H 29440 (gates.engine.pillar1.session_levels.AS_H.price), PDH 29397 (gates.engine.pillar1.session_levels.PDH.price), and LO.L 29178.25 (gates.engine.pillar1.session_levels.LO_L.price).
- The LO.L raid is the key tell: `gates.engine.pillar1.sweeps` records a sell-side sweep at 29178.25 (gates.engine.pillar1.sweeps[1].price) with `rejected: true` — a **failure swing**, price was driven below London's low and rejected straight back up. That rejected sweep is what kicked off the bullish BOS cascade.
- **Untaken sell-side below:** NYAM.L 29172.25 (gates.engine.pillar1.untaken_sell_side_below[0].price), AS.L 29113 (gates.engine.pillar1.untaken_sell_side_below[1].price), PDL 28796 (gates.engine.pillar1.untaken_sell_side_below[2].price).
- **Untaken buy-side above:** NYAM.H 29338.75 (gates.engine.pillar1.session_levels.NYAM_H.price), LO.H 29463.25 (gates.engine.pillar1.session_levels.LO_H.price), PWH 29783.75 (gates.engine.pillar1.session_levels.PWH.price).

**Primary HTF draw:** buy-side above. With price at 29296 (quote.last), the nearest draw is NYAM.H 29338.75; beyond it LO.H 29463.25. HTF bearish-FVG supply sits overhead in the ~29414–29531 band (`engine_by_tf.h1.fvgs`), so LO.H is guarded.

**c. NY Open reaction.** Past the 09:30–09:45 window; LTF reaction has resolved bullish — the rejected LO.L sweep plus the BOS cascade is NY aligning with the HTF draw.

## Pillar 2 — Price Action Quality

The engine quality verdict (`gates.engine.pillar2`):
- **Current TF / m5 / m15:** `range_3h` is 166.5 (gates.engine.pillar2.current_tf.range_3h), `range_quality: tight`; `displacement: weak`; `has_chop: true`. m5 and m15 both report `candle: doji_wick` — small-bodied, wicky bars. m15 `range_3h` is the same — 166.5 (gates.engine.pillar2.m15.range_3h).
- **Counterpoint:** every recent `structure_events` break carries `displacement: true`. The rolling 3-hour window is choppy/tight, but the breaks themselves displaced cleanly — the engine's `quality` row is a lagging summary, not a verdict on the setup.
- **Verdict: `marginal`** — chop and doji-wick anatomy are real (don't force size), but the structural displacement is genuine. Not `poor`; not `good`.

## Pillar 3 — Entry Model + Confirmation

**Structure.** `gates.engine.pillar3.structure_events` is an all-bullish cascade — internal `mss`/`bos` breaks plus a swing-tier bullish `mss`, the latest a bullish BOS at 29314.75 (gates.engine.pillar3.most_recent_structure.level). The FVG summary (`gates.engine.pillar3.fvg_summary`) counts bullish FVGs at 3 (gates.engine.pillar3.fvg_summary.by_type.bullish_fvg), with no fresh bearish FVGs.

**The setup.** Price 29296 (quote.last) is sitting inside a bullish FVG — `gates.engine.price_context.inside_fvgs` carries one spanning 29296 (gates.engine.price_context.inside_fvgs[1].bottom) to 29304 (gates.engine.price_context.inside_fvgs[1].top), CE 29300 (gates.engine.price_context.inside_fvgs[1].ce), with a strong displacement score of 0.95 (gates.engine.price_context.inside_fvgs[1].disp_score).

**Entry-model walk:**
- **MSS** — no fresh liquidity grab + reversal in play; the LO.L sweep already resolved into a trend leg, not a pending reversal. Not the model.
- **Trend** — fits. HTF + LTF aligned bullish, an impulse leg (the BOS cascade), and price has pulled back into an **internal bullish FVG** (the 29296–29304 zone, disp_score 0.95) in the direction of the trend. This is the Trend pullback-into-FVG stage.
- **Inversion** — no opposing PD array being violated here. Not the model.

**Confirmation.** Not there yet. The 1m last bar (`gates.engine.confirmation.last_bar`) is **bearish**, body ratio 0.31 (gates.engine.confirmation.last_bar.body_ratio), close 29296 (gates.engine.confirmation.last_bar.close) at close-position-in-range 0.25 (gates.engine.confirmation.last_bar.close_position_in_range) — a weak bar closing on its low. The 5m bar is also bearish, body ratio 0.64 (gates.engine.confirmation.m5_last_bar.body_ratio). The 15m closed at 29302.5 (gates.engine.confirmation.m15_last_bar.close). No bullish confirmation close into the FVG.

**Entry model: `Trend` — candidate.** **Confirmation status: `candidate`** — the setup is formed (price in the high-displacement bullish FVG) but waiting on a bullish 1m/5m close off the zone.

## Risk & Management

n/a — no confirmed entry. **Watch:** a strong bullish 1m/5m close holding the 29296–29304 FVG (above its CE) confirms a Trend long — stop below the FVG / below LO.L, TP1 at NYAM.H, TP2 toward LO.H. If price closes back below the FVG low and breaks the bullish structure, the candidate is invalidated.

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "bullish",
    "htf_draw": "HTF bullish (Daily +12.88%, 4H +7.56%) and LTF aligned via a bullish BOS/MSS cascade. Primary draw is buy-side above: NYAM.H 29338.75 first, then LO.H 29463.25, PWH 29783.75. HTF bearish-FVG supply guards ~29414-29531.",
    "overnight": "LO.L 29178.25 was sell-swept and rejected (failure swing) — the trigger for the bullish leg. AS.H and PDH also swept. Untaken sell-side below: NYAM.L 29172.25, AS.L 29113, PDL 28796.",
    "ny_reaction": "NY reaction resolved bullish — rejected LO.L sweep plus a clean bullish BOS cascade; LTF aligned with the HTF draw."
  },
  "pillar2": {
    "range_acceptable": false,
    "displacement_present": true,
    "candle_quality": "marginal",
    "verdict": "marginal"
  },
  "pillar3": {
    "entry_model": "Trend",
    "confirmation_status": "candidate"
  },
  "trade": {
    "entry": null,
    "stop": null,
    "target_tp1": null,
    "target_tp2": null,
    "invalidation": "Bullish close back below the 29296-29304 FVG breaking structure invalidates the Trend candidate."
  },
  "grade": "no-trade"
}
```

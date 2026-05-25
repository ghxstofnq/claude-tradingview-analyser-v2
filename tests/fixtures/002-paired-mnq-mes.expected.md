# Fixture 002 — Expected Analysis (Claude-graded)

**Bundle:** `002-paired-mnq-mes.bundle.json`
**Chart:** CME_MINI:MNQ1! @ 5-minute resolution (primary); secondary captured CME_MINI:MES1! @ 5-minute resolution
**Bundle time:** 2026-05-25 04:10 ET (`gates.session.timestamp_et`) — Monday, London Open.
**Phase:** `london_open` (`gates.session.phase`); `is_market_closed = false`.

**Note to reviewer:** First paired-bundle fixture (`tv analyze --pair MNQ1!,MES1!`). Exercises the new `pair.symbols.{MNQ1!, MES1!}` block end-to-end. Captured during London Open (no NY open-reaction window active) so `pair.leader_evidence.reason` is `"no_fvgs_created_in_window"` — the leader pick is correctly inconclusive. This fixture's role is structural: confirm both symbols' sub-bundles are populated with the expected shape; confirm the leader rule returns `null` outside the open-reaction window. A future fixture captured during `open_reaction_ny_am` will exercise a real leader call.

---

## Pillar 1 — Draw & Bias (synthesized across both symbols)

**HTF Bias.** Both indices show strong upward momentum on the daily — MNQ daily +16.62% (pair.symbols.MNQ1!.bars_by_tf.daily.change_pct), range 7034.5 (pair.symbols.MNQ1!.bars_by_tf.daily.range); MES daily +8.71% (pair.symbols.MES1!.bars_by_tf.daily.change_pct), range 1214.25 (pair.symbols.MES1!.bars_by_tf.daily.range). The two indices are directionally aligned on the daily — both bullish — with MNQ moving harder in percentage terms (Nasdaq's higher-beta profile).

**Primary HTF draw.** With MNQ at 29943.25 (pair.symbols.MNQ1!.quote.last) and MES at 7557.25 (pair.symbols.MES1!.quote.last), both sit close to or above their Asia ranges. On the MNQ side, AS.H 29995 (pair.symbols.MNQ1!.gates.engine.pillar1.session_levels.AS_H.price) is untaken — the near-term buy-side draw. AS.L 29672 (pair.symbols.MNQ1!.gates.engine.pillar1.session_levels.AS_L.price) is the symmetric sell-side; NYAM.H 29718.25 (pair.symbols.MNQ1!.gates.engine.pillar1.session_levels.NYAM_H.price) is already swept from Friday's NY AM.

**Overnight context.** London Open is forming: LO.H 29987.25 (pair.symbols.MNQ1!.gates.engine.pillar1.session_levels.LO_H.price, `state: "forming"`) and LO.L 29888.75 (pair.symbols.MNQ1!.gates.engine.pillar1.session_levels.LO_L.price, `state: "forming"`) — neither swept. Price is between LO.L and LO.H, building the London range.

**HTF bias: `bullish`** — both symbols aligned, MNQ leading directionally (higher daily change_pct), MES correlated.

## Pillar 2 — Price Action Quality (both symbols)

The engine quality verdict is identical across the pair on the current TF (pair.symbols.MNQ1!.gates.engine.pillar2.current_tf and pair.symbols.MES1!.gates.engine.pillar2.current_tf):
- `range_quality: tight` on both.
- `displacement: acceptable` on both.
- `candle: engulfing` on both.
- `has_chop: true` on both.

The tight range + chop verdict is typical of London Open before the NY session injects direction. The `engulfing` candle and `acceptable` displacement say there's still some pressure in the bars; this isn't dead consolidation.

**Verdict: `marginal`** — engine quality says tight/choppy, but both symbols are showing engulfing-class bars with acceptable displacement. Watch the NY open at 09:30 ET; the read shifts then.

## Pillar 3 — Entry Model + Confirmation

Not applicable in `london_open` phase. The strategy's entry-hunt logic runs during `entry_hunt_ny_am` / `entry_hunt_ny_pm`. London Open is a context-build window only.

## Leader evidence

`pair.leader_evidence` (pair.leader_evidence.reason): `no_fvgs_created_in_window`. Both `primary_disp_score` (pair.leader_evidence.primary_disp_score) and `secondary_disp_score` (pair.leader_evidence.secondary_disp_score) are 0 because `pair.window_start_ms` is `null` (pair.window_start_ms) — no NY open-reaction window is active. The threshold is 0.1 (pair.leader_evidence.threshold) as designed; margin is 0 (pair.leader_evidence.margin).

**Expected leader: inconclusive** — by design, outside `open_reaction_*` phases.

**`pair.leader_decided`:** false (pair.leader_decided).
**`pair.leader`:** null (pair.leader). Will be set by `surface_leader_decision` at minute 14 of the next NY open-reaction.

## Final grade: `no-trade`

Outside the actionable phase (London Open, pre-NY). Both symbols' HTF context is in place; the leader pick will resolve when NY AM's open reaction runs.

## Structured output

```json
{
  "pillar1": {
    "htf_bias": "bullish",
    "htf_draw": "Both indices bullish on daily — MNQ +16.62%, MES +8.71%. Near-term draws: AS.H 29995 (untaken buy-side) for MNQ; London range forming between LO.L 29888.75 and LO.H 29987.25.",
    "overnight": "Asia complete (AS.H 29995, AS.L 29672, both untaken). London forming. NYAM.H 29718.25 already swept from Friday.",
    "ny_reaction": "n/a — London Open phase, NY hasn't opened yet."
  },
  "pillar2": {
    "range_acceptable": false,
    "displacement_present": true,
    "candle_quality": "marginal",
    "verdict": "marginal"
  },
  "pillar3": {
    "entry_model": null,
    "confirmation_status": null
  },
  "pair": {
    "primary": "MNQ1!",
    "secondary": "MES1!",
    "leader": null,
    "leader_reason": "no_fvgs_created_in_window"
  },
  "trade": {
    "entry": null,
    "stop": null,
    "target_tp1": null,
    "target_tp2": null,
    "invalidation": "n/a — outside actionable phase."
  },
  "grade": "no-trade"
}
```

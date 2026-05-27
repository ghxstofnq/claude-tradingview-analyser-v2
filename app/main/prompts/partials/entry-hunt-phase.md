<phase name="entry_hunt">

You are in entry hunt. A precomputed `<candidate_object>` block has been injected above. The detector has already evaluated every entry-model rule against engine state. **Your job is to package and narrate, not to interpret strategy.**

## Procedure

1. Read `<candidate_object>`.
2. If `best_candidate` is non-null:
   - Call `surface_setup` with EXACTLY these values from best_candidate:
     - `model` = best_candidate.model
     - `side` = best_candidate.side
     - `entry` = best_candidate.entry.value, `entry_cite` = best_candidate.entry.cite
     - `stop` = best_candidate.stop.value (must be one of best_candidate.stop_options), `stop_cite` = best_candidate.stop.cite
     - `tp1` = best_candidate.tp1.value, `tp1_cite` = best_candidate.tp1.cite
     - `tp2` = best_candidate.tp2.value, `tp2_cite` = best_candidate.tp2.cite
     - `grade` = best_candidate.grade_capped (NOT grade_proposed; the cap is enforced)
   - Write 2-3 sentences for the `narration` field explaining the chain (what set it up, what triggered, what's at risk, what closes the chain).
3. If `best_candidate` is null:
   - Call `surface_no_trade` with `reason` = candidate.rejection_summary (verbatim).
   - Add a 1-sentence `note` describing what to watch on the next bar.

## You may NOT

- Override the detector's pick or surface a setup it didn't find. If you disagree, call `surface_no_trade` and set `chain_status: degraded:disagreement` with a 1-sentence reason in `note`. The detector's decision stands; you cannot trade.
- Promote `grade` past `grade_capped`. The validator rejects this.
- Substitute a different stop value than one of `stop_options[]`. Pick `stop_options[0]` unless its cite fails to resolve, then `stop_options[1]`.
- Substitute a TP that isn't from `untaken_above[]` / `untaken_below[]`. Detector already filtered; use its picks.
- Walk strategy from scratch. The detector has done that work. Trust the components.

See `<anti_patterns>` block below for the 8 specific misreads from the 2026-05-26 session you must avoid.

### Append-only bookkeeping

After the surface_setup or surface_no_trade call, append to `<sdir>/bars.jsonl`:

```jsonl
{"time": <bar_time>, "tf": "1m", "o": <open>, "h": <high>, "l": <low>, "c": <close>, "body_ratio": <bratio>, "direction": "<dir>", "close_position_in_range": <cp>}
```

(Use `gates.engine.confirmation.last_bar.*`. Write `tf: "5m"` to `bars-5m.jsonl` on 5m boundaries.)

If a setup fired, also append to `<sdir>/setups.jsonl`:

```jsonl
{"ts": "<iso>", "bar_time": <t>, "tf": "1m", "model": "<best_candidate.model>", "status": "confirmed", "side": "<best_candidate.side>", "rationale": "<narration verbatim>"}
```

</phase>

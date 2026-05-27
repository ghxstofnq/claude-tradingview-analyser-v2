---
description: Phase file for the catch-up purpose. Fires when the open-reaction window was missed (started after 09:45 ET for NY AM / 13:45 for NY PM). Backfills ltf-bias.md and pair-decision.json so subsequent bars route to entry-hunt normally. Carries catch_up + open_reaction (fallthrough) + entry-hunt content.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

End every analysis turn with exactly one tool call, in this order of priority:

1. If a valid setup is in play graded `A+` or `B` — call `mcp__tv__surface_setup` with the full setup payload (grade, model, direction, entry, stop, tp1, tp2, invalidation, rr, confirmation_status, tf, pillar_breakdown). Do this after your prose reasoning. `tf` is "1m" or "5m" — stamp it to match the TF of the bar that triggered this turn. `pillar_breakdown` is an array of three pillars ('Draw & Bias' / 'Price-Action Quality' / 'Entry + Confirmation'), each with a status and 2–3 named elements. Skipping pillar_breakdown hides the alignment panel.

2. Otherwise (any reason you would have written "no-trade" in prose) — call `mcp__tv__surface_no_trade` with a short `reason` string. Examples: "outside active session", "no entry model in play", "price quality weak — premium/discount unclear", "HTF/LTF opposed — retrace day".

Writing "no trade" or "no setup" in prose without calling `surface_no_trade` leaves the UI stuck on the previous state.

To read the chart, use `mcp__tv__tv_analyze_full` (full multi-TF sweep) or `mcp__tv__tv_analyze_fast` (1-bar poll with a baseline path).

Open-reaction phase: when the per-bar message says "Phase: open_reaction", call `mcp__tv__surface_open_reaction` with the latest read. When `minutes_into_phase` >= 14, also call `mcp__tv__surface_leader_decision` + `mcp__tv__surface_ltf_bias` to finalize bias. Either way, still end with `mcp__tv__surface_no_trade` — no setup card during open-reaction.

<!-- @partial:bundle-fields -->

<!-- @partial:open-reaction-phase -->

<phase name="catch_up">

**Goal:** synthesize a missed `open_reaction` after the window has passed (NY open ≥ 09:45 ET / 13:45 ET) but `ltf-bias.md` doesn't exist. Best-effort backfill so `entry_hunt` has the chain anchors it needs.

**Triggered by:** the bar-close router when (a) `ltf-bias.md` is missing, (b) `pillar1.md` exists, (c) current ET time is past the open-reaction window for the active session. See `app/main/bar-close.js` `shouldRouteToCatchUp`.

**Required reads:**
- `<sdir>/pillar1.md` frontmatter → both symbols' `primary_draw` + `pillar_grade`.
- Live bundle including `pair.leader_evidence` (if `pair` present).

### Behavior

1. Run the leader decision + LTF bias synthesis exactly like `<phase name="open_reaction">` Minute 14, but on data that has drifted past the actual open.

2. Compute `backfill_lag_minutes` = (now ET) − (window start). Window starts at 09:30 ET (NY AM) / 13:30 ET (NY PM).

3. Write `ltf-bias.md` with the structured handoff:

```yaml
---
phase: open_reaction_<session>_complete
finalized_at: <now>
backfilled: true
backfill_lag_minutes: <int>
leader: <chosen>
ltf_bias: <bullish|bearish|mixed|stand_aside>
htf_ltf_alignment: <aligned|divergent|unclear>
is_retrace_day: <bool>
entry_model_priority: <MSS|Trend|Inversion|undecided>
priority_reason: <one-line>
grade_cap: B                  # catch-up ALWAYS caps at B (we didn't see the actual open)
chain_status: backfilled:open_reaction
---
```

4. Also call `surface_leader_decision` so `pair-decision.json` lands. Subsequent `tv analyze --pair` runs short-circuit to single-symbol.

5. Chat output flags the backfill explicitly: *"Backfilled open-reaction at &lt;ET&gt; (&lt;lag&gt;min late). Grade capped at B for this session."*

After this fires, subsequent bars route to `<phase name="entry_hunt">` normally.

### Self-check

- `grade_cap: B` is mandatory (no A+ in backfilled sessions).
- `backfilled: true` and `backfill_lag_minutes` set.
- `chain_status: backfilled:open_reaction`.
- Both `surface_leader_decision` AND `surface_ltf_bias` fired in this turn.

</phase>

<!-- @partial:entry-hunt-phase -->

<!-- @partial:anti-patterns -->

<!-- @partial:ict-vocab -->

<!-- @partial:examples -->

<!-- @partial:output-json -->

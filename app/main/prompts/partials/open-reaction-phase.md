<phase name="open_reaction">

**Goal:** first 15 min of NY's reaction to overnight levels (09:30-09:45 ET / 13:30-13:45 ET). Read the brief's structured handoff, watch live engine, decide leader + LTF bias at **minute 14** (09:44 ET NY AM / 13:44 ET NY PM).

### Required reads first

- **`state/last-scan.digest.json` — NOT the full bundle.** After `mcp__tv__tv_analyze_fast` runs (the per-bar hint instructs you to call it with `pair=...` + `baseline=...` + `baseline_secondary=...`), the analyzer writes a slim pretty-printed sidecar at `state/last-scan.digest.json` (~15 KB, ~500 lines). It contains `leader_evidence` (primary_disp_score / secondary_disp_score / margin / threshold / reason) plus per-symbol HTF / Pillar1 / Pillar2 summaries. The full bundle (`state/last-scan.json`) is one giant single-line JSON whose lines exceed the Read tool's per-line truncation — Read returns only the first ~2000 chars of each line and `pair.leader_evidence` is unreachable. Cite as `pair.leader_evidence.*` (the digest's `leader_evidence` is pulled verbatim from `bundle.pair.leader_evidence` — same value, same cite). **If you find yourself writing "bundle unreadable" or "leader_evidence not cited", Read the digest path instead.**
- `<sdir>/pillar1.md` frontmatter → both symbols' `mnq:`/`mes:` sections with `primary_draw`, `htf_destination`, `path_to_destination`, `pillar_grade`, `no_trade_reason`. If `pillar1.md` doesn't exist, that's a prereq error — say so and stop.
- `<sdir>/pillar2.md` frontmatter → `pillar2_verdict` per symbol.
- `<sdir>/open-reaction.md` if it exists (we're appending).

### Step 0 — Brief = no-trade gate (do this FIRST)

Branch on `pillar_grade` from pillar1.md:

| Grade | `no_trade_reason` | Behavior |
|---|---|---|
| `A+` / `B` | n/a | Normal flow below |
| `no-trade` | `data_gap` / `engine_stale` / `session_closed` | **Hard skip.** Write `open-reaction.md` with `chain_status: degraded:brief_no_trade_hard`. No `ltf-bias.md` write, no `surface_leader_decision`. Surface `surface_no_trade("brief no-trade: <reason>")`. Stop. |
| `no-trade` | `pillar2_poor` / `htf_unclear` | **Soft observe.** Continue to the leader decision. At minute 14 write `ltf-bias.md` with `ltf_bias: stand_aside`, `chain_status: degraded:brief_no_trade_soft`. The model may flag in chat if conditions clearly recover (doji_wick → engulfing + clean displacement). |

### Minutes 0-13 — per-bar observation

Read `gates.engine.confirmation.last_bar`, `gates.engine.pillar1.sweeps`, `gates.engine.most_recent_structure`, `pair.leader_evidence`.

Append to `<sdir>/open-reaction.md`:

```markdown
## Latest read (<timestamp>, +<minutes_into_phase>m)
MNQ disp_score=<n> (pair.leader_evidence.primary_disp_score) vs MES <n> (pair.leader_evidence.secondary_disp_score), margin=<n>, threshold=<n>.
What each symbol did vs path_to_destination: <one sentence cited>.
```

### Minute 14 — DECISION (two parallel writes)

#### A) Leader decision

Read `pair.leader_evidence` once more. Resolve leader:

| `reason` | Leader | `chain_status` for pair-decision.json |
|---|---|---|
| `primary_higher_disp_score` (margin ≥ threshold) | primary | `clean` |
| `secondary_higher_disp_score` (margin ≥ threshold) | secondary | `clean` |
| `inconclusive_margin_below_threshold` | **primary (default)** | `degraded:leader_inconclusive` |
| `no_fvgs_created_in_window` | **primary (default)** | `degraded:no_fvgs_in_window` |
| `secondary_engine_missing` | primary | `degraded:secondary_missing` |

Call `surface_leader_decision` with the chosen leader + evidence + reason verbatim from `pair.leader_evidence`.

#### B) LTF bias finalization

Computed on the chosen leader, using its `pillar1.<leader>` section + live engine.

Compute `entry_model_priority` from this decision tree:

```
if pillar2_verdict == "poor":            → "undecided"
elif htf_ltf_alignment == "divergent":   → "MSS" (LTF reversal at HTF level)
elif htf_ltf_alignment == "aligned":
   if recent failure_swings (mss+sweep): → "MSS"   (cite: failure_swings[0])
   elif recent BoS in bias direction:    → "Trend" (cite: most_recent_structure)
   elif opposing FVG state=inverted:     → "Inversion" (cite: fvgs[where state=inverted])
   else:                                 → "undecided"
elif htf_ltf_alignment == "unclear":     → "undecided"
```

`surface_ltf_bias` runtime cross-checks this against `cli/lib/entry-model-priority.js`. Mismatches log a warning; the model's choice wins (but `undecided` is always honored).

Call `surface_ltf_bias` with:

```
{
  session: "ny-am" | "ny-pm" | "london",
  leader: "MNQ1!" (or whichever),
  ltf_bias: "bullish" | "bearish" | "mixed" | "stand_aside",
  htf_ltf_alignment: "aligned" | "divergent" | "unclear",
  is_retrace_day: <bool>,    // divergent + HTF draw still untouched
  entry_model_priority: "MSS" | "Trend" | "Inversion" | "undecided",
  priority_reason: "<one-line cite, e.g. 'failure_swings[0]'>",
  grade_cap: "A+" | "B",     // B if divergent (HTF/LTF clash)
  chain_status: "clean" | "degraded:<reason>" | "divergent",
  reasoning: "<one paragraph, cited>",
  // Cross-check inputs (optional but recommended):
  pillar2_verdict: <as in pillar2.md>,
  failure_swings_present: <bool>,
  most_recent_structure: { event, dir, confirmed_ms } | null,
  inverted_fvg_present: <bool>
}
```

### Divergence handling (HTF/LTF clash)

If `htf_ltf_alignment: divergent`:
- `ltf_bias` follows NY reaction direction
- `is_retrace_day: true`
- `grade_cap: B` (entry_hunt cannot surface A+ this session)
- `pillar1.<leader>.primary_draw` stays valid as **end-of-day runner target** — not invalidated
- `chain_status: divergent`

### Self-check before tool calls

- Leader decision uses verbatim `pair.leader_evidence.reason`.
- `entry_model_priority` matches the decision tree.
- `grade_cap` is `B` if and only if `htf_ltf_alignment == divergent`.
- Backfill case (caught up after window) → `chain_status: backfilled:open_reaction` + `grade_cap: B` (see `<phase name="catch_up">`).

If any check fails, fix the payload, then call `surface_leader_decision` + `surface_ltf_bias`.

</phase>

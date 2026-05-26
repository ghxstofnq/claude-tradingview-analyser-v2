# Strategy Chain Design — brief → open_reaction → entry_hunt → wrap

**Date:** 2026-05-26
**Status:** Draft for review
**Driver:** The 2026-05-26 London brief surfaced output that admitted "HTF not refreshed" while HTF data sat in the bundle. Root cause: the dual-symbol bundle (~420KB) exceeds the Read tool's effective window — the `pair` block at chars 140k-420k is unreachable. Old prompts let the model fabricate; the rewritten prompt (PR #60) refuses honestly. The brief turn now correctly bails to no-trade.

Two follow-ups fall out: (1) make HTF data reachable via a slim digest, (2) tighten the brief → open_reaction → entry_hunt → wrap **chain** so each phase emits structured handoffs the next phase mechanically consumes. The strategy is a 7-step checklist; the chain mirrors it exactly.

This document is the design for both.

## Strategy authority

This implements [docs/strategy/trading-strategy-2026.md](../../strategy/trading-strategy-2026.md) — Lanto's 3-pillar ICT framework. The chain corresponds to strategy §7 steps 1-7:

| Strategy step | Chain phase | Output file |
|---|---|---|
| 1. HTF Bias (Daily / 4H / 1H) | brief | `pillar1.md` frontmatter |
| 2. Overnight & Session Correlation | brief | `pillar1.md` frontmatter |
| 3. Price Quality Filter | brief | `pillar2.md` frontmatter |
| 4. NY Open LTF Bias | open_reaction | `ltf-bias.md` + `pair-decision.json` |
| 5. Choose Entry Model | entry_hunt | per-bar prompt + `setups.jsonl` |
| 6. Confirmation & Execution | entry_hunt | `setups.jsonl` + `surface_setup` |
| 7. Sizing & Management | entry_hunt | `surface_setup.sizing_note` + sizing helper |

## Design decisions

Six clarifying questions resolved during brainstorming:

1. **HTF/LTF clash policy** — LTF overrides intraday; HTF primary_draw stays valid as end-of-day runner target; grade capped at B. (Matches strategy §2.3 "never marries a bias.")
2. **Leader inconclusive** — Default to primary symbol (MNQ1!). `chain_status: degraded:leader_inconclusive` flagged for audit.
3. **No-trade propagation** — Per-reason: data/engine reasons hard-short-circuit; chop/quality reasons soft (phases observe but don't surface).
4. **Sizing rule storage** — Strategy spec (`docs/strategy/sizing-table.md`) + code helper (`cli/lib/sizing.js`). Memory.USER can override.
5. **Pillar files in dual-symbol** — Comparative single file (`pillar1.md` with `mnq:` + `mes:` sections), re-rendered from per-symbol `brief-<sym>.json` on each surface call.
6. **Open-reaction missed** — Catch-up phase backfills `ltf-bias.md` + `pair-decision.json` from current bundle; grade always capped at B for backfilled sessions.

**Contract style:** Soft handoffs with explicit fallbacks. Each phase tries to read prior structured output; if missing, falls back to live data + sensible defaults; emits `chain_status` documenting what was found vs synthesized. Catch-up phase backfills the most-common missing case (open_reaction).

## Architecture

```
PRE-NY              NY 09:30-09:45         NY 09:45-16:00              POST-NY
[brief] ──────► [open_reaction] ──────► [entry_hunt] ──────► [wrap]
   │                  │                       │                  │
   │            (catch-up                     │                  │
   │             backfill if                  │                  │
   │             open-rxn missed)             │                  │
   │                  │                       │                  │
   ▼                  ▼                       ▼                  ▼
pillar1.md       ltf-bias.md            setups.jsonl       summary.md
pillar2.md       pair-decision.json      surface_setup       (chain audit)
brief-<sym>.json  open-reaction.md
```

Each markdown file gains **structured frontmatter** that downstream phases parse. Markdown body stays human-readable. Frontmatter is the contract.

### `chain_status` enum

Every phase emits this in its frontmatter:

| Value | Meaning |
|---|---|
| `clean` | All inputs read, all outputs structured |
| `degraded:<reason>` | Output produced with a flagged caveat (e.g. `degraded:leader_inconclusive`) |
| `backfilled:<phase>` | Output synthesized after the fact (e.g. `backfilled:open_reaction`) |
| `divergent` | Open-reaction found HTF/LTF clash; grade capped |
| `stale:<minutes>` | Upstream output was N minutes older than the bar |

Chain audit in `summary.md` strings these together for post-session review.

## Brief phase (strategy steps 1-3)

### 2.1 Bundle-level: `brief_digest`

New top-level field in `state/last-analyze.json` when `--pair`. Computed in `cli/lib/brief-digest.js`. Per symbol:

```yaml
brief_digest.symbols.<sym>:
  htf.{daily,h4,h1}:
    change_pct, range                                # bars_by_tf.<tf>.*
    top_fvgs[0..2]                                   # ranked: (state=fresh, took_liq, disp_score)
                                                     # each: {kind, dir, top, bottom, ce, disp_score, took_liq, state, size_quality, cite}
    top_bprs[0..2]                                   # same shape for BPRs
    recent_structures[0..1]                          # latest by confirmed_ms — {event, dir, level, displacement, tier, validation, is_reclaimed, cite}
    quality                                          # {range_3h, range_quality, displacement, candle, atr_14, atr_17, cite}
  pillar1:
    session_levels                                   # all 10 (PWH/PWL/PDH/PDL/AS_*/LO_*/NYAM_*)
    sweeps[]                                         # with rejected flag
    untaken_pools_above[0..2], untaken_pools_below[0..2]
  pillar2:
    current_tf, m5, m15                              # full quality objects
  ltf_context:                                       # scenario-building
    inside_fvgs[], inside_bprs[]
    nearest_opposing_fvg_above, nearest_opposing_fvg_below
    most_recent_structure
brief_digest.leader_evidence                         # {primary_disp_score, secondary_disp_score, margin, threshold, reason, cite}
```

Size: ~7-15KB per symbol. Both symbols + leader_evidence: ~17-32KB. Fits within Read's window.

### 2.2 Brief prompt rewrite (`<phase name="brief">`)

For **each symbol**, the model walks the 7 strategy steps:

1. **HTF Bias per TF** — daily/h4/h1: cite momentum (`change_pct`), HTF FVGs + BPRs + iFVGs (`top_fvgs`/`top_bprs`), recent structure events. Emit bias verdict with per-TF citation.
2. **Primary HTF PD array** — from top-3 ranked FVGs/BPRs across daily/h4/h1, pick ONE with highest `disp_score × took_liq` AND state ∈ {fresh, ce_tapped, inverted}. Anchor everything downstream.
3. **Overnight & Session** — walk all 10 session levels (taken/untaken), surface failure-swing sweeps, list `untaken_pools_above/below`. Emit `overnight_verdict` (extending_htf / retracing_htf / consolidating) and `path_to_destination` (clear / capped_by_<level> / contradicted_by_<level>).
4. **Pillar 2 quality** — current_tf + m5 + m15 + h4 quality + h1 quality + primary_draw size. Emit `pillar2_verdict` (good / marginal / poor).
5. **Deterministic grade** — A+/B/no-trade by counting weak/missing elements.
6. **Scenarios** — 2-4 IF/THEN. Each cites a level from ltf_context or session_levels.
7. **Sizing note** — from `cli/lib/sizing.js` + memory.USER override. Cite both sources.

Self-check before tool call: primary_draw named + cited; htf_bias notes cite per-TF; no arithmetic; pillar_grade matches weak/missing count; if `pillar_grade=no-trade`, `no_trade_reason` is set.

### 2.3 Schema additions to `surface_session_brief`

```typescript
primary_draw: {
  tf: "daily" | "h4" | "h1",
  kind: "fvg" | "bpr" | "ifvg",
  dir: "bull" | "bear",
  top: number, bottom: number, ce: number,
  disp_score: number, took_liq: boolean,
  state: "fresh" | "ce_tapped" | "filled" | "inverted" | "invalidated",
  cite: string                                       // /engine_by_tf\.(daily|h4|h1)\.(fvgs|bprs)/
}
htf_destination: string                              // "above 30000 buy-side" / "below 29400 sell-side" / "balanced"
overnight: {
  asia:   { high, low, state: "extended"|"swept"|"untaken", cite },
  london: { high, low, state, cite },
  untaken_above: [{name, price, cite}],
  untaken_below: [{name, price, cite}],
  overnight_verdict: "extending_htf" | "retracing_htf" | "consolidating",
  path_to_destination: string
}
htf_quality: {
  h4: {range_quality, displacement, candle, cite},
  h1: {range_quality, displacement, candle, cite}
}
pillar2_verdict: "good" | "marginal" | "poor"
no_trade_reason: ?"data_gap" | "engine_stale" | "pillar2_poor" | "htf_unclear" | "session_closed"
                                                     // required iff pillar_grade==="no-trade"
chain_status: "clean" | "degraded:<reason>"
```

### 2.4 `writeBrief` changes (`session-memory.js`)

- Stash per-symbol payloads between the two surface calls.
- After EACH surface call, re-render `pillar1.md` + `pillar2.md` from BOTH `brief-<sym>.json` files that exist on disk. So after MNQ's call, the file has only `## MNQ1!` section; after MES's call, both sections.
- Frontmatter carries structured handoff per symbol under `mnq:` / `mes:` keys.
- `brief.json` mirror stays as today (primary only) for legacy review/journal.

## Open-reaction phase (strategy step 4)

### 3.1 Phase mechanics

Fires per-bar from 09:30-09:45 ET (NY AM) / 13:30-13:45 ET (NY PM). "Minute 14" below = the 14th minute of this window (09:44 ET for NY AM, 13:44 ET for NY PM).

Reads:

- `pillar1.md` frontmatter → both symbols' `primary_draw`, `htf_destination`, `path_to_destination`
- `pillar2.md` frontmatter → `pillar2_verdict` (gate: if `poor`, `ltf_bias` defaults to `stand_aside`)
- `pillar1.md` frontmatter → `pillar_grade` + `no_trade_reason` (gates below)
- Live engine: `gates.engine.confirmation.last_bar`, `pillar1.sweeps`, `most_recent_structure`, `pair.leader_evidence`

### 3.1a Brief = no-trade gate

Before running the leader / ltf-bias logic, branch on the brief's verdict:

| `brief.pillar_grade` | `no_trade_reason` | Open-reaction behavior |
|---|---|---|
| `A+` or `B` | n/a | Normal flow (3.1 onward) |
| `no-trade` | `data_gap` / `engine_stale` / `session_closed` | **Hard skip** — write `open-reaction.md` with `chain_status: degraded:brief_no_trade_hard`, no ltf-bias.md, no leader decision |
| `no-trade` | `pillar2_poor` / `htf_unclear` | **Soft observe** — finalize `ltf-bias.md` with `ltf_bias: stand_aside`, `chain_status: degraded:brief_no_trade_soft`. Leader decision still runs (so the audit captures who-led-the-fake-rally). Model may flag a chat note if conditions clearly recovered (e.g. doji_wick → engulfing + clean displacement) |

**Minutes 0-13** — per-bar log to `open-reaction.md`. Cites `pair.leader_evidence.*` for observability. Tracks what each symbol did vs its `path_to_destination`.

**Minute 14** — leader decision + ltf-bias finalization in parallel.

### 3.2 Leader decision

Mechanical resolution from `pair.leader_evidence`:

| `reason` | leader | `pair-decision.json.chain_status` |
|---|---|---|
| `primary_higher_disp_score` (margin ≥ threshold) | primary | `clean` |
| `secondary_higher_disp_score` (margin ≥ threshold) | secondary | `clean` |
| `inconclusive_margin_below_threshold` | **primary (default)** | `degraded:leader_inconclusive` |
| `no_fvgs_created_in_window` | **primary (default)** | `degraded:no_fvgs_in_window` |
| `secondary_engine_missing` | primary | `degraded:secondary_missing` |

Call `surface_leader_decision` with leader + evidence + reason verbatim. After this fires, the next `tv analyze --pair` returns `pair_short_circuited: true` and the bundle is single-symbol.

### 3.3 `ltf-bias.md` finalization

Computed on the chosen leader using its `pillar1.<leader>` section + live engine:

```yaml
---
phase: open_reaction_ny_am_complete
finalized_at: <ts>
leader: MNQ1!
ltf_bias: bullish | bearish | mixed | stand_aside
htf_ltf_alignment: aligned | divergent | unclear
is_retrace_day: true | false
entry_model_priority: MSS | Trend | Inversion | undecided
priority_reason: "<one line>"
grade_cap: A+ | B                                    # B if divergent (per Q1)
chain_status: clean | degraded:<reason> | divergent
---
```

### 3.4 `entry_model_priority` resolver (mechanical)

```
if pillar2_verdict == "poor":             → "undecided"
elif htf_ltf_alignment == "divergent":    → "MSS"
elif htf_ltf_alignment == "aligned":
   if recent failure_swing (mss+sweep):   → "MSS"
   elif recent BoS in bias direction:     → "Trend"
   elif opposing FVG just flipped (ifvg): → "Inversion"
   else:                                  → "undecided"
elif htf_ltf_alignment == "unclear":      → "undecided"
```

Model cites `failure_swings[]`, `most_recent_structure`, or `fvgs[] where state==inverted` to justify. `undecided` → entry-hunt walks all three.

### 3.5 Divergence handling

When LTF reaction contradicts HTF (`htf_ltf_alignment: divergent`):
- `ltf_bias` follows NY reaction direction
- `is_retrace_day: true`
- `grade_cap: B`
- `pillar1.primary_draw` stays valid — end-of-day runner target
- Entry-hunt uses LTF direction for entry + intraday targets; `primary_draw.top/bottom` can still be `tp2_cite`

### 3.6 Schema additions to `surface_ltf_bias`

```typescript
leader: string                                       // mirrors pair-decision.json
htf_ltf_alignment: "aligned" | "divergent" | "unclear"
is_retrace_day: boolean
entry_model_priority: "MSS" | "Trend" | "Inversion" | "undecided"
priority_reason: string                              // one-line cite
grade_cap: "A+" | "B"
chain_status: "clean" | "degraded:<reason>" | "divergent" | "backfilled:open_reaction"
```

## Entry-hunt phase (strategy steps 5-7)

### 4.1 Phase preamble — chain resolution

Before walking any model, the model does a deterministic 6-step read (leader-first so per-symbol gates apply to the right symbol):

```
1. Read pair-decision.json   → leader = <symbol>|null.
                               If null and pair-decision missing → catch-up.
2. Read pillar1.md           → brief.<leader>.pillar_grade + brief.<leader>.no_trade_reason.
                               If pillar_grade == "no-trade":
                                 - data_gap / engine_stale / session_closed → surface_no_trade verbatim, stop
                                 - pillar2_poor / htf_unclear → continue (ltf-bias's stand_aside will gate below)
3. Read pillar1.md (mnq/mes section MATCHING leader) → primary_draw + path_to_destination + untaken_above/below.
4. Read pillar2.md frontmatter → pillar2_verdict.
                               If "poor" AND ltf_bias hasn't overridden → surface_no_trade.
5. Read ltf-bias.md          → ltf_bias, htf_ltf_alignment, is_retrace_day, entry_model_priority, grade_cap.
                               If ltf_bias == "stand_aside" → surface_no_trade, stop.
6. Read engine bundle (current TF, single-symbol on leader after short-circuit).
```

Each read emits a chat fact line with `chain_status` from each file. If any read fails AND no synthesis is possible, surface a chain error + `surface_no_trade("chain incomplete: <which file>")`.

### 4.2 Primary-draw validity check (runtime)

```
draw_state = live engine lookup at primary_draw.cite
- "fresh" / "ce_tapped" / "inverted" → still valid as anchor
- "filled"                          → consumed; treat as continuation reference
- "invalidated"                     → draw failed; drop tp2_cite to primary_draw,
                                      fall back to nearest untaken HTF level from
                                      pillar1.untaken_above/below
```

Stale brief's primary_draw doesn't poison entry-hunt; runtime adapts.

### 4.3 Walking entry models with priority

```
priority = ltf-bias.entry_model_priority

if priority != "undecided":
    walk(priority) first
    if all components present → emit setup with grade ≤ grade_cap, done
    else → walk other two models in fallback order

if priority == "undecided":
    walk all three models, pick the one with most components present
```

Per-model component walks (MSS 6 / Trend 5 / Inversion 5) unchanged from existing `<phase name="entry_hunt">`.

### 4.4 Setup payload — chain closure

```jsonl
{
  "model": "Trend",
  "side": "long",
  "leader_ref": "MNQ1!",
  "primary_draw_ref": "pillar1.mnq.primary_draw",
  "ltf_bias_ref": "ltf-bias.ltf_bias",
  "entry": 29799,    "entry_cite": "engine.fvgs[5].ce",
  "stop":  29743,    "stop_cite":  "engine.swings.internal[3].price",
  "tp1":   29830,    "tp1_cite":   "engine.pillar1.session_levels.LO_H.price",
  "tp2":   30000,    "tp2_cite":   "pillar1.mnq.primary_draw.top",        // chain closure
  "grade": "B",
  "grade_cap_reason": "divergent_ltf_overrode_htf" | null,
  "sizing": { "r_size": 0.375, "day_factor": 0.5, "grade_factor": 0.75, "cite": "strategy.sizing-table + memory.USER" }
}
```

`tp2_cite` references the brief's identified primary_draw — closes the chain end-to-end.

### 4.5 Sizing helper (`cli/lib/sizing.js`)

```javascript
computeSize({ day_of_week, grade, memory_overrides }) -> {
  r_size: number,
  day_factor: number,      // Mon/Fri = 0.5, Tue-Thu = 1.0 (defaults)
  grade_factor: number,    // A+ = 1.0, B = 0.5
  base_r: number,          // from strategy spec, default 0.75
  cites: ["strategy.sizing-table", "memory.USER"],
  override_reason: string | null
}
```

Pure function. No LLM arithmetic. Table in `docs/strategy/sizing-table.md`:

```markdown
| Day | base R | factor |
|---|---|---|
| Mon | 0.75 | 0.5 |
| Tue | 0.75 | 1.0 |
| Wed | 0.75 | 1.0 |
| Thu | 0.75 | 1.0 |
| Fri | 0.75 | 0.5 |

Grade adjustment:
- A+ × 1.0
- B  × 0.5
```

`memory.USER` overrides (e.g. "skip PCE days") → `r_size: 0`, `override_reason` set.

## Catch-up phase (recovery)

### 5.1 Detection

New phase value `catch_up_<session>`. Triggered when:

- First `/analyze` after 09:45 ET finds `pillar1.md` exists but `ltf-bias.md` does NOT.
- Or `pair-decision.json` missing in dual-symbol mode after minute 14.

Falls between `open_reaction` and `entry_hunt` in routing.

### 5.2 Behavior

Treats current bundle as the input it WOULD have analyzed at minute 14. Runs the leader decision + ltf-bias synthesis exactly like Section 3, writes:

```yaml
---
phase: open_reaction_ny_am_complete
finalized_at: <now>
backfilled: true
backfill_lag_minutes: <int>
leader: MNQ1!
ltf_bias: ...
htf_ltf_alignment: ...
is_retrace_day: ...
entry_model_priority: ...
grade_cap: B                                  # catch-up ALWAYS caps at B
chain_status: backfilled:open_reaction
---
```

Two rules:
1. Grade always capped at B when backfilled.
2. Chat output flags the backfill explicitly: "Backfilled open-reaction at 10:15 ET (25 min late). Grade capped at B for this session."

After backfill, subsequent bars route into normal `entry_hunt`.

### 5.3 Other recovery cases

- **Brief missed** (holiday boot / scheduler crash): `entry_hunt` finds no `pillar1.md` → `surface_no_trade("brief missing, refresh required")`. No automatic brief synthesis — too much HTF context to fake.
- **Primary draw invalidated** post-brief: Section 4.2 runtime check, not a catch-up case.

## Wrap phase

Reads the entire chain and writes `summary.md` with a `chain_audit` block:

```markdown
---
session: ny-am
date: 2026-05-26
wrapped_at: <ts>
chain_audit:
  brief: { fired_at, primary_draw, htf_destination, pillar_grade, chain_status }
  open_reaction: { fired_at, leader, ltf_bias, htf_ltf_alignment, grade_cap, chain_status, backfilled }
  entry_hunt: { setups_count, fired_setups, max_grade_reached, chain_status }
  outcome: { setups_won, setups_lost, total_r, primary_draw_reached: bool }
---

# Session Summary

## Bias picture
Brief identified <primary_draw> as destination above/below current price.
Overnight verdict was <extending/retracing/consolidating>. NY opened <aligned/divergent>.

## What happened
<chain narrative — brief said X, NY did Y, entry-hunt fired Z, hit/missed W>

## Watch next session
<bullets — what's still untaken, what conditions shifted>
```

The `chain_audit` block is what tomorrow's brief reads via `<recent_sessions>`. The memory-review turn (fired post-wrap) extracts patterns from this audit into `memory.MEMORY`.

## Failure modes (covered)

| Failure | Detected by | Behavior |
|---|---|---|
| Brief never ran | `entry_hunt` finds no `pillar1.md` | `surface_no_trade("brief missing")`, prompt manual refresh |
| Brief = no-trade (data reason) | `brief.no_trade_reason ∈ {data_gap, engine_stale, session_closed}` | Hard short-circuit: phases skip; wrap still fires |
| Brief = no-trade (chop reason) | `brief.no_trade_reason ∈ {pillar2_poor, htf_unclear}` | Soft short-circuit: phases observe but don't surface; model may flag recovery |
| Open-rxn missed | First `/analyze` after 09:45 ET finds no `ltf-bias.md` | Catch-up phase backfills, capped at B |
| Leader inconclusive | `pair.leader_evidence.reason ∈ {inconclusive_*, no_fvgs_*}` | Default to primary, `chain_status: degraded:leader_inconclusive` |
| HTF/LTF clash | `open_reaction` sees recent_structure against HTF dir | `htf_ltf_alignment: divergent`, `grade_cap: B`, primary_draw stays for runner |
| Primary draw invalidated | Runtime check in entry-hunt 4.2 | Drop tp2 to nearest untaken HTF level; surface_setup still possible at B |
| Stale engine | `gates.engine.meta.stale: true` | `chain_status: stale:N`, current bar skipped, no setup |

## Testing

### Unit tests (new)

| Module | Tests | File |
|---|---|---|
| `cli/lib/brief-digest.js` | Empty bundle → empty digest; populated → all symbols' fields + leader_evidence; rank order verified | `tests/brief-digest.test.js` |
| `cli/lib/sizing.js` | Mon/Fri → 0.5 factor; Tue-Thu → 1.0; A+ × 1.0, B × 0.5; memory override sets r_size=0 | `tests/sizing.test.js` |
| `entry_model_priority` resolver | All 5 branches | `tests/entry-model-priority.test.js` |
| `pillar1.md` comparative rendering | Single-symbol → one section; dual after first call → MNQ only; dual after second → both | `tests/brief-flow.test.js` (extend) |
| Catch-up phase detector | Detects missing ltf-bias.md + pillar1.md exists + time past 09:45 → routes to catch-up | `tests/catch-up.test.js` |

### Integration tests

- `surface_session_brief` with `no_trade_reason` enum: rejects `pillar_grade=no-trade` without a reason
- `surface_session_brief` with `primary_draw.cite` validation
- `surface_ltf_bias` with `entry_model_priority` + `grade_cap`
- `surface_leader_decision` with inconclusive reason

### Fixture additions

- `tests/fixtures/004-dual-symbol-brief.bundle.json` + `.expected.md` — paired bundle exercising new digest path
- `tests/fixtures/005-divergent-ny-open.bundle.json` + `.expected.md` — HTF bullish, NY opens bearish; expected `htf_ltf_alignment: divergent`, `grade_cap: B`

### Smoke

`npm run smoke:fixtures` runs schema + citation across all five fixtures. `npm run test:unit` covers helpers + integration.

## Implementation surface (file inventory)

| File | Type | Change |
|---|---|---|
| `cli/commands/analyze.js` | mod | Add `brief_digest` to bundle when `--pair` or `--brief-digest`. Calls `buildBriefDigest()` |
| `cli/lib/brief-digest.js` | NEW | `buildBriefDigest(bundle) → digest` — selects, ranks, cites. ~150 LOC |
| `cli/lib/sizing.js` | NEW | `computeSize({day, grade, memory_overrides}) → {r_size, factors, cites}`. ~80 LOC |
| `docs/strategy/sizing-table.md` | NEW | Canonical sizing table. ~40 LOC |
| `app/main/sdk.js` `surface_session_brief` Zod | mod | Add `primary_draw`, `htf_destination`, `overnight`, `htf_quality`, `pillar2_verdict`, `no_trade_reason`, `chain_status` |
| `app/main/sdk.js` `surface_ltf_bias` Zod | mod | Add `leader`, `htf_ltf_alignment`, `is_retrace_day`, `entry_model_priority`, `grade_cap`, `chain_status` |
| `app/main/tools/surface.js` | mod | Cross-validate `pillar_grade=no-trade` requires `no_trade_reason`. Validate `primary_draw.cite` resolves to a real engine path |
| `app/main/session-memory.js` | mod | `writeBrief` stash + comparative rerender from both per-symbol JSON. `renderPillar1Md` emits `mnq:`/`mes:` frontmatter sections + structured blocks |
| `app/main/session-brief.js` | mod | User prompt routes to `<phase name="brief">` (already routed; verify) |
| `app/main/prompts/analyze.md` | mod | Rewrite `<phase name="brief">` with 7-step walk + primary_draw pick. Add minute-14 leader logic to `<phase name="open_reaction">`. Add chain preamble + primary_draw validity check to `<phase name="entry_hunt">`. Add NEW `<phase name="catch_up">` block. Add `chain_status` enum to rules |
| `.claude/commands/analyze.md` | mod | Mirror app prompt changes |
| `app/main/bar-close.js` | mod | Route to `catch_up` phase when detector fires after 09:45 ET and `ltf-bias.md` missing |
| `app/renderer/src/Prep.jsx` | mod | Render `chain_status` chip on PREP brief card. Render `primary_draw` cite as tooltip in OVERNIGHT or KEY LEVELS |
| `tests/brief-digest.test.js` | NEW | Unit tests for digest builder |
| `tests/sizing.test.js` | NEW | Unit tests for sizing helper |
| `tests/entry-model-priority.test.js` | NEW | Unit tests for priority resolver |
| `tests/catch-up.test.js` | NEW | Unit tests for catch-up detection + backfill |
| `tests/brief-flow.test.js` | mod | Extend with no_trade_reason validation + comparative pillar1.md tests |
| `tests/fixtures/004-*` | NEW | Dual-symbol brief fixture |
| `tests/fixtures/005-*` | NEW | Divergent NY open fixture |
| `CLAUDE.md` | mod | Decision row for the chain. Update `analyze` recipe with `brief_digest` shape |

**Estimated scope:** ~900-1100 LOC + ~600-line prompt rewrite + 6 new test files + 2 fixtures.

## Out of scope

- **Post-entry trade management** (TP1 detection, stop-to-BE, partial fills). Already handled by existing `trade-ticker.js` / `trade-lifecycle.js`. The chain ends at `surface_setup`.
- **Brief auto-resynthesis** when primary_draw is invalidated mid-session. Runtime check in entry-hunt is sufficient.
- **HTF re-grading mid-session.** The brief fires once per session; if HTF context shifts dramatically, trader manually refreshes (existing IPC).
- **Multi-symbol entry-hunt.** After leader decision, entry-hunt is single-symbol on the leader.

## Open questions

None — all six clarifying questions resolved with the user during brainstorming.

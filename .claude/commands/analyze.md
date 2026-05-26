---
description: Phase-aware ICT analysis. Runs Lanto's 3-pillar strategy end-to-end across a trading session, building session memory in state/session/<date>/<session>/. Designed to be invoked once per bar close.
---

<strategy_authority>

This project implements Lanto's 3-pillar ICT framework. The authoritative spec:

- [docs/strategy/trading-strategy-2026.md](../../docs/strategy/trading-strategy-2026.md) — three pillars, 7-step checklist, A+/B grading.
- [docs/strategy/entry-models.md](../../docs/strategy/entry-models.md) — MSS / Trend / Inversion components, A+ examples.

Strategy §7 is sequential: HTF bias → overnight → Pillar 2 → NY reaction → entry model → confirmation → sizing. This command walks that sequence across a whole session by branching on phase.

Architecture plan: [docs/plans/llm-driven-session.md](../../docs/plans/llm-driven-session.md). Data source: [docs/plans/2026-05-21-ict-engine-migration.md](../../docs/plans/2026-05-21-ict-engine-migration.md).

</strategy_authority>

<how_to_run>

Use one of two capture commands, then `Read state/last-analyze.json`. The bundle is the single data source for this invocation; the dashboard reads it too.

**Full capture** — run when (a) it is the first invocation of the session, (b) `state/baseline.json` does not exist, (c) the triggering detector event has `is_5m_close: true`, or (d) `baseline_meta.age_seconds > 900` in the last bundle. Multi-TF sweep (~13s); refreshes the HTF baseline:

```bash
./bin/tv analyze --out state/last-analyze.json && cp state/last-analyze.json state/baseline.json
```

**Fast capture** — every other 1m close. Reuses the cached HTF baseline; returns in ~0.2s:

```bash
./bin/tv analyze --pillar3-only --baseline state/baseline.json --out state/last-analyze.json
```

A fast capture still carries fresh current-TF data plus `bars_by_tf`, `engine_by_tf`, and `gates.engine.pillar2.m5/m15` merged from the baseline. Pre-session always uses a full capture — HTF bias needs the live sweep.

After reading, look at `gates.session.phase` to determine what to do.

</how_to_run>

<bundle_fields>

The ICT Engine indicator is the single data source. It emits one schema-versioned evidence table; `tv analyze` parses it into structured numeric objects. Every price resolves at a real JSON path.

- `chart` — symbol, current resolution, indicators on chart.
- `quote.last` — current price.
- `bars` — OHLCV summary + `last_5_bars` at the current chart TF.
- `bars_by_tf.{daily, h4, h1, m15, m5, m1}` — per-TF bar summaries incl. `range` and `change_pct` (use these for HTF momentum).
- `engine` — the parsed ICT Engine table at the chart's current TF: `{schema, schema_supported, meta, levels[], sweeps[], fvgs[], bprs[], swings[], structures[], pools[], quality}`.
- `engine_by_tf.{daily, h4, h1, m15, m5, m1}` — the same parsed engine object captured at each TF. HTF FVGs and HTF structure live here (`.fvgs`, `.structures`, `.swings`, `.quality`, `.levels`).
- `pair` (present only when `tv analyze --pair` was used) — dual-symbol scan: `{primary, secondary, window_start_ms, window_end_ms, symbols, leader_evidence, leader_decided, leader}`. `pair.symbols.<symbol>` carries the same shape as the top-level bundle for each symbol. `pair.leader_evidence` is computed in code (`{primary_disp_score, secondary_disp_score, margin, threshold, reason, primary_fvg_path, secondary_fvg_path}`); cite it verbatim. `pair.leader` is `null` until `surface_leader_decision` fires; the chosen symbol thereafter.
- `pair_short_circuited` (present only when the analyzer detected an existing pair-decision.json for the active session) — `true` means the bundle is single-symbol on the leader; no `pair` block this turn.
- `gates.session.*` — clock-based facts (phase, label, minutes_into_phase, next_killzone_label, seconds_to_next_killzone, in_killzone, is_market_closed, replay state).
- `gates.engine.meta` — `{schema, schema_supported, tf, emit_ny, symbol, emit_ms, emit_age_seconds, stale, engine_session}` provenance. **If `stale: true` (emit_age_seconds > 90), the engine output is older than one bar — say "engine output is <N>s stale" and emit `surface_no_trade` rather than reading numbers that may be wrong.** `engine_session` is Pine's DST-aware classification (`asia|london|ny_am|ny_pm|off`) — flag any drift vs `gates.session.phase`.
- `gates.engine.price_context.{inside_fvgs, inside_bprs, nearest_opposing_fvg_above, nearest_opposing_fvg_below}` — engine zones containing current price plus the closest unfilled opposing FVG on either side. Each carries pre-computed `{distance_to_top, distance_to_bottom, distance_to_ce}` (signed; positive = price above). Cite the pre-computed distances directly.
- `gates.engine.pillar1.session_levels.{PWH, PWL, PDH, PDL, AS_H, AS_L, LO_H, LO_L, NYAM_H, NYAM_L}` — each `{name, price, state, swept, formed_ms, position_vs_price}`. `untaken_sell_side_below[]` + `untaken_buy_side_above[]` are pre-sorted draw targets. `sweeps[]` — explicit liquidity-raid events `{target, price, side, swept_ms, rejected}` (`rejected: true` = a failure-swing reversal tell).
- `gates.engine.pillar1.{liquidity_pools, untaken_pools_above, untaken_pools_below}` — equal-high (`kind=eqh`) / equal-low (`kind=eql`) pools the engine maintains (strategy §2.1 draw-target liquidity). Sorted closest-first. Each pool `{kind, side, price, swept}`.
- `gates.engine.pillar2.{current_tf, m5, m15}` — engine quality verdict per TF: `{range_3h, range_quality (good|tight|na), displacement (clean|acceptable|weak|na), candle (engulfing|doji_wick|normal), atr_14, atr_17, session}`. `acceptable` displacement is workable but weaker than `clean`. ATRs are Wilder values shipped by Pine.
- `gates.engine.pillar3.fvgs[]` — `{kind (fvg|ifvg), dir (bull|bear), top, bottom, ce, created_ms, took_liq, disp_score, reacted, reaction_dir, state (fresh|ce_tapped|filled|inverted|invalidated), size_quality (tiny|normal|large|unknown)}`. Use the engine's `size_quality` field for FVG size decisions: skip `tiny` zones as setup FVGs; `normal` and `large` are tradable. `reacted=true` + `reaction_dir` says the zone already mitigated and in which direction. Pine keeps the most-recent 24 per TF (FIFO).
- `gates.engine.pillar3.fvgs_ranked[]` — same shape, pre-sorted by `(state=fresh DESC, took_liq DESC, disp_score DESC)`. Prefer this when picking a setup FVG; `fvgs_ranked[0]` is the highest-priority candidate. `fvgs[]` stays Pine order for raw inspection.
- `gates.engine.pillar3.{bprs[], swings:{internal[], swing[]}, structure_events[], structures_by_tier:{swing[], internal[]}, failure_swings[], most_recent_structure, fvg_summary}` — each swing `{kind, price, bar_ms, tier, swept, is_high}`; each `structure_events` entry `{event (bos|mss), dir, level, displacement, tier, validation (break|sweep), confirmed_ms, is_reclaimed}`. Prefer `structures_by_tier.swing[]` for Trend/MSS reads on external pivots. `failure_swings[]` is the pre-filtered pool of `event=mss + validation=sweep` — stop-run reversals, the strongest reversal cue in the engine. `most_recent_structure` is the latest by `confirmed_ms`. **`is_reclaimed`** is computed from `quote.last` vs `level` by `dir`: a bullish BoS at 29804.75 is `is_reclaimed: true` when `quote.last < 29804.75` (the breakout failed back into the prior range). Same logic for MSS. Treat a reclaimed bos/mss as invalidating the continuation read — don't cite it as a bullish/bearish continuation cue when reclaimed.
- `gates.engine.confirmation.{last_bar, last_bar_age_seconds, m5_last_bar, m15_last_bar}` — single-bar confirmation facts `{time, open, high, low, close, body_ratio, direction, range, close_position_in_range}`.

</bundle_fields>

<rules>

Eight non-negotiable rules (research-backed; sources in `docs/research/*.md`):

1. **Cite or omit.** Every price must appear in the bundle and be cited `<price> (<json.path>)`. The path must resolve to the cited value. Examples: `29172.75 (quote.last)`, `29397 (gates.engine.pillar1.session_levels.PDH.price)`, `29326 (gates.engine.pillar3.fvgs[0].ce)`, `7393.5 (engine_by_tf.h4.fvgs[0].bottom)`. Prose-style parens like `(close)` are not citations. The verifier (`npm run smoke:fixtures`) enforces this mechanically.
2. **No arithmetic.** Stop distance, R:R, ATR, bar counts, range size, displacement magnitude — all live in the bundle. If the JSON doesn't have it, write `n/a — needs upstream computation`.
3. **If `gates.engine` is `null`** the ICT Engine is not on the chart — say so and stop. If `gates.engine.pillar3.fvgs` is empty, write "no FVGs from the engine." If a section's data isn't in the JSON, write `n/a`.
4. **Prose first, JSON last.** Any structured block goes at the end of the chat response. Mid-reasoning JSON degrades accuracy.
5. **Grade enum only.** Use `A+`, `B`, or `no-trade`. No "high-conviction" / "very likely" / "actionable" / "strong setup".
6. **Match entry-model components literally.** Walk them in order, by name. Do not paraphrase.
7. **Time awareness comes from the bundle.** `gates.session.phase`, `minutes_into_phase`, `seconds_to_next_killzone`, `day_of_week` — these are pre-computed. No clock math.
8. **`chain_status` emission.** Every surface tool call (`surface_session_brief`, `surface_ltf_bias`, `surface_leader_decision`) sets `chain_status`. Enum values:
   - `clean` — all inputs read, all outputs structured
   - `degraded:<reason>` — output produced with a caveat (e.g. `degraded:leader_inconclusive`, `degraded:brief_no_trade_soft`)
   - `backfilled:<phase>` — synthesized after the fact (catch_up only)
   - `divergent` — open_reaction found HTF/LTF clash
   - `stale:<minutes>` — upstream output older than N min vs the bar this phase fired on
   Wrap reads these from each frontmatter to build the chain_audit block in `summary.md`.

Project constraints in `CLAUDE.md` always apply.

</rules>

<phase_routing>

Read `gates.session.phase`. Branch:

| Phase value | What to do |
|---|---|
| `pre_session_ny_am`, `pre_session_ny_pm` | Pre-session grade (if not already done today). |
| `open_reaction_ny_am`, `open_reaction_ny_pm` | Open-reaction watch (15-min window). |
| `entry_hunt_ny_am`, `entry_hunt_ny_pm` | Per-bar entry-model hunt. |
| `post_ny_am`, `post_ny_pm` | Session wrap. |
| `catch_up_ny_am`, `catch_up_ny_pm` | Backfill `ltf-bias.md` + `pair-decision.json` after a missed open-reaction window. Grade always capped at B. See `<phase name="catch_up">`. |
| `london_open` | (Optional) one-shot grade — same as pre-session NY but for London context. |
| `inter_session`, `closed` | Idle; emit a one-line status, no state writes. |

**Brief turns** (fired from `session-brief.js` by the scheduler, 30-60 min before a session opens) follow the `<phase name="brief">` workflow regardless of the current `gates.session.phase`. The user message will say "This is a SESSION BRIEF turn for the <SESSION> session." — when you see that, do the brief phase end-to-end.

Files live in a per-session folder, `state/session/<date>/<session>/`:

- `<date>` — derived from `gates.session.timestamp_et` (e.g. "Tue, 05/19/2026, 14:30:00" → `2026-05-19`).
- `<session>` — derived from the phase: any `*_ny_am` phase → `ny-am`; any `*_ny_pm` → `ny-pm`; `london_open` → `london`.
- `<sdir>` is the shorthand used throughout this command for that full path: `<sdir>/pillar1.md` means `state/session/<date>/<session>/pillar1.md`. Create `<sdir>` on demand before the first write.

Each session folder is self-contained — NY AM, NY PM, and London never overwrite each other. The one day-level file is the detector's `bar-close-events.jsonl`, which stays directly under `state/session/<date>/`.

</phase_routing>

<phase name="pre_session">

**Goal:** grade Pillar 1 + Pillar 2 once for this session. Subsequent pre-session invocations should detect prior work and not re-grade.

**If `pair` is in the bundle** you're scanning two symbols (e.g. MNQ + MES). Write ONE `pillar1.md` and ONE `pillar2.md` that synthesize both symbols comparatively: HTF bias for both, primary HTF draw for each, overnight context for each. Single grade for the pair (it applies to whichever ends up being the leader). Cite from `pair.symbols.<primary>.*` and `pair.symbols.<secondary>.*` — the top-level fields only mirror the primary, so cross-asset comparisons go through `pair.symbols.*`.

**Check first:**
- If `<sdir>/pillar1.md` already exists, this session is graded — arm the per-bar loop (see the final step), then output one line "Pre-session already graded (P1=<bias>, P2=<verdict>). Loop armed. Idle until <next phase>." and stop.
- Otherwise grade now. Each session has its own folder, so NY AM, NY PM, and London grades never collide.

**If not done, do these in order:**

### Step 1 — Pillar 1a: HTF Bias (Daily / 4H / 1H)

Infer HTF bias from two engine-backed signals:
- **HTF momentum** — `bars_by_tf.daily.change_pct`, `bars_by_tf.h4.change_pct`, `bars_by_tf.h1.change_pct`. Agreement = directional; mixed signs = neutral.
- **HTF structure** — `engine_by_tf.daily.structures`, `.h4.structures`, `.h1.structures`. The most recent `event` (`bos`/`mss`) and its `dir` is the last confirmed shift on that TF.

For the HTF PD arrays (strategy §2.1's "best imbalances"), scan `engine_by_tf.daily.fvgs`, `engine_by_tf.h4.fvgs`, `engine_by_tf.h1.fvgs`. The engine types each FVG (`kind`, `dir`) and scores it: prefer FVGs with high `disp_score` and `took_liq: true` — that is exactly strategy §2.1's "extensive, took liquidity in creation." Pick the most material as the primary HTF draw.

### Step 2 — Pillar 1b: Overnight & Session Correlation

Read `gates.engine.pillar1.session_levels.*` and the pre-sorted `untaken_sell_side_below[]` / `untaken_buy_side_above[]`. Also read `gates.engine.pillar1.{untaken_pools_above, untaken_pools_below}` — equal-high / equal-low liquidity pools the engine maintains (strategy §2.1 draw targets). State which liquidity is `swept` / untaken across BOTH session levels and equal-H/L pools. `gates.engine.pillar1.sweeps[]` gives the explicit raids — each carries a `side` and a `rejected` flag (a rejected sweep is a failure-swing, a reversal tell). State whether overnight extended (lots swept one side) or consolidated (mixed / both sides swept).

### Step 3 — Pillar 2: Range + Quality

The engine emits a quality verdict per TF — no manual candle math.

- **Current TF:** `gates.engine.pillar2.current_tf.{range_3h, range_quality, displacement, candle, atr_14, atr_17, session}`. `range_quality` is `good` (3h range >= 0.3% of price) or `tight`; `displacement` is `clean` / `acceptable` / `weak` / `na` (count of clean bars in the last 6); `candle` is `engulfing` / `doji_wick` / `normal`. Cite `atr_17` when you need the structure-band magnitude; cite `atr_14` for FVG size context.
- **m5 / m15:** `gates.engine.pillar2.m5.*` and `.m15.*` — strategy §7 step 3 wants 5m/15m anatomy specifically.
- **HTF displacement:** `engine_by_tf.h4.quality` and `engine_by_tf.h1.quality`, plus `bars_by_tf.h4.range`.
- **Verdict:** `good | marginal | poor`. `range_quality=tight` + `displacement=weak` + `candle=doji_wick` is poor. Override the engine's verdict if you disagree — judge the displacement at the setup, not a lagging average.

### Write the two files

Use the `Write` tool to create:

**`<sdir>/pillar1.md`**:

```markdown
---
phase: pre_session_ny_am          # or pre_session_ny_pm / london_open
graded_at: <gates.session.timestamp_et>
symbol: <chart.symbol>
---

# Pillar 1 — Draw & Bias

## HTF Bias
<one paragraph with cited prices>

## Primary HTF Draw
<one sentence: the most material HTF FVG / liquidity pool, with cited high/low>

## Overnight Summary
<which levels are swept / untaken, with cited prices>

## Verdict
- htf_bias: bullish | bearish | neutral
- bias_direction_note: <one line>
```

**`<sdir>/pillar2.md`**:

```markdown
---
phase: pre_session_ny_am          # or pre_session_ny_pm / london_open
graded_at: <gates.session.timestamp_et>
---

# Pillar 2 — Price Action Quality

## Range
<cite gates.engine.pillar2.current_tf.range_3h + range_quality>

## HTF Displacement
<cite>

## m5 / m15 Anatomy
<cites>

## Verdict
- pillar2: good | marginal | poor
- override_reason: <if you overrode the engine verdict, why>
```

### Chat output (after writing files)

Three to five lines: cited HTF bias + primary draw + Pillar 2 verdict + countdown to next phase. End with: `Saved <sdir>/{pillar1.md, pillar2.md}. Per-bar loop armed. Idle until <next killzone> (in <minutes>m).`

### Arm the per-bar loop

Pillar 1 + 2 are the session's foundation. Once they exist, start the per-bar loop so `/analyze` fires on every bar close for the rest of the session. Do this at the end of every pre-session invocation — whether you just graded the files or found them already there:

1. Read `state/session/detector-heartbeat.json`. If it exists and its heartbeat is fresh (age < 90s), the detector is already running under a monitor — do nothing, the loop is already live.
2. Otherwise start it with the `Monitor` tool: `Monitor("./bin/tv stream bar-close")`. That launches the detector and streams one event per closed 1m bar (each line carries `is_5m_close: true` on 5m boundaries).
3. React to every monitored bar-close event by running `/analyze` again. It will branch to the open-reaction / entry-hunt / post phase as the ET clock advances — a full capture when the event has `is_5m_close: true`, a fast `--baseline` capture otherwise.

### Self-check before chat output

- The HTF-bias verdict line in `<sdir>/pillar1.md` cites at least one price from `engine_by_tf.{daily,h4,h1}.*` or `bars_by_tf.{daily,h4,h1}.change_pct`.
- The primary-HTF-draw sentence cites the high AND low of the chosen FVG.
- The Overnight section names every swept/untaken session level AND every untaken pool with cited prices.
- The Pillar 2 verdict cites `range_3h`, the `displacement` verdict, and (if overriding the engine) the reason.
- The per-bar loop is armed (heartbeat fresh OR Monitor launched).

If any check fails, fix the file or arm the loop, then emit chat output.

</phase>

<phase name="brief">

**Goal:** publish the PREP-panel SESSION BRIEF for one or both symbols. Fires once per session, 30-60 min before the session opens. The trader reads this live during the open; tight, cited, consistent.

**What this phase produces:** one (or two, for `--pair`) call to `surface_session_brief` per symbol. `writeBrief` re-renders `pillar1.md` / `pillar2.md` automatically from the surface payload's structured fields.

### Required action

1. **Capture.** Call `mcp__tv__tv_analyze_full` with the pair param from the user message (`pair="MNQ1!,MES1!"` in dual-symbol mode). It writes TWO files: `state/last-analyze.json` (full bundle, ~440KB compact) and **`state/last-analyze.digest.json`** (pretty-printed digest, ~17KB).

2. **Read `state/last-analyze.digest.json` — NOT the full bundle.** The digest is the brief turn's data source. It is pretty-printed (one field per line, ~500 lines) so the Read tool returns it intact. The full bundle is one giant single-line JSON whose per-line content gets truncated at ~2000 chars by Read; do not try to read it for the brief. Cite as `brief_digest.symbols.<sym>.*` even though the file's actual content is the digest at the top level — the prompt convention uses `brief_digest.` as a citation prefix so downstream phases can find the same path through the in-memory bundle.

3. **For each symbol** in the digest's `symbols` map (loop over both for `--pair`), walk the steps below. Cite from `brief_digest.symbols.<sym>.*`.

### Step 1 — HTF Bias (Daily / 4H / 1H)

Walk each TF by name. Pull engine-backed signals **at that TF**:

- `brief_digest.symbols.<sym>.htf.<tf>.change_pct` — momentum sign for that TF.
- `brief_digest.symbols.<sym>.htf.<tf>.top_fvgs[0..2]` — best PD arrays at that TF (ranked by state=fresh, took_liq, disp_score). Includes iFVGs (kind=`ifvg`).
- `brief_digest.symbols.<sym>.htf.<tf>.top_bprs[0..2]` — BPRs at that TF.
- `brief_digest.symbols.<sym>.htf.<tf>.recent_structures[0..1]` — most recent `event` (`bos`/`mss`) with `dir` + `is_reclaimed`.

For each TF emit one `htf_bias` row `{tf, bias, note}`:
- `bias`: `BULLISH | BEARISH | MIXED | NEUTRAL`. `MIXED` = momentum and structure disagree. `NEUTRAL` = both signals flat / absent.
- `note`: one short sentence that **cites at least one path under `brief_digest.symbols.<sym>.htf.<tf>`** for the row's exact TF. Wrong-TF citations (e.g. `engine.structures[*]` in a 4H row) are bugs — `engine.*` is current chart TF (usually 1m).

If `brief_digest.symbols.<sym>.htf.<tf>` is empty for a TF (no FVGs, no structures), say `bias: NEUTRAL` and the note cites the absence: `"top_fvgs and recent_structures both empty"`. Never invent a directional bias without a per-TF citation.

### Step 2 — Pick the Primary HTF PD Array

From `brief_digest.symbols.<sym>.htf.{daily,h4,h1}.top_fvgs` + `top_bprs`, pick ONE with:
- highest `disp_score × took_liq` (extensive AND took liquidity in creation)
- AND state ∈ `{fresh, ce_tapped, inverted}` (not filled/invalidated)

This is the **primary draw** — anchor for everything downstream (open_reaction, entry_hunt, wrap). Strategy §2.1: "He prefers 4H PD arrays when possible because they tend to be cleaner and more tradable intraday." Default to h4 when h4 and h1 are tied.

Surface as `primary_draw` in the tool call:

```
primary_draw: {
  tf:         "h4",       // or "daily" | "h1"
  kind:       "fvg",      // or "bpr" | "ifvg"
  dir:        "bull",     // or "bear"
  top, bottom, ce: <numbers from the chosen entry>,
  disp_score: <number>,
  took_liq:   true,
  state:      "fresh",
  cite:       "engine_by_tf.h4.fvgs[2]"   // must match /engine_by_tf\.(daily|h4|h1)\.(fvgs|bprs)/
}
htf_destination: "above 30000 buy-side"   // or "below 29400 sell-side" / "balanced"
```

### Step 3 — Overnight & Session Correlation

Read `brief_digest.symbols.<sym>.pillar1.*`. Walk session levels: PWH, PWL, PDH, PDL, AS_H, AS_L, LO_H, LO_L, NYAM_H, NYAM_L. For each: cite state (taken/untaken) from `pillar1.session_levels.<name>.state`.

Walk `pillar1.sweeps[]`. Sweeps with `rejected: true` are failure-swing reversals — surface them; they're the strongest cue.

Walk `pillar1.untaken_pools_above[0..2]` + `untaken_pools_below[0..2]` — equal-H/L liquidity (strategy §2.1 draw-target liquidity).

Surface as `overnight_block` in the tool call:

```
overnight_block: {
  asia:   { high, low, state: "extended"|"swept"|"untaken", cite },
  london: { high, low, state, cite },
  untaken_above: [{name, price, cite}, ...],
  untaken_below: [{name, price, cite}, ...],
  overnight_verdict: "extending_htf" | "retracing_htf" | "consolidating",
  path_to_destination: "clear" | "capped_by_<level>" | "contradicted_by_<level>"
}
```

`path_to_destination`: between current price and `primary_draw`, what's in the way? "clear" = no untaken HTF level blocking; "capped_by_<name>" = a level must break first; "contradicted_by_<name>" = a level reached above/below the draw would flip the read.

### Step 4 — Pillar 2 Quality

Read both LTF and HTF quality:

- LTF: `brief_digest.symbols.<sym>.pillar2.{current_tf, m5, m15}`
- HTF: `brief_digest.symbols.<sym>.htf.h4.quality` + `brief_digest.symbols.<sym>.htf.h1.quality`

Strategy §3 / §7 step 3: "4H/1H candles show real displacement and decent-sized PD arrays" — HTF quality is required, not optional.

Surface as `htf_quality` + `pillar2_verdict`:

```
htf_quality: {
  h4: { range_quality, displacement, candle, cite: "engine_by_tf.h4.quality" },
  h1: { range_quality, displacement, candle, cite: "engine_by_tf.h1.quality" }
}
pillar2_verdict: "good" | "marginal" | "poor"
```

### Step 5 — Deterministic Grade (Pillars 1 + 2, brief scope)

| Grade | Rule |
|---|---|
| `A+` | HTF agrees across ≥2 of D/4H/1H **with cited evidence** AND ≥1 untaken HTF draw remains AND Pillar 2 `range_quality=good` + `displacement∈{clean,acceptable}` + `candle≠doji_wick`. |
| `B` | Pillars 1+2 align with **EXACTLY ONE** weaker element. |
| `no-trade` | **≥2 weak/missing elements**, OR any HTF TF NEUTRAL because the data wasn't read, OR `gates.engine.meta.stale: true`. **Must set `no_trade_reason`.** |

`no_trade_reason` enum (required when grade=`no-trade`):
- `data_gap` — bundle missing fields that should be present
- `engine_stale` — `gates.engine.meta.stale: true`
- `pillar2_poor` — chop / low quality (soft short-circuit — open_reaction can still recover)
- `htf_unclear` — HTF TFs all NEUTRAL or contradictory (soft)
- `session_closed` — market closed / non-trading day

If you cannot cite a TF, that TF counts as missing — escalate toward `no-trade`. Do not paper-over a data gap with a `B`.

### Step 6 — Scenarios

Build 2 to 4 scenarios. Each is the if/then plan for a specific entry trigger. Five required fields per scenario:

- `id`: stable short id — `"scn-1"`, `"scn-2"`.
- `grade`: per-scenario grade (`"A+"`, `"B"`, or `"no-trade"`). A+ when all six elements would align if the trigger fires; B if exactly one is weaker; no-trade for defensive scenarios where you'd stand aside. **This is independent of `pillar_grade`** — the overall pre-session grade above. A `pillar_grade=B` brief can still carry an A+ scenario (the A+ requires the trigger to fire AND Pillar 3 to confirm).
- `condition`: trigger condition with cited prices — `"NY opens above 21487.25 (PDH) and holds for 1 closed bar"`. UI labels this row "TRIGGER".
- `action`: reaction / bias — `"long continuation toward 21528.50 (PWH); stop below 21450.50 (AS_L)"`.
- `target`: anchored target with citation — `"21 528.50 (PWH)"` or `"21 420 (engine_by_tf.h4.fvgs[0].top)"`. Must contain a digit; Zod refines on this.

Cite from `brief_digest.symbols.<sym>.ltf_context.*` or `pillar1.session_levels.*`. Never invent a level not in the bundle.

**A+ example:**
```json
{
  "id": "scn-1",
  "grade": "A+",
  "condition": "sweep of AS.L at 21 290 (pillar1.session_levels.AS_L) + 5m MSS up + tap of 4H FVG 21 300-21 320 (engine_by_tf.h4.fvgs[0])",
  "action": "MSS long on the 5m FVG retest, stop below the sweep wick",
  "target": "21 420 (pillar1.session_levels.PWH)"
}
```

### Step 7 — Sizing Note

Use the strategy sizing table + memory.USER overrides. Format: `"0.75 R · Tue standard (strategy.sizing-table)"` or `"0.5 R · A+ but Mon-reduced (strategy.sizing-table, memory.USER)"`. Cite must contain `(strategy...)` OR `(memory.USER)` OR `(memory.MEMORY)`.

### Step 8 — Self-check before surface_session_brief

- Each `htf_bias` row's `note` cites at least one path **at that TF** (`brief_digest.symbols.<sym>.htf.<tf>` or sub-paths). Wrong-TF cites are bugs.
- `primary_draw.cite` matches `/engine_by_tf\.(daily|h4|h1)\.(fvgs|bprs)/`.
- Every numeric price in `brief`, scenarios, `anchored_target`, `anchored_stop` is followed by `(json.path)`.
- No arithmetic in prose. Ranges/deltas come from `brief_digest.*.range` or you write `n/a`.
- `pillar_grade` matches the rule in Step 5.
- `key_levels[].name` uses canonical engine names (no parenthetical state suffixes).
- If `pillar_grade=no-trade`, `no_trade_reason` is set.
- The brief doesn't contradict itself — no "counter-HTF" scenarios when HTF wasn't captured.
- `chain_status: clean` unless something was degraded; in which case use the appropriate `degraded:<reason>` form.

If any check fails, fix the payload, then call `surface_session_brief`.

### Tool call

End the turn with one `surface_session_brief` call per symbol — twice in `--pair` mode (once with `symbol="MNQ1!"`, once with `symbol="MES1!"`). Skip `surface_setup` / `surface_no_trade` in brief turns.

</phase>

<phase name="open_reaction">

**Goal:** first 15 min of NY's reaction to overnight levels (09:30-09:45 ET / 13:30-13:45 ET). Read the brief's structured handoff, watch live engine, decide leader + LTF bias at **minute 14** (09:44 ET NY AM / 13:44 ET NY PM).

### Required reads first

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

<anti_patterns>

The following 8 misreads happened in real sessions and produced bad output. The detector now prevents most of them structurally, but if you ever find yourself doing one of these, stop and re-read `<candidate_object>`.

**❌ "FRESH FVG" DOES NOT MEAN "RETESTED".**
   `engine.fvgs[N].state: "fresh"` + `created_ms` in the last 1-3 bars means the pullback has not happened yet. The 3 candles around `created_ms` CREATED the FVG, they did not retest it. The detector's `retrace_to_fvg.present` checks `price_context.inside_fvgs[]` — trust that.

**❌ "REACTED" DOES NOT MEAN "RETESTED".**
   `reacted: true` (now exposed as `displacement_at_creation: true` after disambiguation) = the impulse that CREATED the FVG was clean. It does NOT mean a later pullback tested the zone.

**❌ SWEPT LEVELS ARE NOT VALID TARGETS.**
   `gates.engine.pillar1.session_levels.<LEVEL>.swept: true` (or `taken: true`) means the level was already taken. NEVER cite as TP. The detector's `tp1` / `tp2` pull from `untaken_above[]` / `untaken_below[]` only.

**❌ FVG-BOTTOM STOP IS A LAST-RESORT FALLBACK.**
   Strategy priority for FVG entries: candle 1 low of the 3-candle FVG formation > pullback swing low > FVG bottom. The detector pre-ranks all three in `stop_options[]`. Pick `stop_options[0]` unless its cite fails to resolve.

**❌ LOCKED LTF BIAS DOES NOT FORCE DIRECTION.**
   `ltf_bias.bias` is a snapshot at the leader-decision moment, not a lock for the entire session. The detector's `side` is computed from HTF destination + current engine state — trust its side pick over a stale LTF bias.

**❌ PHASE TAG IS DERIVED FROM ET CLOCK, NOT WRITTEN BY MODEL.**
   Do not author `"phase: open_reaction_ny_pm"` at 13:09 ET (21 min before NY PM open at 13:30). The phase is set by `surface.js` based on the live ET clock.

**❌ SIZING IS PRE-COMPUTED, NEVER FABRICATED.**
   `sizing_note` must come from the `<sizing_pre_computed>` block in the brief prompt, citing `memory.USER` or `strategy.sizing-table`. Do not write a prose-level sizing claim like "Tuesday standard."

**❌ NEVER PROMOTE GRADE PAST `grade_capped`.**
   If detector emits `grade_capped: B`, surfacing `grade: A+` will be rejected by the validator. Use `grade_capped` directly.

</anti_patterns>

<phase name="entry_hunt_legacy_DISABLED">

The pre-detector workflow lives below — it is NOT active. Kept temporarily as documentation; will be removed once the detector path is proven live. The active path is the candidate-driven flow above.

### Chain preamble (do this BEFORE walking any model)

Leader-first read order so per-symbol gates apply to the right symbol:

```
1. Read pair-decision.json   → leader = <symbol>|null.
                               If null AND pair-decision missing → route to <phase name="catch_up">.
2. Read pillar1.md           → brief.<leader>.pillar_grade + brief.<leader>.no_trade_reason.
                               If pillar_grade == "no-trade":
                                 - data_gap / engine_stale / session_closed
                                     → surface_no_trade verbatim, stop
                                 - pillar2_poor / htf_unclear
                                     → continue (ltf-bias's stand_aside will gate below)
3. Read pillar1.md (mnq/mes section MATCHING leader)
                             → primary_draw + path_to_destination + untaken_above/below.
4. Read pillar2.md frontmatter → pillar2_verdict.
                               If "poor" AND ltf_bias hasn't overridden → surface_no_trade.
5. Read ltf-bias.md          → ltf_bias, htf_ltf_alignment, is_retrace_day,
                               entry_model_priority, grade_cap.
                               If ltf_bias == "stand_aside" → surface_no_trade, stop.
6. Read engine bundle (current TF, single-symbol on leader after short-circuit).
```

Emit a chat fact line per read with the `chain_status` from each file.

### Primary-draw validity (runtime check)

After step 3, check current state of `primary_draw` by looking up its cite in the live engine:

| `primary_draw.state` (live lookup at `primary_draw.cite`) | Behavior |
|---|---|
| `fresh` / `ce_tapped` / `inverted` | Still valid as anchor. Use as `tp2_cite`. |
| `filled` | Consumed; treat as continuation reference, not target. Drop `tp2_cite` to the nearest untaken HTF level. |
| `invalidated` | Draw failed. Drop `tp2_cite` to the nearest untaken HTF level from `pillar1.<leader>.untaken_above` or `untaken_below`. Note in setup payload: `"grade_cap_reason": "primary_draw_invalidated"`. |

### Walking entry models with priority

After the chain preamble passes:

```
priority = ltf-bias.entry_model_priority
if priority != "undecided":
    walk(priority) first
    if all components present → emit setup with grade ≤ grade_cap, done
    else → walk other two models in fallback order
if priority == "undecided":
    walk all three models, pick the one with most components present
```

### Direction resolution — DO NOT marry the locked LTF bias

The strategy explicitly says **"Lanto never marries a bias"** (§2.3). The locked `ltf_bias` is a SNAPSHOT from minute-14 of the open. It does NOT lock the trade direction for the rest of the session. The DIRECTION of the model walk comes from current engine evidence, not from the locked bias.

Resolve the model's DIRECTION using this priority chain:

1. **`htf_ltf_alignment: divergent` case** (MSS priority):
   - The "divergent" reading means LTF reversed AT an HTF level. The MSS direction is **toward the HTF destination**, not in the locked LTF direction.
   - HTF destination "above X buy-side" + divergent → walk **MSS-bull** (LTF flipping back UP toward HTF).
   - HTF destination "below X sell-side" + divergent → walk **MSS-bear** (LTF flipping back DOWN toward HTF).
   - Cite this in `grade_cap_reason: "ltf_reversal_toward_htf"` on the setup.

2. **`htf_ltf_alignment: aligned` case** (Trend / Inversion priority):
   - Direction follows the aligned bias (which equals HTF direction).

3. **Stale-bias override** (any priority):
   - If `gates.engine.pillar3.most_recent_structure` shows a confirmed BoS/MSS in the OPPOSITE direction of the locked `ltf_bias`, with `displacement: true` AND `is_reclaimed: false` AND `validation` ∈ {break, sweep}, the locked bias is stale.
   - Walk the model in the direction of `most_recent_structure.dir`.
   - Cite this in `grade_cap_reason: "ltf_bias_overridden_by_engine"` on the setup.
   - Cap grade at B regardless (we're overriding upstream).

4. **Engine evidence ALWAYS wins over the locked bias.** A fresh inside_fvg matching one direction + a recent bos in the SAME direction + displacement + not reclaimed = walk that direction. Period. The locked bias is a hint, not a gate.

### Setup payload — chain closure

When emitting `surface_setup`, include explicit chain references so the wrap can audit end-to-end:

```
{
  model: "Trend" | "MSS" | "Inversion",
  side: "long" | "short",
  leader_ref: "MNQ1!",
  primary_draw_ref: "pillar1.<leader>.primary_draw",
  ltf_bias_ref: "ltf-bias.ltf_bias",
  entry: <num>, entry_cite: <path>,
  stop:  <num>, stop_cite:  <path>,
  tp1:   <num>, tp1_cite:   <path>,
  tp2:   <num>, tp2_cite:   "pillar1.<leader>.primary_draw.top"
                            | "pillar1.<leader>.untaken_above[0].price"
                            | <other HTF cite>,
  grade: "A+" | "B"          // must be ≤ grade_cap from ltf-bias.md
  grade_cap_reason: "divergent_ltf_overrode_htf" | "primary_draw_invalidated" | null,
  sizing: { r_size, day_factor, grade_factor, cite: "strategy.sizing-table + memory.USER" }
}
```

`tp2_cite` should reference the brief's identified `primary_draw` whenever still valid — that closes the chain end-to-end (brief identified the draw, entry-hunt's runner targets it).

### Legacy required reads (still loaded for context)

- `<sdir>/pillar1.md`, `<sdir>/pillar2.md`, `<sdir>/ltf-bias.md` — already read in the chain preamble above.
- `<sdir>/setups.jsonl` (if it exists — read recent entries to avoid re-flagging the same setup).
- `<sdir>/bars.jsonl` (tail — last ~10 entries for recent context).

If any of pillar1/pillar2/ltf-bias is missing AND the catch-up route didn't fire, that's a phase error — the open-reaction work didn't complete. Say so and skip entry hunt.

**Dual-symbol awareness:**
- If `pair_short_circuited: true` is in the bundle, the leader has already been chosen — the bundle is single-symbol on the leader. Run the entry hunt exactly as today. Cite from the top-level fields (no `pair` block this turn).
- If neither `pair` nor `pair_short_circuited` is in the bundle, you're running a normal single-symbol session — nothing changes.
- If `pair` is in the bundle during entry hunt (which means `surface_leader_decision` was missed at minute 14), prefer the symbol with the higher `pair.leader_evidence.primary_disp_score` vs `secondary_disp_score`, surface this in chat as "leader decision was missed at minute 14; treating <symbol> as leader for this turn", and proceed with that symbol.

### Grade decision (deterministic, six strategy elements)

Compute the grade from these six elements:

1. **HTF bias** — directional (bullish or bearish), cited from `<sdir>/pillar1.md`.
2. **Overnight context** — at least one untaken HTF draw remaining in the bias direction.
3. **NY reaction** — `<sdir>/ltf-bias.md` aligns with HTF (or LTF retrace explicitly noted).
4. **Pillar 2 quality** — `good` (or `acceptable` displacement workable).
5. **Entry-model components** — all components for the chosen model present and cited (5 for Trend/Inversion, 6 for MSS — see model checklists below).
6. **Confirmation close** — 1m or 5m strong-body close with `direction` matching the trade side.

Grade:

| Grade | Rule |
|---|---|
| `A+` | All six elements aligned. |
| `B` | Five aligned; exactly one weaker (e.g. Pillar 2 `acceptable` instead of `clean`, or confirmation candle smaller body). |
| `no-trade` | Two or more weak or missing, OR no entry model in play, OR `gates.engine.meta.stale` is `true`. |

### Stale-engine short-circuit

Before reading any of pillar3, check `gates.engine.meta.stale`. If `true`, the engine output is older than one bar — write "engine output is <emit_age_seconds>s stale" and emit `surface_no_trade` with reason `engine output stale`. Do not grade off potentially-frozen levels.

### For each new bar (1m close, and 5m close when `gates.engine.confirmation.last_bar.time % 300 == 0`)

1. Append the bar facts to `<sdir>/bars.jsonl`:

```jsonl
{"time": <bar_time>, "tf": "1m", "o": <open>, "h": <high>, "l": <low>, "c": <close>, "body_ratio": <bratio>, "direction": "<dir>", "close_position_in_range": <cp>}
```

(Use `gates.engine.confirmation.last_bar.*`. Write `tf: "5m"` and a separate line to `<sdir>/bars-5m.jsonl` when at a 5m boundary.)

2. **Walk all three entry models — by name, every bar. List the components of each by name with one of: a cited price (from the bundle) OR `missing`.** Grade each model only on its own components (`entry-models.md`); do not disqualify one model with another model's rule.

   **MSS components (6):**
   1. Context & Draw — HTF bias with downside draw near completion (cite from `<sdir>/pillar1.md` HTF Bias verdict + a `gates.engine.pillar1.untaken_*` level).
   2. Liquidity Grab — sweep below an obvious low (cite a `gates.engine.pillar1.sweeps[]` entry, or a `gates.engine.pillar1.session_levels.*` whose `swept=true`).
   3. MSS with Displacement — `gates.engine.pillar3.structure_events` entry with `event=mss` + `displacement=true`. `gates.engine.pillar3.failure_swings[]` is the strongest MSS pool (validation=sweep means the break came after a stop-run — the textbook ICT failure-swing reversal).
   4. Retrace to FVG — a `gates.engine.pillar3.fvgs_ranked[0]` with `state` in {`fresh`, `ce_tapped`} matching the trade direction. Use `gates.engine.price_context.inside_fvgs[].distance_to_ce` to confirm proximity.
   5. Confirmation — `gates.engine.confirmation.last_bar` with `body_ratio` strong and `direction` matching the trade side.
   6. Risk & Target — stop at the swept low (cite); TP1 at last internal high (`gates.engine.pillar3.swings.internal[].price`); TP2 at HTF draw (cite from `<sdir>/pillar1.md`).

   **Trend components (5):**
   1. Context & HTF Bias — HTF clearly directional with FVGs respected (cite `<sdir>/pillar1.md` + recent `engine_by_tf.h4.fvgs[]` with `state=fresh`).
   2. Strong Impulse Leg — recent `gates.engine.pillar3.structure_events` with `event=bos` (especially in `structures_by_tier.swing[]`) + a fresh `gates.engine.pillar3.fvgs[]` matching direction.
   3. Pullback into Internal FVG — `gates.engine.pillar3.fvgs_ranked[0]` (state=fresh) AND `gates.engine.pillar3.most_recent_structure` confirms structure intact (HH/HL for longs; LL/LH for shorts). "Structure intact" is Trend-only — broken structure disqualifies Trend but not Inversion.
   4. Confirmation — `gates.engine.confirmation.last_bar` strong-body close above (long) or below (short) the FVG CE.
   5. Risk & Target — stop below swing low/FVG low; TP1 next internal high; TP2 next HTF draw.

   **Inversion components (5):**
   1. Context & HTF Bias — HTF directional with buy/sell-side targets above/below (cite `<sdir>/pillar1.md`).
   2. Opposing FVG forms — a `gates.engine.pillar3.fvgs[]` in the OPPOSITE direction to the trade bias (small counter-trend imbalance).
   3. Violation — that FVG flipped to `kind=ifvg`, `state=inverted` in `gates.engine.pillar3.fvgs[]`. Use `reacted=true` + `reaction_dir` to confirm the violation produced a directional close.
   4. Retest & Confirmation — `gates.engine.confirmation.last_bar` strong-body close from inside the inversion zone in the trade direction.
   5. Risk & Target — stop below inversion low (long) / above inversion high (short); TP at next buy/sell-side liquidity.

   **Inversions form during a pullback** — a broken higher low does not disqualify an Inversion (that is a Trend rule).

   **FVG size:** use `size_quality` from the engine. Skip `tiny`; trade `normal` or `large`. `disp_score` tells you displacement strength.

   **Engine quality is a hint, not a veto** — `gates.engine.pillar2.m5.candle` / `displacement` are lagging summaries. Judge the displacement at the setup and override when you disagree. `displacement=acceptable` is workable; `weak` is the level to hesitate at.

   **Discipline:** grade B when components align even if one is weaker. Reserve `no-trade` for cases where two or more components are missing OR no entry model is in play. A clean component walk with all components present is at least B; do not invent reasons to reject.

3. **If a candidate is forming or has fired**, append to `<sdir>/setups.jsonl`:

```jsonl
{"ts": "<iso>", "bar_time": <t>, "tf": "1m", "model": "MSS|Trend|Inversion", "status": "candidate|confirmed|invalidated", "side": "long|short", "rationale": "<one line with cites>", "fvg": {"top": <t>, "bottom": <b>, "kind": "fvg|ifvg", "dir": "bull|bear"}, "confirmation_bar": {"close": <c>, "body_ratio": <br>, "direction": "<d>"} | null}
```

### Chat output

**Default (no setup):** ONE line. Format:
`<phase>:<min>m  bar=<bar_time> body=<br> dir=<dir> | no setup (last_bar at <close>, in <list-or-none> FVGs)`

**Setup forming (status=candidate):** TWO to THREE lines. Cite the FVG; note the model; say what would confirm. `candidate` covers every pre-entry stage — from a setup just starting to form through to one bar away from confirmation.

**Setup CONFIRMED:** the longer prose+JSON read. Use the structured block from the Examples below. Cite entry, stop (structural invalidation), TP1 (local liquidity), TP2 (HTF draw if supported). Include the per-model component walk above.

### Self-check before the tool call

- For each cited price, the JSON path resolves to that exact value.
- For each entry-model component walked (5 for Trend/Inversion, 6 for MSS), you either cited a price OR wrote `missing`.
- The grade matches the six-element decision rule above.
- If grade is `A+` or `B`, you end with `surface_setup` and the structured JSON block follows the prose.
- If grade is `no-trade`, you end with `surface_no_trade` with a one-line `reason`.

If any check fails, fix the prose, then call exactly one of `surface_setup` / `surface_no_trade`.

</phase>

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

<phase name="post_session">

**Goal:** write a one-paragraph wrap to this session's folder, then idle.

**The work:**

- If `<sdir>/summary.md` already exists, this session is wrapped — output "Already wrapped." and stop.
- Otherwise read `<sdir>/pillar1.md`, `<sdir>/pillar2.md`, `<sdir>/ltf-bias.md`, `<sdir>/setups.jsonl`, then `Write` `<sdir>/summary.md`:

```markdown
---
session: ny-am          # ny-am | ny-pm | london
date: <YYYY-MM-DD>
wrapped_at: <gates.session.timestamp_et>
---

# Session Summary — <session>, <YYYY-MM-DD>

## Bias picture
<one paragraph synthesizing P1 + P2 + LTF bias, prices cited>

## What happened
<one paragraph: did setups fire / confirm; the session's narrative>

## Watch next session
<one or two bullets>
```

Each session writes its own `summary.md` inside its own folder, so the NY AM, NY PM, and London wraps all persist independently for later review — nothing is overwritten.

### Chat output

The single-paragraph wrap. Then say what's next ("Idle until NY PM at 13:00 ET" / "Idle until tomorrow's London Open").

### Self-check before chat output

- `<sdir>/summary.md` exists with `bias_picture`, `what_happened`, `watch_next_session` filled.
- Bias picture cites at least two prices from `<sdir>/pillar1.md` or `<sdir>/pillar2.md`.
- What-happened references any setup that fired (from `<sdir>/setups.jsonl`) by its model + status, or explicitly states "no setups fired".

If any check fails, rewrite the section, then emit chat output.

</phase>

<phase name="other">

**London Open** — optional context-build window. The system is session-focused (NY AM + NY PM), but if you want a London read, treat it as a one-shot grade. Here `<session>` is `london`, so `<sdir>` resolves to `state/session/<date>/london/`. Write `<sdir>/pillar1.md` and `<sdir>/pillar2.md` exactly as in the Pre-session phase (`phase: london_open` in the frontmatter), then a brief `<sdir>/summary.md` wrap as in the Post-session phase. The `london/` folder is independent — NY AM and NY PM never touch it, so the London grade persists for later review. Skip the grade if `<sdir>/pillar1.md` already exists.

**Inter-session, Closed** — idle. Say "Outside NY sessions — no work" plus current phase + countdown. No state writes.

</phase>

<ict_vocabulary>

- **Market-structure labels (HH/HL/LH/LL)** — the ICT Engine names a swing pivot with the textbook convention: the SECOND letter is the pivot type (`H`igh or `L`ow), the FIRST is whether it is `H`igher or `L`ower than the previous pivot of that same type.
  - `HH` = Higher High — a swing **high** above the prior high
  - `HL` = Higher Low — a swing **low** above the prior low
  - `LH` = Lower High — a swing **high** below the prior high
  - `LL` = Lower Low — a swing **low** below the prior low
  - `HH` and `LH` are swing **highs**; `HL` and `LL` are swing **lows**. Each engine swing also carries an explicit `is_high` boolean — trust it. An uptrend prints `HH` + `HL`; a downtrend prints `LH` + `LL`.
- **HTF / LTF** — higher TF (Daily / 4H / 1H) sets bias; LTF (15m / 5m / 1m) triggers.
- **Liquidity** — stop pools above swing highs (buy-side) or below swing lows (sell-side).
- **PDH / PDL** — previous day's high / low.
- **FVG** — 3-bar imbalance. The engine emits each with `top` / `bottom` / `ce` / `state`; acts as a retracement target.
- **BPR** — Balanced Price Range. Overlapping bullish + bearish FVGs; the engine emits these as `bprs[]`.
- **Order block** — last opposing candle before strong displacement.
- **Mitigation** — price returning to an FVG / OB. The engine tracks it as FVG `state`: `fresh → ce_tapped → filled`.
- **Inversion FVG** — bearish FVG violated bullishly (or vice versa) — flipped polarity. The engine emits `kind=ifvg`, `state=inverted`.
- **Killzone** — institutional flow window (London Open, NY AM, NY PM).
- **CE** — Consequent Encroachment, FVG midpoint. The engine emits it as `ce`.
- **Displacement** — wide-range directional move creating an FVG. The engine scores it per FVG as `disp_score` (0–1).
- **Sweep / liquidity raid** — wick beyond a swing/level reversing. The engine emits explicit `sweep` events with a `rejected` flag.
- **MSS / BOS** — Market Structure Shift (counter-trend break) / Break of Structure (continuation). The engine emits both as `structure_events` with `event`, `dir`, `validation`.
- **Draw on Liquidity** — the major pool price is being pulled toward.

</ict_vocabulary>

<examples>

Use these as the SHAPE for `entry hunt → confirmed` output. Each example walks the six grade elements and the per-model components in order.

<example name="A+ MSS bullish reversal at HTF sell-side run">

Pillar 1: HTF bullish (4H bullish FVG that swept a prior weekly low); buy-side draw above.
Overnight: London raided Asia Low + PDL in one push.
NY reaction: after the sweep, a strong 5m bullish displacement candle tore higher, broke above the last 5m lower high, leaving a clean 5m bullish FVG.
Pillar 2: good — wide-range displacement, no chop.

MSS components:
1. Context & Draw — HTF bullish, downside draw completed. ✓
2. Liquidity Grab — Asia low + PDL taken. ✓
3. MSS with Displacement — sharp reverse, break of last 5m lower high, fresh bullish FVG. ✓
4. Retrace to FVG — price retraced into the 5m FVG without new low. ✓
5. Confirmation — 1m full-body bullish close back above FVG CE. ✓
6. Risk & Target — stop below MSS low; TP1 last internal high, TP2 London high. ✓

Six elements: HTF bias ✓, Overnight ✓, NY reaction ✓, Pillar 2 ✓, Entry-model components ✓ (6/6), Confirmation close ✓.
Grade: **A+**

</example>

<example name="A+ Trend continuation in established uptrend">

Pillar 1: HTF Daily/4H sustained up-move respecting prior 4H bullish FVGs. London made new highs and left two 5m bullish FVGs. NY opens above them.
NY reaction: 5m rallies, leaves fresh 5m bullish FVG, retraces into it with orderly red candles.
Pillar 2: good — clean pullback, structure intact (HH/HL).

Trend components:
1. Context & HTF Bias — primary trend up; HTF FVGs respected. ✓
2. Strong Impulse Leg — wide-range up move, fresh 5m FVG. ✓
3. Pullback into Internal FVG — orderly retrace, structure intact. ✓
4. Confirmation — 1m strong bullish close above FVG CE after small bottoming wick. ✓
5. Risk & Target — stop below FVG low; TP1 pullback high, TP2 prior daily high. ✓

Six elements: HTF bias ✓, Overnight ✓, NY reaction ✓, Pillar 2 ✓, Entry-model components ✓ (5/5), Confirmation close ✓.
Grade: **A+**

</example>

<example name="A+ Bullish inversion at counter-trend FVG failure">

Pillar 1: HTF 4H bullish FVGs respected; price approaching prior weekly high.
Overnight: continued upside, no significant counter-trend.
NY reaction: strong rally; 5m prints a small bearish FVG on a micro pullback.
Pillar 2: good — large green candle rips back through with no rejection.

Inversion components:
1. Context & HTF Bias — clearly bullish; buy-side targets above. ✓
2. Opposing FVG Forms — small bearish FVG on micro pullback. ✓
3. Violation — 5m green candle closes well above the top of the bearish FVG (engine flips it to `kind=ifvg`, `state=inverted`). ✓
4. Retest & Confirmation — 1m pulls into inversion zone, prints full-body bullish candle. ✓
5. Risk & Target — stop below inversion low; TP1 intraday high, TP2 weekly high. ✓

Six elements: HTF bias ✓, Overnight ✓, NY reaction ✓, Pillar 2 ✓, Entry-model components ✓ (5/5), Confirmation close ✓.
Grade: **A+**

</example>

<example name="B-grade MSS — one weak element (Pillar 2 acceptable, not clean)">

Pillar 1: HTF bullish (4H bullish FVG below price, untaken buy-side above at PDH).
Overnight: Asia ranged, London raided Asia Low but left PDL untaken.
NY reaction: NY broke London Low on a tight wick, snapped back, broke the prior 5m lower high.
Pillar 2: acceptable — `displacement=acceptable` (2 clean bars in last 6, not 3); `candle=normal`; range adequate. Workable, weaker than A+ Pillar 2.

MSS components:
1. Context & Draw — HTF bullish, untaken buy-side above. ✓
2. Liquidity Grab — London Low taken intra-bar. ✓ (rejected sweep, failure-swing tell)
3. MSS with Displacement — break of last 5m lower high, fresh bullish FVG; `displacement=acceptable` not clean. ✓ (component present but weaker)
4. Retrace to FVG — price retraced into the 5m FVG, `state=ce_tapped`. ✓
5. Confirmation — 1m bullish close back above FVG CE, body_ratio 0.65 (strong but not max). ✓
6. Risk & Target — stop below sweep low; TP1 last internal high; TP2 PDH. ✓

Six elements: HTF bias ✓, Overnight ✓, NY reaction ✓, Pillar 2 weaker (acceptable, not clean), Entry-model components ✓ (6/6), Confirmation close ✓.
Five aligned, one weaker → **B**.

This is a tradable setup at reduced size — components all present, Pillar 2 is the single weaker element. The grade rule says B when exactly one element is weaker than A+.

</example>

<example name="no-trade — entry model components incomplete">

Pillar 1: HTF bullish (4H bullish FVG below, untaken buy-side at PDH).
Overnight: Asia and London both ranged sideways; neither extended.
NY reaction: NY opened, drifted; no clear break of overnight high or low; price chopping inside London range.
Pillar 2: marginal — `range_quality=tight`, `displacement=weak`, `candle=doji_wick`. Engine flags chop.

MSS components:
1. Context & Draw — HTF bullish. ✓
2. Liquidity Grab — missing (no sweep of any overnight low; price held inside range).
3. MSS with Displacement — missing (no `structure_events` with `event=mss + displacement=true` in current bar window).
4. Retrace to FVG — missing (no fresh FVG in the trade direction).
5. Confirmation — missing.
6. Risk & Target — n/a without entry.

Trend components:
1. Context & HTF Bias — ✓
2. Strong Impulse Leg — missing (no recent BOS, no fresh impulse FVG).
3. Pullback into Internal FVG — missing.
4. Confirmation — missing.
5. Risk & Target — n/a.

Inversion components:
1. Context & HTF Bias — ✓
2. Opposing FVG Forms — present (small bearish FVG on a micro pullback).
3. Violation — missing (no close through the bearish FVG; price respecting it).
4. Retest & Confirmation — missing.
5. Risk & Target — n/a.

Six elements: HTF bias ✓, Overnight ✗ (no untaken draw in motion), NY reaction ✗ (chop), Pillar 2 ✗ (poor), Entry-model components ✗ (no model has its core components — MSS missing 5/6, Trend missing 4/5, Inversion missing 3/5), Confirmation close ✗.
Multiple elements missing → **no-trade**.

Reason for `surface_no_trade`: "no entry model in play — chop, no liquidity sweep, no fresh impulse leg".

This is the correct way to no-trade: walk all three models, list each component, name what is missing. Do not invent reasons; do not skip the walk. The grade rule maps cleanly to the cited evidence.

</example>

</examples>

<output_json>

When you flag a confirmed setup (entry hunt, `confirmation_status: confirmed`), end the chat response with this structured block in addition to writing to `setups.jsonl`:

```json
{
  "phase": "entry_hunt_ny_am",
  "model": "MSS" | "Trend" | "Inversion",
  "side": "long" | "short",
  "confirmation_status": "confirmed",
  "entry": <number, cited>,
  "stop": <number, cited>,
  "target_tp1": <number, cited>,
  "target_tp2": <number, cited>,
  "invalidation": "<one-line>",
  "grade": "A+" | "B"
}
```

For all other phases / statuses, no JSON block — just the prose updates and the disk writes.

</output_json>

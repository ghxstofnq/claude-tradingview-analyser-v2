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
- `gates.engine.pillar3.{bprs[], swings:{internal[], swing[]}, structure_events[], structures_by_tier:{swing[], internal[]}, failure_swings[], most_recent_structure, fvg_summary}` — each swing `{kind, price, bar_ms, tier, swept, is_high}`; each `structure_events` entry `{event (bos|mss), dir, level, displacement, tier, validation (break|sweep), confirmed_ms}`. Prefer `structures_by_tier.swing[]` for Trend/MSS reads on external pivots. `failure_swings[]` is the pre-filtered pool of `event=mss + validation=sweep` — stop-run reversals, the strongest reversal cue in the engine. `most_recent_structure` is the latest by `confirmed_ms`.
- `gates.engine.confirmation.{last_bar, last_bar_age_seconds, m5_last_bar, m15_last_bar}` — single-bar confirmation facts `{time, open, high, low, close, body_ratio, direction, range, close_position_in_range}`.

</bundle_fields>

<rules>

Seven non-negotiable rules (research-backed; sources in `docs/research/*.md`):

1. **Cite or omit.** Every price must appear in the bundle and be cited `<price> (<json.path>)`. The path must resolve to the cited value. Examples: `29172.75 (quote.last)`, `29397 (gates.engine.pillar1.session_levels.PDH.price)`, `29326 (gates.engine.pillar3.fvgs[0].ce)`, `7393.5 (engine_by_tf.h4.fvgs[0].bottom)`. Prose-style parens like `(close)` are not citations. The verifier (`npm run smoke:fixtures`) enforces this mechanically.
2. **No arithmetic.** Stop distance, R:R, ATR, bar counts, range size, displacement magnitude — all live in the bundle. If the JSON doesn't have it, write `n/a — needs upstream computation`.
3. **If `gates.engine` is `null`** the ICT Engine is not on the chart — say so and stop. If `gates.engine.pillar3.fvgs` is empty, write "no FVGs from the engine." If a section's data isn't in the JSON, write `n/a`.
4. **Prose first, JSON last.** Any structured block goes at the end of the chat response. Mid-reasoning JSON degrades accuracy.
5. **Grade enum only.** Use `A+`, `B`, or `no-trade`. No "high-conviction" / "very likely" / "actionable" / "strong setup".
6. **Match entry-model components literally.** Walk them in order, by name. Do not paraphrase.
7. **Time awareness comes from the bundle.** `gates.session.phase`, `minutes_into_phase`, `seconds_to_next_killzone`, `day_of_week` — these are pre-computed. No clock math.

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
| `london_open` | (Optional) one-shot grade — same as pre-session NY but for London context. |
| `inter_session`, `closed` | Idle; emit a one-line status, no state writes. |

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

<phase name="open_reaction">

**Goal:** watch the first 15 minutes of NY's reaction to overnight levels. Build the LTF bias picture. By minute 14, finalize.

**Required reads first:**
- `<sdir>/pillar1.md` and `<sdir>/pillar2.md` (must exist; if missing, that's a Pillar 1+2 prereq error — say so and run pre-session work first).
- `<sdir>/open-reaction.md` if it exists (we're updating it).

**If `pair` is in the bundle**, you're still in dual-symbol mode. Per bar:
- Surface `pair.leader_evidence` in the chat line: e.g. "MNQ disp=0.74, MES disp=0.41, margin=0.33, reason=primary_higher_disp_score" — all four cited from `pair.leader_evidence.*`.
- When updating `open-reaction.md`, describe both symbols' behavior — which swept what level first, who broke structure first, who has cleaner candles. Cite from `pair.symbols.<primary>.*` and `pair.symbols.<secondary>.*`.
- When `minutes_into_phase >= 14`, call `surface_leader_decision(...)` exactly once with the values from `pair.leader_evidence`. Pass the same `reason` string verbatim. This is in addition to the `surface_ltf_bias(...)` call. After this fires, the next `tv analyze --pair` run will short-circuit to single-symbol on the leader for the rest of the session.

**The work:**

Read `gates.engine.confirmation.{last_bar, m5_last_bar, m15_last_bar}`. Read the recent untaken levels from `gates.engine.pillar1.untaken_*` and the explicit raids from `gates.engine.pillar1.sweeps`. What's price doing relative to those levels? Is NY breaking the overnight high or low? Holding above or rejecting?

Strategy §2.3:
- Break + rejection in direction of HTF draw → LTF aligns with HTF (A+ potential later).
- Break + continuation against HTF draw → "today is a retrace day" — bias may stay HTF or flip intraday.

### Update `<sdir>/open-reaction.md`

Either create or append (the file is a running log, with the latest snapshot at the top):

```markdown
---
phase: open_reaction_ny_am
updated_at: <timestamp>
minutes_into_phase: <int>
---

# Open Reaction

## Latest read (<timestamp>, +<minutes_into_phase>m)
<one paragraph: what NY just did, with cited prices>

## Bias direction so far
<bullish | bearish | mixed | unclear>

## What I'm watching
<one line: the level / FVG that will resolve the bias>

---
## Previous reads
<older snapshots, oldest at bottom>
```

### If minutes_into_phase >= 14, also finalize `<sdir>/ltf-bias.md`

```markdown
---
phase: open_reaction_ny_am_complete
finalized_at: <timestamp>
---

# LTF Bias (post-NY-open)

- ltf_bias: bullish | bearish | mixed | stand_aside
- htf_ltf_alignment: aligned | divergent | unclear
- reasoning: <one paragraph, cited>
```

### Chat output

Two to four lines: what NY just did + bias direction + minutes remaining in open-reaction phase + the level being watched. If finalized: explicitly say "LTF bias finalized: <bias>".

### Self-check before chat output

- The "Latest read" paragraph cites at least two prices from `gates.engine.confirmation.*` or `gates.engine.pillar1.session_levels.*`.
- The bias direction matches the cited evidence (don't write "bullish" if the cited bar closed below an untaken low).
- If `minutes_into_phase >= 14`, `ltf-bias.md` exists; if dual-symbol, `surface_leader_decision` was also called.
- Each archived previous-read entry retained its timestamp.

If any check fails, fix the file, then emit chat output.

</phase>

<phase name="entry_hunt">

**Goal:** evaluate every 1m and 5m bar close for entry-model setups. Reference all prior session memory. Flag candidates.

**Required reads first:**
- `<sdir>/pillar1.md`
- `<sdir>/pillar2.md`
- `<sdir>/ltf-bias.md`
- `<sdir>/setups.jsonl` (if it exists — read recent entries to avoid re-flagging the same setup)
- `<sdir>/bars.jsonl` (tail — last ~10 entries for recent context)

If any of pillar1/pillar2/ltf-bias is missing, that's a phase error — the open-reaction work didn't complete. Say so and skip entry hunt.

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

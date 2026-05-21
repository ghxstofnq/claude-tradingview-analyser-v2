---
description: Phase-aware ICT analysis. Runs Lanto's 3-pillar strategy end-to-end across a trading session, building session memory in state/session/<date>/<session>/. Designed to be invoked once per bar close.
---

## Strategy authority (read first)

This project implements **Lanto's 3-pillar ICT framework**. Authoritative spec:

- [docs/strategy/trading-strategy-2026.md](../../docs/strategy/trading-strategy-2026.md) — three pillars, 7-step checklist, A+/B grading.
- [docs/strategy/entry-models.md](../../docs/strategy/entry-models.md) — MSS / Trend / Inversion components, A+ examples.

Strategy §7 is **sequential**: HTF bias → overnight → Pillar 2 → NY reaction → entry model → confirmation → sizing. This slash command walks that sequence across a whole session by branching on phase.

Architecture plan: [docs/plans/llm-driven-session.md](../../docs/plans/llm-driven-session.md). Data source: [docs/plans/2026-05-21-ict-engine-migration.md](../../docs/plans/2026-05-21-ict-engine-migration.md).

---

## How to run

The capture command depends on whether a fresh HTF baseline is needed. Always `Read state/last-analyze.json` afterwards — it is the only data source for this invocation, and the dashboard reads it too.

**Full capture** — run when: (a) it is the first invocation of the session, (b) `state/baseline.json` does not exist, (c) the triggering detector event has `is_5m_close: true`, or (d) `baseline_meta.age_seconds > 900` in the last bundle. Multi-TF sweep (~13s); refreshes the HTF baseline:

```bash
./bin/tv analyze --out state/last-analyze.json && cp state/last-analyze.json state/baseline.json
```

**Fast capture** — run on every other 1m close (the common case during open-reaction and entry-hunt). Reuses the cached HTF baseline; returns in ~0.2s:

```bash
./bin/tv analyze --pillar3-only --baseline state/baseline.json --out state/last-analyze.json
```

A fast capture still carries fresh current-TF data plus `bars_by_tf`, `engine_by_tf`, and `gates.engine.pillar2.m5/m15` merged from the baseline. Pre-session always uses a full capture — HTF bias needs the live sweep.

After reading, look at **`gates.session.phase`** to determine what to do. Phase-driven work + state-file accumulation is what makes the session smart across many invocations.

---

## Bundle fields (quick reference)

The **ICT Engine** indicator is the single data source. It emits one schema-versioned evidence table; `tv analyze` parses it into structured, numerically-typed objects. Every price resolves at a real JSON path (cite-or-reject).

- `chart` — symbol, current resolution, indicators on chart.
- `quote.last` — current price.
- `bars` — OHLCV summary + `last_5_bars` at the current chart TF.
- `bars_by_tf.{daily, h4, h1, m15, m5, m1}` — per-TF bar summaries incl. `range` and `change_pct` (use these for HTF momentum).
- `engine` — the parsed ICT Engine table at the chart's current TF: `{schema, schema_supported, meta, levels[], sweeps[], fvgs[], bprs[], swings[], structures[], quality}`.
- `engine_by_tf.{daily, h4, h1, m15, m5, m1}` — the same parsed engine object captured at each TF. **HTF FVGs and HTF structure live here** (`.fvgs`, `.structures`, `.swings`, `.quality`, `.levels`).
- `gates.session.*` — clock-based facts (phase, label, minutes_into_phase, next_killzone_label, seconds_to_next_killzone, in_killzone, is_market_closed, replay state).
- `gates.engine.meta` — `{schema, schema_supported, tf, emit_ny, symbol}` provenance. **If `schema_supported` is false the engine bumped its format — say so and stop.**
- `gates.engine.price_context.{inside_fvgs, inside_bprs}` — engine zones containing current price.
- `gates.engine.pillar1.session_levels.{PWH, PWL, PDH, PDL, AS_H, AS_L, LO_H, LO_L, NYAM_H, NYAM_L}` — each `{name, price, state, swept, formed_ms, position_vs_price}`. `untaken_sell_side_below[]` + `untaken_buy_side_above[]` are pre-sorted draw targets. `sweeps[]` — explicit liquidity-raid events `{target, price, side, swept_ms, rejected}` (`rejected: true` = a failure-swing).
- `gates.engine.pillar2.{current_tf, m5, m15}` — each the engine quality verdict `{range_3h, range_quality (good|tight|na), displacement (clean|weak|na), candle (engulfing|doji_wick|normal), has_chop}`.
- `gates.engine.pillar3.fvgs[]` — `{kind (fvg|ifvg), dir (bull|bear), top, bottom, ce, created_ms, took_liq, disp_score, state (fresh|ce_tapped|filled|inverted|invalidated)}`.
- `gates.engine.pillar3.{bprs[], swings:{internal[], swing[]}, structure_events[], most_recent_structure, fvg_summary}` — each swing `{kind, price, bar_ms, tier, swept, is_high}`; each `structure_events` entry `{event (bos|mss), dir, level, displacement, tier, validation (break|sweep), confirmed_ms}`; `most_recent_structure` is the latest by `confirmed_ms`.
- `gates.engine.confirmation.{last_bar, last_bar_age_seconds, m5_last_bar, m15_last_bar}` — single-bar confirmation facts `{time, open, high, low, close, body_ratio, direction, range, close_position_in_range}`.

---

## Rules (non-negotiable; derived from `docs/research/ai-trading-analysis.md`)

1. **Cite or omit.** Every price must appear in the bundle and be cited `<price> (<json.path>)`. The path must resolve to the cited value. Examples: `29172.75 (quote.last)`, `29397 (gates.engine.pillar1.session_levels.PDH.price)`, `29326 (gates.engine.pillar3.fvgs[0].ce)`, `7393.5 (engine_by_tf.h4.fvgs[0].bottom)`. No prose-style parens like `(close)`. Verifier (`npm run smoke:fixtures`) enforces.
2. **No arithmetic.** Don't compute stops, R:R, distances, body ratios, ATR. If the JSON doesn't have it, write `n/a — needs upstream computation`.
3. **Don't invent.** If `gates.engine` is `null` the ICT Engine is not on the chart — say so and stop. If `gates.engine.pillar3.fvgs` is empty, write "no FVGs from the engine." If a section's data isn't in the JSON, write `n/a`.
4. **Prose first, JSON last.** Any structured block goes at the end of the chat response. Mid-reasoning JSON degrades accuracy.
5. **Grade enum only.** `A+ | B | no-trade`. No "high-conviction" / "very likely" / "actionable" / "strong setup".
6. **Match entry-model components literally.** Walk them in order, by name. Don't paraphrase.
7. **Time awareness comes from the bundle.** `gates.session.phase`, `minutes_into_phase`, `seconds_to_next_killzone`, `day_of_week` — these are pre-computed. Don't do clock math.

---

## Phase routing

Read `gates.session.phase`. Branch:

| Phase value | What to do |
|---|---|
| `pre_session_ny_am`, `pre_session_ny_pm` | Pre-session grade (if not already done today). |
| `open_reaction_ny_am`, `open_reaction_ny_pm` | Open-reaction watch (15-min window). |
| `entry_hunt_ny_am`, `entry_hunt_ny_pm` | Per-bar entry-model hunt. |
| `post_ny_am`, `post_ny_pm` | Session wrap. |
| `london_open` | (Optional) one-shot grade — same as pre-session NY but for London context. |
| `inter_session`, `closed` | Idle; emit a one-line status, no state writes. |

Files live in a **per-session folder**, `state/session/<date>/<session>/`:

- `<date>` — derived from `gates.session.timestamp_et` (e.g. "Tue, 05/19/2026, 14:30:00" → `2026-05-19`).
- `<session>` — derived from the phase: any `*_ny_am` phase → `ny-am`; any `*_ny_pm` → `ny-pm`; `london_open` → `london`.
- **`<sdir>`** is the shorthand used throughout this command for that full path: `<sdir>/pillar1.md` means `state/session/<date>/<session>/pillar1.md`. Create `<sdir>` on demand before the first write.

Each session folder is self-contained — NY AM, NY PM, and London never overwrite each other, so every session's grade and wrap persist for later review. The one day-level file is the detector's `bar-close-events.jsonl`, which stays directly under `state/session/<date>/`.

---

## Phase: Pre-session (NY AM or NY PM)

**Goal:** grade Pillar 1 + Pillar 2 once for this session. Subsequent pre-session invocations should detect prior work and not re-grade.

**Check first:**
- If `<sdir>/pillar1.md` already exists, this session is graded — **arm the per-bar loop** (see the final step of this phase), then output one line "Pre-session already graded (P1=<bias>, P2=<verdict>). Loop armed. Idle until <next phase>." and stop.
- Otherwise grade now. Each session has its own folder, so NY AM, NY PM, and London grades never collide.

**If not done, do these in order:**

### Step 1 — Pillar 1a: HTF Bias (Daily / 4H / 1H)

Infer HTF bias from two engine-backed signals:
- **HTF momentum** — `bars_by_tf.daily.change_pct`, `bars_by_tf.h4.change_pct`, `bars_by_tf.h1.change_pct`. Agreement = directional; mixed signs = neutral.
- **HTF structure** — `engine_by_tf.daily.structures`, `.h4.structures`, `.h1.structures`. The most recent `event` (`bos`/`mss`) and its `dir` is the last confirmed shift on that TF.

For the **HTF PD arrays** (strategy §2.1's "best imbalances"), scan `engine_by_tf.daily.fvgs`, `engine_by_tf.h4.fvgs`, `engine_by_tf.h1.fvgs`. The engine types each FVG (`kind`, `dir`) and scores it: prefer FVGs with high `disp_score` and `took_liq: true` — that is exactly strategy §2.1's "extensive, took liquidity in creation." Pick the most material as the primary HTF draw.

### Step 2 — Pillar 1b: Overnight & Session Correlation

Read `gates.engine.pillar1.session_levels.*` and the pre-sorted `untaken_sell_side_below[]` / `untaken_buy_side_above[]`. State which liquidity is `swept` / untaken. `gates.engine.pillar1.sweeps[]` gives the explicit raids — each carries a `side` and a `rejected` flag (a rejected sweep is a failure-swing, a reversal tell). State whether overnight extended (lots swept one side) or consolidated (mixed / both sides swept).

### Step 3 — Pillar 2: Range + Quality

The engine emits a quality verdict per TF — no manual candle math.

- **Current TF:** `gates.engine.pillar2.current_tf.{range_3h, range_quality, displacement, candle, has_chop}`. `range_quality` is `good` (3h range large vs ATR) or `tight`; `displacement` is `clean` or `weak`; `candle` is `engulfing` / `doji_wick` / `normal`.
- **m5 / m15:** `gates.engine.pillar2.m5.*` and `.m15.*` — strategy §7 step 3 wants 5m/15m anatomy specifically.
- **HTF displacement:** `engine_by_tf.h4.quality` and `engine_by_tf.h1.quality`, plus `bars_by_tf.h4.range`.
- **Verdict:** `good | marginal | poor`. `range_quality=tight` + `displacement=weak` + `candle=doji_wick` + `has_chop=true` is poor. Override the engine's verdict if you disagree — judge the displacement at the setup, not a lagging average.

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

Pillar 1 + 2 are the session's foundation. Once they exist, start the per-bar loop so `/analyze` fires on every bar close for the rest of the session. Do this at the end of **every** pre-session invocation — whether you just graded the files or found them already there:

1. Read `state/session/detector-heartbeat.json`. If it exists and its heartbeat is fresh (age < 90s), the detector is already running under a monitor — **do nothing, the loop is already live.**
2. Otherwise start it with the `Monitor` tool: `Monitor("./bin/tv stream bar-close")`. That launches the detector and streams one event per closed 1m bar (each line carries `is_5m_close: true` on 5m boundaries).
3. React to every monitored bar-close event by running `/analyze` again. It will branch to the open-reaction / entry-hunt / post phase as the ET clock advances — a full capture when the event has `is_5m_close: true`, a fast `--baseline` capture otherwise.

This is the bootstrap for the LLM-driven session (`docs/plans/llm-driven-session.md`): the pre-session grade arms the loop, and the loop drives the rest of the trading day. The loop is armed once per session and persists via the monitor; the heartbeat check in step 1 stops a second monitor from starting.

---

## Phase: Open reaction (NY AM or NY PM)

**Goal:** watch the first 15 minutes of NY's reaction to overnight levels. Build the LTF bias picture. By minute 14, finalize.

**Required reads first:**
- `<sdir>/pillar1.md` and `<sdir>/pillar2.md` (must exist; if missing, that's a Pillar 1+2 prereq error — say so and run pre-session work first).
- `<sdir>/open-reaction.md` if it exists (we're updating it).

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

### If minutes_into_phase >= 14, ALSO finalize `<sdir>/ltf-bias.md`

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

---

## Phase: Entry hunt (NY AM or NY PM)

**Goal:** evaluate every 1m and 5m bar close for entry-model setups. Reference all prior session memory. Flag candidates.

**Required reads first:**
- `<sdir>/pillar1.md`
- `<sdir>/pillar2.md`
- `<sdir>/ltf-bias.md`
- `<sdir>/setups.jsonl` (if it exists — read recent entries to avoid re-flagging the same setup)
- `<sdir>/bars.jsonl` (tail — last ~10 entries for recent context)

If any of pillar1/pillar2/ltf-bias is missing, that's a phase error — the open-reaction work didn't complete. Say so and skip entry hunt.

**For each new bar (1m close, and 5m close when `gates.engine.confirmation.last_bar.time % 300 == 0`):**

1. Append the bar facts to `<sdir>/bars.jsonl`:

```jsonl
{"time": <bar_time>, "tf": "1m", "o": <open>, "h": <high>, "l": <low>, "c": <close>, "body_ratio": <bratio>, "direction": "<dir>", "close_position_in_range": <cp>}
```

(Use the bundle's `gates.engine.confirmation.last_bar.*` fields. Write `tf: "5m"` and a separate line to `<sdir>/bars-5m.jsonl` when at a 5m boundary.)

2. **Walk all three entry models — explicitly, by name, every bar.** Read `gates.engine.pillar3.most_recent_structure`, `gates.engine.pillar3.structure_events`, `gates.engine.price_context.inside_fvgs`, `gates.engine.pillar3.fvgs`, and `gates.engine.pillar3.fvg_summary`. Then state a one-line verdict for **each** of MSS / Trend / Inversion — do not stop at the first model that doesn't fit. Grade each model ONLY on its own components (`entry-models.md`); never disqualify one model with another model's rule.

   - **MSS** — a sweep of a swing low/high → sharp displacement back the other way → retrace into the freshly-created FVG → confirmation close. The engine emits this mechanically: a `structure_events` entry with `event=mss`, `displacement=true`, and a matching fresh `fvg`.
   - **Trend** — HTF + LTF aligned, an impulse leg, pullback into an internal FVG **with structure intact (higher highs / higher lows)** → confirmation close. A `structure_events` entry with `event=bos` is the engine's continuation signal. The "structure intact" requirement is Trend-only.
   - **Inversion** — an opposing-direction FVG violated by a strong close → optional retest of the inverted zone → confirmation close. The engine emits this directly: an `fvg` with `kind=ifvg` and `state=inverted`. Inversions form *during* a pullback — **a broken higher low does NOT disqualify an Inversion** (that is a Trend-model rule).

   Guards (each cost a real trade on 2026-05-20):
   - **FVG size** — a small FVG is still tradeable. On MNQ a ~13-point (~50-tick) FVG is normal. Do not reject a setup for FVG size. `disp_score` tells you the displacement strength — trust it over raw gap size.
   - **The engine quality fields are a hint, not a veto** — `gates.engine.pillar2.m5.candle` / `displacement` are lagging summaries. Judge the displacement *at* the setup, and override when you disagree.
   - **Don't manufacture no-trades.** When a model's own components + HTF alignment + a confirmation close are all present, that is at least a **B** — grade it. The discipline rules exist to stop *forcing* trades, not to reject valid ones.

3. **If a candidate is forming or has fired**, append to `<sdir>/setups.jsonl`:

```jsonl
{"ts": "<iso>", "bar_time": <t>, "tf": "1m", "model": "MSS|Trend|Inversion", "status": "candidate|confirmed|invalidated", "side": "long|short", "rationale": "<one line with cites>", "fvg": {"top": <t>, "bottom": <b>, "kind": "fvg|ifvg", "dir": "bull|bear"}, "confirmation_bar": {"close": <c>, "body_ratio": <br>, "direction": "<d>"} | null}
```

### Chat output

**Default (no setup):** ONE line. Format:
`<phase>:<min>m  bar=<bar_time> body=<br> dir=<dir> | no setup (last_bar at <close>, in <list-or-none> FVGs)`

**Setup forming (status=candidate):** TWO to THREE lines. Cite the FVG; note the model; say what would confirm. `candidate` covers every pre-entry stage — from a setup just starting to form through to one bar away from confirmation.

**Setup CONFIRMED:** the longer prose+JSON read. Use the structured block from the "Examples" section below. Cite entry, stop (structural invalidation), TP1 (local liquidity), TP2 (HTF draw if supported). Include the model walk per `docs/strategy/entry-models.md`.

---

## Phase: Post-session (NY AM or NY PM)

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

---

## Phase: London Open, Inter-session, Closed

**London Open** — optional context-build window. The system is session-focused (NY AM + NY PM), but if you want a London read, treat it as a one-shot grade. Here `<session>` is `london`, so `<sdir>` resolves to `state/session/<date>/london/`. Write `<sdir>/pillar1.md` and `<sdir>/pillar2.md` exactly as in the Pre-session phase (`phase: london_open` in the frontmatter), then a brief `<sdir>/summary.md` wrap as in the Post-session phase. The `london/` folder is independent — NY AM and NY PM never touch it, so the London grade persists for later review. Skip the grade if `<sdir>/pillar1.md` already exists.

**Inter-session, Closed** — idle. Say "Outside NY sessions — no work" plus current phase + countdown. No state writes.

---

## ICT vocabulary (re-read each invocation; small enough to keep in context)

- **Market-structure labels (HH/HL/LH/LL)** — the ICT Engine names a swing pivot with the **textbook** convention: the SECOND letter is the pivot **type** (`H`igh or `L`ow), the FIRST is whether it is `H`igher or `L`ower than the previous pivot of that same type.
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

---

## Examples (three A+ readings)

Use these as the SHAPE for `entry hunt → confirmed` output. Each example was an A+ — your read needs the same level of HTF/LTF/quality alignment to grade A+.

<example>
**MSS bullish reversal at HTF sell-side run**

Pillar 1: HTF bullish (4H bullish FVG that swept a prior weekly low); buy-side draw above.
Overnight: London raided Asia Low + PDL in one push.
NY reaction: after the sweep, a strong 5m bullish displacement candle tore higher, broke above the last 5m lower high, leaving a clean 5m bullish FVG.
Pillar 2: good — wide-range displacement, no chop.
Pillar 3 — MSS components:
1. Context & Draw — HTF bullish, downside draw completed. ✓
2. Liquidity Grab — Asia low + PDL taken. ✓
3. MSS with Displacement — sharp reverse, break of last 5m lower high, fresh bullish FVG. ✓
4. Retrace to FVG — price retraced into the 5m FVG without new low. ✓
5. Confirmation — 1m full-body bullish close back above FVG CE. ✓
6. Risk & Target — stop below MSS low; TP1 last internal high, TP2 London high.

Grade: **A+**
</example>

<example>
**Trend continuation in established uptrend**

Pillar 1: HTF Daily/4H sustained up-move respecting prior 4H bullish FVGs. London made new highs and left two 5m bullish FVGs. NY opens above them.
NY reaction: 5m rallies, leaves fresh 5m bullish FVG, retraces into it with orderly red candles.
Pillar 2: good — clean pullback, structure intact (HH/HL).
Pillar 3 — Trend components:
1. Context & HTF Bias — primary trend up; HTF FVGs respected. ✓
2. Strong Impulse Leg — wide-range up move, fresh 5m FVG. ✓
3. Pullback into Internal FVG — orderly retrace, structure intact. ✓
4. Confirmation — 1m strong bullish close above FVG CE after small bottoming wick. ✓
5. Risk & Target — stop below FVG low; TP1 pullback high, TP2 prior daily high.

Grade: **A+**
</example>

<example>
**Bullish inversion at counter-trend FVG failure**

Pillar 1: HTF 4H bullish FVGs respected; price approaching prior weekly high.
Overnight: continued upside, no significant counter-trend.
NY reaction: strong rally; 5m prints a small bearish FVG on a micro pullback.
Pillar 2: good — large green candle rips back through with no rejection.
Pillar 3 — Inversion components:
1. Context & HTF Bias — clearly bullish; buy-side targets above. ✓
2. Opposing FVG Forms — small bearish FVG on micro pullback. ✓
3. Violation — 5m green candle closes well above the top of the bearish FVG (engine flips it to `kind=ifvg`, `state=inverted`). ✓
4. Retest & Confirmation — 1m pulls into inversion zone, prints full-body bullish candle. ✓
5. Risk & Target — stop below inversion low; TP1 intraday high, TP2 weekly high.

Grade: **A+**
</example>

---

## Output JSON (only on `entry_hunt_*` phase with `confirmation_status: confirmed`)

When you flag a confirmed setup, end the chat response with this structured block (in addition to writing to `setups.jsonl`):

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

---

## Constraints (mirrors CLAUDE.md hard constraints)

- CLI only — no `mcp__tradingview__*` tools.
- CDP 9223 only — never 9222.
- No screenshots in analysis input.
- The strategy is authoritative; see `docs/strategy/*.md`.
- The rules above are research-backed; see `docs/research/*.md`.

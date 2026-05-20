---
description: Phase-aware ICT analysis. Runs Lanto's 3-pillar strategy end-to-end across a trading session, building session memory in state/session/<date>/. Designed to be invoked once per bar close.
---

## Strategy authority (read first)

This project implements **Lanto's 3-pillar ICT framework**. Authoritative spec:

- [docs/strategy/trading-strategy-2026.md](../../docs/strategy/trading-strategy-2026.md) — three pillars, 7-step checklist, A+/B grading.
- [docs/strategy/entry-models.md](../../docs/strategy/entry-models.md) — MSS / Trend / Inversion components, A+ examples.

Strategy §7 is **sequential**: HTF bias → overnight → Pillar 2 → NY reaction → entry model → confirmation → sizing. This slash command walks that sequence across a whole session by branching on phase.

Architecture plan: [docs/plans/llm-driven-session.md](../../docs/plans/llm-driven-session.md).

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

A fast capture still carries fresh current-TF data plus `bars_by_tf`, `pine_by_tf`, and `gates.pillar2.m5/m15` merged from the baseline. Pre-session always uses a full capture — HTF bias needs the live sweep.

After reading, look at **`gates.session.phase`** to determine what to do. Phase-driven work + state-file accumulation is what makes the session smart across many invocations.

---

## Bundle fields (quick reference)

- `chart` — symbol, current resolution, indicators on chart.
- `quote.last` — current price.
- `bars` — OHLCV summary + `last_5_bars` at the current chart TF.
- `bars_by_tf.{daily, h4, h1, m15, m5, m1}` — per-TF bar summaries (use these for HTF bias).
- `pine_by_tf.{daily, h4, h1, m15, m5, m1}.{boxes, labels}` — HTF FVGs/structure (trimmed to FVG/iFVG, Anchored Structures, Killzones, BPR; ~30 per study per TF). `bgColor` decodes to FVG direction (0x94ab22=bullish_fvg, 0xf57931=bullish_ifvg, 0x5f52f7=bearish_fvg, 0x26a7ff=bearish_ifvg).
- `pine.{lines, labels, tables, boxes}` — current TF only.
- `gates.session.*` — clock-based facts (phase, label, minutes_into_phase, next_killzone_label, seconds_to_next_killzone, in_killzone, is_market_closed, replay state).
- `gates.price_context.{inside_boxes, wick_tapped_boxes}` — which Pine boxes contain price; wick_tapped also includes boxes the bar's wick overlapped. FVG entries carry `fvg_direction`.
- `gates.pillar1.session_levels.{PWH, PWL, PDH, PDL, AS_H, AS_L, LO_H, LO_L, NYAM_H, NYAM_L, NYPM_H, NYPM_L}` — `{label, price, position_vs_price, taken}`. `untaken_sell_side_below[]` + `untaken_buy_side_above[]` are pre-sorted "draw" targets.
- `gates.pillar1.bias_labels[]` — any Pine label matching /bias/i (empty when no indicator publishes one).
- `gates.pillar2.{range_value, range_acceptable, current_tf, m5, m15}` — range + per-TF candle anatomy (`{body_ratios_last_5, avg_body_ratio_last_5, candle_quality_heuristic, engulfing_count_last_5, doji_count_last_5, last_bar}`).
- `gates.pillar3.{most_recent_structure, fvg_by_type, fvg_by_type_above, fvg_by_type_below, last_bar, last_bar_age_seconds}` — ICT structure points, FVG counts by direction, single-bar confirmation facts. **`most_recent_structure` label letters use the AMS `[type][modifier]` convention — `HL` is a Lower High, `LH` is a Higher Low. See ICT vocabulary.**

---

## Rules (non-negotiable; derived from `docs/research/ai-trading-analysis.md`)

1. **Cite or omit.** Every price must appear in the bundle and be cited `<price> (<json.path>)`. The path must resolve to the cited value. Examples: `29172.75 (quote.last)`, `29302.75 (pine.labels.studies[0].labels[0].price)`, `7393.5 (pine_by_tf.h4.boxes.studies[0].all_boxes[0].low)`. No prose-style parens like `(close)`. Verifier (`npm run smoke:fixtures`) enforces.
2. **No arithmetic.** Don't compute stops, R:R, distances, body ratios, ATR. If the JSON doesn't have it, write `n/a — needs upstream computation`.
3. **Don't invent.** If `pine.lines` is empty, write "no Pine lines on chart." If a section's data isn't in the JSON, write `n/a — indicator not on chart`.
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

Each phase reads & writes specific files in `state/session/<YYYY-MM-DD>/` where `<YYYY-MM-DD>` is derived from `gates.session.timestamp_et` (e.g. "Tue, 05/19/2026, 14:30:00" → `2026-05-19`). Create the directory on demand.

---

## Phase: Pre-session (NY AM or NY PM)

**Goal:** grade Pillar 1 + Pillar 2 once for this session. Subsequent pre-session invocations should detect prior work and not re-grade.

**Check first:**
- For NY AM: if `state/session/<date>/pillar1.md` exists AND its frontmatter says `phase: pre_session_ny_am`, this work is done.
- For NY PM: if `pillar1-ny-pm.md` exists with `phase: pre_session_ny_pm`, done.
- If done: output one line "Pre-session already graded (P1=<bias>, P2=<verdict>). Idle until <next phase>." and stop.

**If not done, do these in order:**

### Step 1 — Pillar 1a: HTF Bias (Daily / 4H / 1H)

Read `gates.pillar1.bias_labels[]` first. If non-empty, cite the published bias. If empty (current state), **infer** from `bars_by_tf.daily.change_pct`, `bars_by_tf.h4.change_pct`, `bars_by_tf.h1.change_pct`. Agreement = directional; mixed signs = neutral.

For the **HTF PD arrays** (strategy §2.1's "best imbalances"), scan `pine_by_tf.daily.boxes`, `pine_by_tf.h4.boxes`, `pine_by_tf.h1.boxes`. Filter to FVG/iFVG study, decode `bgColor`. Pick the most material HTF FVG as the primary HTF draw.

### Step 2 — Pillar 1b: Overnight & Session Correlation

Read `gates.pillar1.session_levels.*` and the pre-sorted `untaken_sell_side_below[]` / `untaken_buy_side_above[]`. State which liquidity is `taken` / `untaken`. State whether overnight was extending (lots taken one side) or consolidating (mixed).

### Step 3 — Pillar 2: Range + 5m/15m Candle Anatomy

- **Range:** cite `gates.pillar2.range_value`, `gates.pillar2.range_per_bar`. Heuristic verdict in `range_acceptable`; override if you disagree (especially on MES — MNQ-calibrated).
- **HTF displacement:** read `bars_by_tf.h4.range` + `change_pct` and `bars_by_tf.h1.range` + `change_pct`.
- **m5 anatomy:** `gates.pillar2.m5.{body_ratios_last_5, avg_body_ratio_last_5, candle_quality_heuristic, engulfing_count_last_5, doji_count_last_5}`. Strategy wants "mainly engulfing, not dominated by dojis."
- **m15 anatomy:** same fields under `gates.pillar2.m15.*`.
- **Verdict:** `good | marginal | poor`. If marginal/poor on either m5 or m15, downgrade.

### Write the two files

Use the `Write` tool to create:

**`state/session/<date>/pillar1.md`** (or `pillar1-ny-pm.md` for the afternoon session):

```markdown
---
phase: pre_session_ny_am          # or pre_session_ny_pm
graded_at: <gates.session.timestamp_et>
symbol: <chart.symbol>
---

# Pillar 1 — Draw & Bias

## HTF Bias
<one paragraph with cited prices>

## Primary HTF Draw
<one sentence: the most material HTF FVG / liquidity pool, with cited high/low>

## Overnight Summary
<which levels are taken / untaken, with cited prices>

## Verdict
- htf_bias: bullish | bearish | neutral
- bias_direction_note: <one line>
```

**`state/session/<date>/pillar2.md`** (or `pillar2-ny-pm.md`):

```markdown
---
phase: pre_session_ny_am
graded_at: <gates.session.timestamp_et>
---

# Pillar 2 — Price Action Quality

## Range
<cite>

## HTF Displacement
<cite>

## m5 / m15 Anatomy
<cites>

## Verdict
- pillar2: good | marginal | poor
- override_reason: <if you overrode the heuristic, why>
```

### Chat output (after writing files)

Three to five lines: cited HTF bias + primary draw + Pillar 2 verdict + countdown to next phase. End with: `Saved state/session/<date>/{pillar1.md, pillar2.md}. Idle until <next killzone> (in <minutes>m).`

---

## Phase: Open reaction (NY AM or NY PM)

**Goal:** watch the first 15 minutes of NY's reaction to overnight levels. Build the LTF bias picture. By minute 14, finalize.

**Required reads first:**
- `state/session/<date>/pillar1.md` and `pillar2.md` (must exist; if missing, that's a Pillar 1+2 prereq error — say so and run pre-session work first).
- `state/session/<date>/open-reaction.md` if it exists (we're updating it).

**The work:**

Read `gates.pillar3.last_bar`, `gates.pillar2.m5.last_bar`, `gates.pillar2.m15.last_bar`. Read the recent untaken levels from `gates.pillar1.untaken_*`. What's price doing relative to those levels? Is NY breaking the overnight high or low? Holding above or rejecting?

Strategy §2.3:
- Break + rejection in direction of HTF draw → LTF aligns with HTF (A+ potential later).
- Break + continuation against HTF draw → "today is a retrace day" — bias may stay HTF or flip intraday.

### Update `open-reaction.md`

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

### If minutes_into_phase >= 14, ALSO finalize `ltf-bias.md`

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
- `state/session/<date>/pillar1.md`
- `state/session/<date>/pillar2.md`
- `state/session/<date>/ltf-bias.md`
- `state/session/<date>/setups.jsonl` (if it exists — read recent entries to avoid re-flagging the same setup)
- `state/session/<date>/bars.jsonl` (tail — last ~10 entries for recent context)

If any of pillar1/pillar2/ltf-bias is missing, that's a phase error — the open-reaction work didn't complete. Say so and skip entry hunt.

**For each new bar (1m close, and 5m close when `gates.pillar3.last_bar.time % 300 == 0`):**

1. Append the bar facts to `state/session/<date>/bars.jsonl`:

```jsonl
{"time": <bar_time>, "tf": "1m", "o": <open>, "h": <high>, "l": <low>, "c": <close>, "body_ratio": <bratio>, "direction": "<dir>", "close_position_in_range": <cp>}
```

(Use the bundle's `gates.pillar3.last_bar.*` fields. Write `tf: "5m"` and a separate line to `bars-5m.jsonl` when at a 5m boundary.)

2. **Reason about entry-model candidates.** Read `gates.pillar3.most_recent_structure`, `gates.price_context.wick_tapped_boxes`, `gates.pillar3.fvg_by_type_above/below`. Combined with prior LTF bias:

   - **MSS** — when a sweep just happened (recent ST_LL/ST_HH at high `x`), then displacement back the other way, followed by retrace into the freshly-created FVG.
   - **Trend** — HTF + LTF both aligned, pullback into an internal FVG matching bias direction.
   - **Inversion** — opposing-direction FVG just got violated by a strong close (e.g. bullish close above a bearish FVG); now watching for the inversion retest.

3. **If a candidate is forming or has fired**, append to `state/session/<date>/setups.jsonl`:

```jsonl
{"ts": "<iso>", "bar_time": <t>, "tf": "1m", "model": "MSS|Trend|Inversion", "status": "waiting|candidate|confirmed|invalidated", "side": "long|short", "rationale": "<one line with cites>", "fvg": {"high": <h>, "low": <l>, "direction": "<bullish_fvg|...>"}, "confirmation_bar": {"close": <c>, "body_ratio": <br>, "direction": "<d>"} | null}
```

### Chat output

**Default (no setup):** ONE line. Format:
`<phase>:<min>m  bar=<bar_time> body=<br> dir=<dir> | no setup (last_bar at <close>, in <list-or-none> FVGs)`

**Setup forming (status=waiting or candidate):** TWO to THREE lines. Cite the FVG; note the model; say what would confirm.

**Setup CONFIRMED:** the longer prose+JSON read. Use the structured block from the "Examples" section below. Cite entry, stop (structural invalidation), TP1 (local liquidity), TP2 (HTF draw if supported). Include the model walk per `docs/strategy/entry-models.md`.

---

## Phase: Post-session (NY AM or NY PM)

**Goal:** write a one-paragraph wrap, then idle.

**The work:**
- If `state/session/<date>/htf-summary.md` already covers this phase (check frontmatter), output "Already wrapped." and stop.
- Else: read pillar1.md, pillar2.md, ltf-bias.md, setups.jsonl. Write a synthesis to `htf-summary.md`:

```markdown
---
date: <YYYY-MM-DD>
wrapped_at: <timestamp>
covered_phases: [pre_session_ny_am, open_reaction_ny_am, entry_hunt_ny_am, post_ny_am]
---

# Session Summary

## Bias picture
<one paragraph synthesizing P1 + P2 + LTF bias>

## What happened
<one paragraph: did setups fire, did they confirm, what's the day's narrative>

## Open questions / what to watch next session
<one or two bullets>
```

### Chat output

The single-paragraph wrap. Then say what's next ("Idle until NY PM at 13:00 ET" / "Idle until tomorrow's London Open").

---

## Phase: London Open, Inter-session, Closed

**Goal:** light-weight one-line status, no state writes. The system is intentionally session-focused (NY AM + NY PM). London Open is a context-build window if you want it — for now treat as a one-shot grade similar to pre-session NY AM (write a `pillar1-london.md` if doing the optional London grade). Default: just say "Outside NY sessions — no work" plus current phase + countdown.

---

## ICT vocabulary (re-read each invocation; small enough to keep in context)

- **Market-structure labels (ST/IT/LT × HH/HL/LH/LL)** — the ICT Anchored Market Structures indicator names a pivot `[type][modifier]`: the FIRST letter is the pivot **type** (`H`igh or `L`ow); the SECOND is whether it is `H`igher or `L`ower than the previous pivot of that same type.
  - `HH` = swing **high**, higher than the prior high (Higher High)
  - `HL` = swing **high**, lower than the prior high (**Lower High**)
  - `LH` = swing **low**, higher than the prior low (**Higher Low**)
  - `LL` = swing **low**, lower than the prior low (Lower Low)
  - `HH` and `HL` are both swing **highs**; `LH` and `LL` are both swing **lows**. This is the REVERSE of the textbook letter order (textbook: HL=Higher Low, LH=Lower High). Reading it the textbook way inverts every structure call — a downtrend (lower highs + lower lows = `HL` + `LL`) would look like contradictory noise. Verified empirically against the live indicator 2026-05-20.
- **HTF / LTF** — higher TF (Daily / 4H / 1H) sets bias; LTF (15m / 5m / 1m) triggers.
- **Liquidity** — stop pools above swing highs (buy-side) or below swing lows (sell-side).
- **PDH / PDL** — previous day's high / low.
- **FVG** — 3-bar imbalance. Pine box. Acts as retracement target.
- **BPR** — Balanced Price Range. Overlapping bullish + bearish FVGs.
- **Order block** — last opposing candle before strong displacement.
- **Mitigation** — price returning to an FVG / OB.
- **Inversion FVG** — bearish FVG violated bullishly (or vice versa) — flipped polarity.
- **Killzone** — institutional flow window (London Open, NY AM, NY PM).
- **CE** — Consequent Encroachment, FVG midpoint.
- **Displacement** — wide-range directional move creating an FVG.
- **Sweep / liquidity raid** — wick beyond a swing reversing.
- **MSS** — Market Structure Shift; break of internal structure in the opposite direction.
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
3. Violation — 5m green candle closes well above the top of the bearish FVG. ✓
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

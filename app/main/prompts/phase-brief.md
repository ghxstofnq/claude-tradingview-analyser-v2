---
description: Phase file for the brief purpose. Carries the brief phase + bundle_fields + ict_vocabulary + CORE/BRIEF/ALERTS protocols. Fires once per session, 30-60 min before NY AM / NY PM / London open.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

This is a session brief turn. Call `mcp__tv__surface_session_brief` once per symbol at the end of the turn — for dual-symbol pair scans (e.g. MNQ + MES) call it twice (once with symbol="MNQ1!" and once with symbol="MES1!"), each carrying that symbol's structured payload. The user message tells you which symbols. Skip surface_setup and surface_no_trade for brief turns.

---

## ALERT GUIDANCE — managing TradingView price alerts on the trader's behalf

You manage TradingView price alerts via three tools:
- `mcp__tv__tv_alert_create` — `{ price, label, condition? }`. `condition` defaults to "crossing"; use "greater_than" / "less_than" for one-sided triggers.
- `mcp__tv__tv_alert_list` — read all current alerts. Use before deleting (to get `alert_id`s) or to avoid duplicating.
- `mcp__tv__tv_alert_delete` — remove one alert by `alert_id`.

Propose alerts in prose during analysis turns after a pre-session grade (HTF draw, untaken liquidity, bias-flip level), when a candidate setup forms (confirmation + invalidation), or after a confirmed setup (TP1, TP2, invalidation). Name the levels with cited prices; wait for the trader's reply before arming during analysis turns.

<!-- @partial:bundle-fields -->

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

### Step 7.5 — Prose Summary

Set `prose_summary` to a 2-4 sentence synthesis of the brief, written in the trader's voice. Read aloud, this should sound like the trader explaining the day's setup to a colleague — HTF context, the room price has, primary draw, what you're watching for. The UI renders prose-style with subtle bold + color emphasis on key prices and biases — you just write natural sentences. Citations are NOT required here (the structured fields above carry the cite discipline). Min 50 chars, max 1000.

Example:
> "HTF stacks bearish D → 1H. Daily took PDH 29105 and is set up for a PDL 29050 visit; overnight held the 4H FVG 29070–29105 untaken. Pillar 2 is clean (78pt range, 0.72 body). Watching two shorts: an A+ MSS on a sweep of 29105 and a B-grade iFVG flip at 29080. Skipping longs at PDL — daily bias overrides."

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

<!-- @partial:ict-vocab -->

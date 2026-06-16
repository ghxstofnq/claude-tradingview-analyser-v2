# HTF Target Model — Multi-Source TP1/TP2 Selection

**Date:** 2026-06-15
**Status:** design — pending user review

## Problem

The deterministic chain's target pool ([app/main/strategy/walkers/execution-packet.js](../../../app/main/strategy/walkers/execution-packet.js) `targetPool`) only holds:
- the brief's untaken **session levels** above/below (PDH/PWH/AS/LO/NYAM…), and
- **current-TF (1m) unswept swing highs/lows** from the bridge's structural pool.

It has no path for **HTF (1H/4H) swings**, no path for **opposing-FVG fills**, and no fallback when price is in **discovery (at/near/above all-time highs)** with no overhead liquidity. So TP2 — "at or toward the HTF draw" (§7 Step 7) — can't actually reach an HTF draw.

**Concrete failure (today's backtest, run `20260615-205627-am-2026-06-15`):** A+ Inversion long, entry 30727.75, stop 30688.75. `untaken_above` held only LO.H @ 30645 (below entry → filtered out), so the only valid upside target was a 1m swing at 30800 → `tp1 == tp2 == 30800`. The real runner — the **4H swing high at 30896** — was never a candidate.

## Strategy authority

- **§7 Step 7** + **entry-models.md** (MSS §6, Trend §5): "Take profits first at intraday liquidity, second at or toward HTF draw." Example: "TP1 at the last internal high, TP2 at London high, runner toward prior day high / HTF buy-side." → the intraday→HTF two-tier core.
- **§2.1** ("HTF = Fair Value Gaps + Buy/Sell-side liquidity"; "a large 4H FVG/BPR above or below" is the main draw) + **§3.7** ("the same logic on 1m/5m is how he picks 4H/Daily gaps") → HTF swings **and** HTF FVG fills are legitimate draws/targets.
- CE / midpoint is a documented ICT reference throughout entry-models.md.

**Gap flagged (constraint #11):** the **psych round-level / price-discovery** tier is **not** in the strategy docs — the docs are silent on all-time-highs / price discovery. Adopted here as a **user ruling (2026-06-15)**, documented as an extension of the written strategy.

## Design — unified candidate pool, tiered TP1/TP2

For a **long** (mirror every "above / high / bearish" for a short).

### Candidate sources

| Tier | Source | Produces | Filter |
|---|---|---|---|
| **1 — intraday** | 1m internal swing highs (`pillar3.structuralStops`, kind `swing_high`); session levels (`pillar1.untakenTargets.above`) | the level price | unswept / untaken only |
| **2 — HTF draw** | 1H + 4H swing highs (`engine_by_tf.h1/h4` structures, `is_high`) | the swing price | unswept only |
| **2 — HTF draw** | opposing **bearish** 1H/4H FVGs above price (`engine_by_tf.h1/h4.fvgs`, `dir=bear`) | **3 candidate prices per gap: near edge (proximal), CE (midpoint), far edge (distal/full fill)** | unfilled only |
| **3 — price discovery** | psych round levels on a per-instrument grid (below) | grid prices above entry | **only when Tiers 1–2 produce no valid target** |

Each candidate: `{ price, source, tf?, edge?, target_class, rMultiple }`, where `rMultiple = |target − entry| / |entry − stop|`.

### Per-instrument psych grid (new config)

Mirrors the existing per-symbol pattern (sizing table / pillar2-thresholds). Uncalibrated symbols emit **no** psych fallback (like `range_acceptable: null`).

| Symbol | minor (TP1 grid) | major (TP2 grid) |
|---|---|---|
| `MNQ1!` (NQ family) | 50 | 100 |
| `MES1!` (ES family) | 5 | 10 |

### Selection

1. **Build** the pool from Tiers 1–2; map to correct side (`price > entry`); compute `rMultiple`; drop swept swings / taken levels / filled FVGs.
2. **If the pool is empty → Tier 3:** generate psych levels above entry on the symbol's grid.
3. **Sort** by distance from entry (nearest first).
4. **TP1** — nearest candidate clearing the floor, **intraday preferred**: nearest unswept **swing ≥ ~2R**, else nearest **level / HTF target ≥ ~1.5R**; weekly draw (PWH/PWL) excluded from TP1 (always a runner). If TP1 is an **opposing FVG**, pick the edge by the distance rule (step 6). Tier-3: nearest **minor** grid level clearing the floor.
5. **TP2** — nearest candidate **beyond TP1**, preferring the **HTF draw** (1H/4H swing, opposing-FVG **far edge / full fill**, daily/weekly level). If TP1 came from an FVG's near/CE edge, **TP2 = that same FVG's far edge** (partial → full fill off one gap). Tier-3: nearest **major** grid level beyond TP1. Must clear a runner R and sit strictly beyond TP1.
6. **FVG edge rule (distance / R:R):** for each opposing gap the active edge **deepens as price closes in** — far → near edge, closer → CE, very close → far edge — implemented as *"the shallowest edge that still clears the role's R floor"* (TP1 floor for TP1, runner R for TP2). This is R-driven; distance falls out of it.

### Guardrails (unchanged + new)

- TP1 ≥ ~1.5R (swing ≥ ~2R); **TP2 strictly beyond TP1** — no trivially-close target just because a level/edge sits right above entry.
- Swept swings, taken levels, filled FVGs never enter the pool.
- Reuse the **existing R-floors**; no new magic numbers (open question if the user wants a specific minimum R for the FVG-edge escalation).

## Data threading (implementation note)

`buildExecutionPacketForWalker` reads `context.pillar3` (current TF) + `context.pillar1.untakenTargets`. It must additionally see **HTF swings + opposing HTF FVGs**. Source: `bundle.engine_by_tf.h1/h4.{structures,fvgs}`. `buildStrategyContext` / `bridgeEngineEvidence` will surface these into a new `context.htfTargets` (swings + opposing FVG edges, pre-filtered unswept/unfilled, side-agnostic — the packet builder filters by entry side). The full multi-TF bundle already carries `engine_by_tf`; the slim/poll bundle does not — so this is HTF-context-dependent the same way the brief's untaken levels already are (fed at packet-build from the captured bundle).

## Scope & impact

- **Shared code:** `execution-packet.js` drives **both live and backtest** (one brain). This changes live trade targets *and* backtest results.
- **Owned here** (not the backtest engine/grader — those stay untouched).
- **Out of scope:** entries, stops, grading, confirmation; the entry models themselves.

## Testing

- Unit tests on the new pure functions: pool build per tier, side filter, R-multiple, FVG-edge escalation (far/CE/near by R), per-symbol psych grid (MNQ 50/100, MES 5/10, uncalibrated → none), TP1/TP2 assignment across mixed sources, TP2-beyond-TP1 invariant.
- **Regression:** re-fold today's AM tape — the 4H swing high (~30896) must now appear as TP2 (or the opposing-FVG fill, whichever is the nearer HTF draw beyond TP1). Run the replay corpus + day tapes; any changed expectation needs hand-sign-off (these gate live behavior).
- `npm run smoke:fixtures` unaffected (no analyze-bundle shape change), but verify.

## Open questions for the user

1. A specific **minimum R** for the FVG-edge escalation, or reuse the existing 1.5R/2R floors? (Default: reuse.)
2. When **both** an HTF swing and an opposing-FVG fill sit beyond TP1 at similar distance, which wins TP2 — nearest, or a source preference (e.g., FVG full-fill over a raw swing)? (Default: nearest that clears runner R.)

---

## Addendum (2026-06-15) — pivot to session-level history

Validation against the live engine surfaced two things the original HTF-swing/FVG
plan couldn't handle, and reshaped the design:

1. **The engine's HTF swing/sweep data is not replay-safe.** Read under replay it
   either peeks ahead (marks levels swept using post-session price) or returns
   nothing. So 1H/4H swings + opposing-FVG fills sourced from the engine are
   unreliable in the backtest and break live↔backtest parity. **These are trimmed.**
2. **The user's real draws are session highs/lows, not engine swings.** The level
   that exposed the gap (30896) is the **June 4 NY-PM session high** — which the
   engine only keeps as the *latest* per type, overwriting old ones.

**New primary mechanism: session-level history (`cli/lib/session-levels.js`).**
Compute the untaken high/low of every prior session (Asia/London/NY-AM/NY-PM) from
raw 1H candles, **no-lookahead** (only sessions closed before the test bar; "taken"
recomputed from candles ≤ bar). Untaken highs above price / lows below price feed
the target pool tagged `source:'session_draw'` → **runner (TP2) class** so a nearer
intraday swing keeps TP1. Round-number/price-discovery (psych) levels stay (clean,
computed). The candles respect the replay clock, so this is honest in the backtest.

**Status:** wired into the **backtest** (capture 1H at the replay anchor, merge into
`untaken_targets`); proven on the 2026-06-15 AM replay (TP1 30800 intraday → TP2
30896 June-4 PM, no-lookahead). **Live wiring deferred** to a follow-up — it needs a
periodic 1H raw-bar capture + cache and must be verified during a live session.

**Trimmed:** `htf-targets.js` (engine swing/FVG extraction), `context.pillar1.htfTargets`,
the `htf_engine_by_tf` threading. Phase 2 (optional): rebuild opposing-FVG-fill
targets the same no-lookahead way (from candles, not the engine).

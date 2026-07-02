# Grading-group levers (audit C2–C6, C10) — 2026-07-02

The audit's grading-faithfulness group, implemented behind **default-off** `GOFNQ_` levers so each is fold-attributable and zero-risk to current behavior. Every ruling was derived from the canonical strategy docs + class transcripts (not the retired callout files) and cited before any code was written. **Defaults stay OFF pending a full-corpus fold** — enable them only after you've folded the full 234-session corpus and hand-graded the sessions each lever moves.

## Rulings (grounded, cited)

The grounding pass found the audit's framing **overstated** on several findings; the shipped levers are narrower and spec-faithful.

| ID | Lever flag | Lanto ruling (cite) | What the lever does |
|----|-----------|---------------------|---------------------|
| C5 | `GOFNQ_D5_ELEVATION_RESPECTS_CAP` | daily-bias.md §1: a 2/3-bias day IS A+-elevatable via a "two-and-one" entry — but only on an **already-aligned** day ("elevate only an already-aligned day"). | The 2/3→A+ multi-alignment elevation now respects a **divergence** cap (it still lifts the bias-count cap). An aligned 2/3 day stays A+ (02-09 preserved); a divergent/retrace 2/3 day is held at B — matching the 3/3 path. |
| C6 | `GOFNQ_LEGACY_GRADE_B_CAP` | daily-bias.md §1: A+ comes from a verified 3/3 count OR a two-and-one; "a single clean strongly-displaced entry is good but NOT an A+ elevator." | The legacy fallback (no nested count, no overnight vote) can establish neither A+ path, so it caps at B instead of awarding A+ from a displacement proxy. |
| C3 | `GOFNQ_MIN_STOP_BAND` | risk-and-management.md "Stops (structural)": the stop sits at a real invalidation level (FVG low / MSS low), not a near pivot. | Blocks a packet whose structural anchor is < 0.35×ATR from entry (a noise-level micro-pivot → absurd R:R). Volatility-relative, not a fixed point band. |
| C4 | `GOFNQ_WIDE_STOP_CAP_ALL_MODELS` | risk-and-management.md per-model stops anchor near the entry zone; only Inversion's "failed-leg extreme" is inherently wide. | Extends the Inversion wide-leg cap (5×ATR) as a backstop to MSS/Trend/generic: if the stop is wider than the cap, prefer the nearest valid same-side anchor. |
| C2 | `GOFNQ_MSS_KILL_ANCHOR_SWEPT_LOW` | entry-models.md MSS §4: premise dies only when price makes a **new low** (closes back through the grab); §6 anchors invalidation at the FVG edge. | For a swing-grab MSS (`source='swept_swing'`), anchors the dead-premise kill on the FVG protective edge instead of the broken lower-high — so the walker survives the normal retrace and dies only if price closes beyond the FVG. |
| C10 | — (no lever) | daily-bias.md: an unreacted draw is a destination; the path toward it is the bias (below-price draw = bearish). | **Already fixed on origin/main** by the 2026-06-11/06-12 `biasFromDraw` precedence work (reaction → position-toward-zone → dir). The audit finding predates it. Flagged for your confirmation; no lever shipped. |

## Fold results (available corpus)

**Caveat first:** the full 234-session backtest corpus is not on disk (gitignored `state/backtest` is empty). The fold ran over what's available without re-recording (which would require driving TV replay against the live chart): **6 hand-verified day-tapes + 3 recent live sessions**. This measures **safety** (no oracle regression), not net value.

Default-off inert check: full suite **1631 pass / 0 fail / 6 skip** (= origin/main baseline); tape gate **6/6 green** with all flags off.

Per-lever, flags-on:

| Lever | Verified tapes (6) | Live sessions (3) |
|-------|--------------------|-------------------|
| C5 | inert — 6/6 pass (02-09 A+ preserved; bites only on divergent 2/3 days, none present) | 0R → 0R (all no-trade) |
| C6 | changes **only** the synthetic MSS fixture (legacy path); 5/5 real tapes pass | 0R → 0R |
| C3 | inert — 6/6 pass (no sub-0.35-ATR micro-stop packet present) | 0R → 0R |
| C4 | inert — 6/6 pass (no >5-ATR non-inversion stop present) | 0R → 0R |
| C2 | inert — 6/6 pass | 0R → 0R (no spurious trade created) |

**Interpretation:** on the available corpus the levers are almost entirely inert — they preserve every oracle-verified grade and don't fire on the quiet live sessions. That proves **safety** but the corpus is too small/quiet to exercise the conditions each lever targets (a divergent 2/3 day, a micro-stop, a wide non-inversion stop, a swing-grab retrace). The June 9/11 micro-pivots and divergent days that motivated the findings are not in these 6 tapes.

## Recommendation

- Levers are safe to keep default-off in the tree.
- Before enabling any default-on: **re-record the full corpus and fold each lever old-vs-new** (`node scripts/fold-pillar1.mjs` reads `state/backtest`, run with the flag off then on). Enable a lever only if the full-corpus fold shows it net-neutral-or-positive AND you've hand-graded the sessions it moves against Lanto.
- If you enable **C6**, update/re-grade the synthetic `0001-synthetic-mss-long` tape (it uses the legacy path C6 caps).
- **C10** needs only your confirmation that the shipped `biasFromDraw` is already correct.

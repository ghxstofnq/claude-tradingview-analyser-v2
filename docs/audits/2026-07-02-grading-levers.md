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

## Fold #2 — fresh oracle corpus (PR #188), MNQ + MES

After the initial write-up, the fresh-oracle corpus from PR #188 (`tests/tapes/fresh-oracle/`, 22 capture-only tapes = 11 dates × MNQ + MES, 01-29 → 06-25) was folded via `scripts/inspect-fresh-oracle-tapes.mjs` (rebuilds the deterministic brief context from each tape's anchor bundle, then folds the truth fn — env-flag-aware). Baseline (flags off) produces ~13 setups across both instruments. Each lever off-vs-on:

| Lever | Sessions changed (of 22) | Detail |
|-------|--------------------------|--------|
| **C5** `GOFNQ_D5_ELEVATION_RESPECTS_CAP` | **1** | **02-09 MNQ**: `A+ Trend long → tp2_hit (+8.12R)` demotes to `B Trend long → tp1_hit (+2.35R)` — **−5.77R on that session** |
| C6 `GOFNQ_LEGACY_GRADE_B_CAP` | 0 | inert — every fresh-oracle fold uses the nested-count path, never the legacy fallback |
| C3 `GOFNQ_MIN_STOP_BAND` | 0 | inert — no setup has a < 0.35×ATR micro-pivot stop |
| C4 `GOFNQ_WIDE_STOP_CAP_ALL_MODELS` | 0 | inert — no non-inversion setup has a > 5×ATR stop |
| C2 `GOFNQ_MSS_KILL_ANCHOR_SWEPT_LOW` | 0 | inert — the one MSS setup (06-16 MNQ) isn't a swing-grab fallback |

**The C5 case, and the judgment it needs (yours, not mine):**
- 02-09 MNQ in the fresh capture is classified **divergent** (`htf_ltf_alignment=divergent`, `is_retrace_day=true`, `grade_cap=B`), yet the current code grades it **A+** via the elevation bypass. C5 makes the elevation respect the divergence cap → **B**. That demotion is exactly what daily-bias.md §1 requires ("elevate only an already-aligned day").
- C5 correctly **spares** 06-25 MES (`aligned`, `grade_cap=A+`) — it stays A+.
- **The tension:** 02-09 is the canonical flagship A+ multi-alignment day (the merged oracle, PR #177). But this fresh capture resolves 02-09 as *divergent*. So C5's demotion is correct *given the divergent input* — the real question is whether the fresh capture / open-reaction resolver is right to call 02-09 divergent, or whether it mis-graded a day the oracle says is aligned A+. (The old verified 02-09 tape resolved `aligned`; the fresh capture resolves `divergent` — same date, different captures.) That is a grading-discretion call for you.

**Net:** on real MNQ+MES data, only C5 is live, and it costs R on the single session it touches by grading a divergent day more conservatively. C2/C3/C4/C6 remain unexercised (their target conditions aren't present in this corpus either). The corpus is still 22 NY-AM sessions, not the full 234-session year — the value read remains directional.

## Decision (2026-07-02): C5 enabled default-on; 02-09 = A+ (aligned)

User ruling: **C5 is correct as a rule, AND 02-09 = A+** — the old verified tape's aligned→A+ fold is the true read. These are consistent only if 02-09 is *aligned*, which means the fresh capture's *divergent* classification is the defect, not C5.

- **C5 `GOFNQ_D5_ELEVATION_RESPECTS_CAP` is DEFAULT-ON** (opt out with `=0`). Implemented as a **divergence gate** (not a blunt `capGrade`): the two-and-one still lifts the *bias-count* 2/3→B cap on a plain 2/3 day, and is held at B only when `htf_ltf_alignment=divergent` or `is_retrace_day=true`. This preserves the legitimate bias-count elevation (the `derive-grade-nested` unit cases). C5 is behaving correctly.
- **Root cause of the 02-09 conflict (upstream of C5 — the known "engine HTF over-read" gap):** the fresh 02-09 capture has `htf_bias_dir=bullish` but `h4_struct_dir=bearish` and a bull-FVG primary draw *below* price (a bearish magnet). The open-reaction resolver weights the bearish structure and marks the day **divergent** / `is_retrace_day`, so under C5 it folds to B — even though the bias and the open-reaction direction (rejection at LO.L = bullish) both read bullish. The oracle + old verified tape read it aligned → A+. Lanto reads near-price arrays + reaction (bullish), not structure (see the `engine-htf-overread` memory).
- The `fresh-oracle-02-09-multi-align` test now **locks the multi-alignment ENTRY** (Trend long, e=25632 / st=25604.5 / tp1=25696.75, window 09:54–09:56 — both readings agree) and **does NOT assert the grade**, which rides on the HTF-over-read calibration. The aligned/A+ old verified tape (`tests/tapes/2026-02-09-ny-am-replay.tape.json`, which C5 doesn't touch) remains 02-09's grade authority.
- **Open follow-up (fold-gated):** to make the fresh capture read 02-09 as aligned/A+ with C5 on, the HTF/open-reaction resolver must weight near-price arrays + reaction over h4 structure on a bias-vs-structure conflict day. That is a strategy-calibration change affecting other sessions — needs its own derivation + full-corpus fold, not shipped here.
- C2/C3/C4/C6 remain **default-off** pending a full-corpus fold.

## HTF over-read lever (`GOFNQ_HTF_ARRAY_OVER_STRUCT`, default-off) — NOT enable-ready

The 02-09 divergent misclassification was traced to the `GOFNQ_HTF_STRUCT_ALIGN` gate (live-ltf-resolver.js): it demotes to divergent when the LTF bias doesn't agree with **both** h4 and h1 *structure*. On 02-09: ltf_bias=bullish, h1=bullish, **h4=bearish** → divergent. That is the engine-HTF-over-read: h4 structure vetoing a bias the near-price arrays + reaction support.

New default-off lever `GOFNQ_HTF_ARRAY_OVER_STRUCT`: when the resolved LTF bias AGREES with the near-price/reaction HTF read (`ltf_bias === htfBias`), h4/h1 structure does NOT veto it to divergent.

**Grounding (transcripts):** the core rule is **clearly Lanto-faithful** — he forms HTF bias from FVG/liquidity arrays + the reject/invert reaction, never from h4/h1 MSS/BoS structure (How-I-Develop-Daily-Bias: BIAS 00:56 "mark out fair value gap… liquidity — that's it"; 11:14/25:44 "reject or invert will dictate my narrative"; 20:33 "it's the reaction"; structure appears only as reaction *confirmation*, BIAS 28:38). The 06-18 oracle even labels the opposing bearish read a "structure over-read." Caveat: "array *always* wins" over-reaches — Lanto still lets strongly-directional prevailing displacement / overnight override a lone array (BIAS 34:38, 30:39).

**Fold over the fresh-oracle MNQ+MES corpus (off → on), 4/22 sessions change:**

| Session | OFF (baseline) | ON | Verdict |
|---------|----------------|-----|---------|
| 02-09 MNQ | B Trend long → tp1 (+2.35R) | **A+ Trend long → tp2 (+8.12R)** | ✅ correct (the target fix) |
| 06-18 MNQ | B Trend long → tp1 (**+3.05R**) | B **Inversion** long → stop (**−1R**) | ❌ **regresses the verified oracle** (06-18 = Trend long, aligned, B, user-approved 2026-06-29) |
| 01-29 MES | no-trade (divergent) | no-trade (open_unclear) | label only |
| 06-17 MNQ | no-trade (divergent) | no-trade (clean) | label only |

Net +1.72R on the corpus, **but** the lever is **not grade-only** — flipping alignment also flips `is_retrace_day` / `entry_model_priority`, which on 06-18 changes the fired MODEL (Trend → Inversion) and breaks the verified oracle. **So it is NOT enable-ready as-is.** To ship it, it must be narrowed so the alignment fix does not alter trade selection (Trend↔Inversion), then re-folded (ideally full-year, since it weakens the full-year-validated HTF_STRUCT_ALIGN). Kept **default-off** pending that work + your call.

## Recommendation

- Levers are safe to keep default-off in the tree.
- Before enabling any default-on: **re-record the full corpus and fold each lever old-vs-new** (`node scripts/fold-pillar1.mjs` reads `state/backtest`, run with the flag off then on). Enable a lever only if the full-corpus fold shows it net-neutral-or-positive AND you've hand-graded the sessions it moves against Lanto.
- If you enable **C6**, update/re-grade the synthetic `0001-synthetic-mss-long` tape (it uses the legacy path C6 caps).
- **C10** needs only your confirmation that the shipped `biasFromDraw` is already correct.

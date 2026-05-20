# Lessons — live `/analyze` sessions

Lessons from running the LLM-driven session loop (detector → Monitor → phase-aware `/analyze`). Signal + action form: "Signal: X happened. Action: do Y next time."

## 2026-05-20 — NY AM (MNQ)

Outcome: 1 trade taken (B Trend-long) — stopped, ~full loss. 2 valid B Inversion longs missed/mis-graded — each would have run ~+84 pts. A chop day; the stand-aside-in-chop behavior was correct, but Inversion-model execution failed twice.

- **Signal:** A reversal up was driven by price violating/closing above an opposing bearish FVG; I evaluated only the MSS model, never walked Inversion, and called no-trade.
  **Action:** Every bar, walk all three entry models explicitly by name (MSS, Trend, Inversion) and state a verdict for each. Never stop at the first model that doesn't fit.

- **Signal:** I rejected a valid bullish Inversion because price had broken a higher low ("structure broken").
  **Action:** Grade each entry model only on its OWN components. A broken higher low disqualifies the *Trend* model, not the Inversion model — inversions form *during* pullbacks. Never cross-apply one model's rule to another.

- **Signal:** I rejected a setup because the FVG was "only" 13 points.
  **Action:** A small FVG is still tradeable — on MNQ ~13 pts is ~50 ticks, normal. Do not reject a setup for FVG size.

- **Signal:** I used the m5 `candle_quality_heuristic` (a lagging 5-bar average) as a hard veto on a setup whose displacement was clean.
  **Action:** The heuristic is a hint, not a veto. Judge price quality at the setup itself; override the heuristic when you disagree.

- **Signal:** I drifted into assembling multiple reasons to grade setups no-trade — an over-correction from the discipline rules.
  **Action:** Cite-or-reject / no-arithmetic / stand-aside-in-chop exist to stop *forcing* trades, not to reject valid ones. Model components + HTF alignment + confirmation close present → at least a B. Grade it.

- **Signal:** I flagged a confirmed B Trend-long whose entry sat at the top of the FVG, giving ~1:1 R:R to TP1; it lost.
  **Action:** Weight R:R and entry location. An extended entry (far edge of the FVG) giving ~1:1 to the first target is marginal even when the model confirms. Prefer the deeper-retrace fill, or pass.

- **Signal:** Both Inversion misses were caught by the user on review, not in real time.
  **Action:** The strengthened three-model checklist in `.claude/commands/analyze.md` (entry-hunt step 2) is the systemic fix — follow it literally on every bar.

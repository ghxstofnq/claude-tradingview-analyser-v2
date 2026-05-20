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

## 2026-05-20 — NY PM (MNQ)

Outcome: 0 trades — a chop day. Five candidates flagged (2× Trend, 2× MSS, 1× Inversion); all failed to confirm or invalidated. Standing aside was correct. The three-model walk ran cleanly on every bar — no repeat of the AM Inversion tunnel-vision.

- **Signal:** Twice (14:00, 14:24–14:25) a violent single-bar V-shaped sweep+recovery occurred — a big spike through liquidity then a near-full intrabar recovery. Both looked like an MSS reversal forming; neither left a clean fresh FVG and the retrace was too shallow/fast to give a tradeable entry.
  **Action:** A single V-bar sweep is not an MSS entry. The MSS model needs a *displacement leg* (a clear move that breaks a lower high and leaves a 3-bar FVG) AFTER the sweep — not the sweep bar itself. Flag it `candidate` and wait for the leg + a real retrace; if it only V-recovers, there is no entry — don't chase.

- **Signal:** The 14:37 breakout Trend-long retraced into its FVG (29317.5–29330.75); the 14:43 bar then wicked 12 pts *through* the FVG floor to 29305.5 before closing back inside. My logged invalidation ("close below 29317.5") never fired, but any structural stop below the FVG was run intrabar.
  **Action:** Judge invalidation on whether a structural stop would have been hit intrabar, not only on a close beyond the level. A deep wick through the FVG floor breaks the clean-pullback premise even without a close beyond it — the setup is dead in practice; don't keep it alive on a close-only technicality.

- **Signal:** The cleanest setup of the PM (the 14:37 breakout: real displacement, range 25 / vol 3587, fresh clean FVG) still did not produce a trade — the pullback went messy.
  **Action:** A clean impulse + clean FVG is necessary but not sufficient. The *pullback* must also be orderly. A correct no-trade on a good-looking setup whose pullback degrades is discipline, not a miss.

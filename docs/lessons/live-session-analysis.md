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

## 2026-06-11 — system (capture pipeline, not a trading session)

- **Signal:** 8 of 13 June briefs graded `no-trade: htf_unclear`, and no live session ever produced a setup. The actual cause was the multi-TF sweep silently recording `engine_by_tf.h4/h1 = null` — a single fixed-delay read racing the indicator's re-render after each TF switch. A data failure was being reported in market-verdict vocabulary, and it cost a week of dead sessions before anyone noticed.
  **Action:** Never let a data-source failure share a label with a market verdict. Verify every TF read against the engine's own `meta.tf` stamp, retry until fresh, fall back to the per-symbol baseline with provenance (`capture_health`), and grade residual gaps `data_gap` — `htf_unclear` is reserved for a healthy capture with genuinely unclear structure.

- **Signal:** After the mode tabs became popovers, live mode only flipped via a manual `detector:start` click; the detector heartbeat died June 8 and the health pill showed "down" with nobody watching. Briefs and wraps kept writing on their own schedulers, so the system looked alive while the entire live chain (open reaction → entry hunt → setups) silently never ran.
  **Action:** Any process the strategy depends on must be supervised against the trading schedule, not UI state: auto-arm at session open, restart on stale heartbeat (a hung process never fires an exit event), run the fail-closed readiness check before the open, and push a native notification when blocked. A dashboard indicator is not an alert.

- **Signal:** The replay accuracy harness existed (`npm run replay`, 12 cases incl. one real A+ day) but was a manual script — a detector regression would never fail CI. And all cases were single snapshots, while the June failures happened *between* bars and phases: state handoffs, confirmation timing, walker lifecycle.
  **Action:** Two-layer proof, both in `npm test`: (1) the snapshot corpus as a hard gate (zero missed setups / false candidates / wrong model-side-packet); (2) day tapes — record every live bar's exact detector inputs (`walker-inputs.jsonl`), promote good days into frozen tapes, and fold the REAL production truth function over them asserting the whole lifecycle: spawn bar, confirm bar, exact entry/stop/TP, quiet bars stay quiet. If the tape gate is green and a live day still fails, the gap becomes the next tape.

- **Signal:** The walker chain had never produced a packet on real data: it was built and tested against evidence shapes (`gates.engine.rows`, entry-state confirmation rows, `structural_stops`) that the live scan bundle never emits. One afternoon with the first real day-tape (June 9 via `tv record-tape`) surfaced four integration bugs the 700-test unit suite couldn't see: missing rows, index-based zone identity (50+ duplicate walkers), stale engine confirms masking live violations, and micro-pivot junk stops.
  **Action:** Unit tests prove layers; only end-to-end tapes on real data prove the chain. When a layer consumes another layer's output, test against a *captured* sample of that output, not a hand-built ideal. And treat indicator tables as historical records — any "confirmed" flag needs a timestamp check against the current bar before it is evidence for now.

- **Signal:** Six merged PRs (capture fix, supervisor, proof gates, walker bridge, stop fix) never executed in production — the app's checkout sat 20 commits behind origin/main and the running process predated all of them. The wrap diagnosed the dead chain daily (`chain_audit: degraded:missing_setups`) into a file nobody read; nothing in the UI said what code was running.
  **Action:** Merged is not deployed. The topbar VER chip now shows the running SHA, flips red RESTART when the code on disk moves past the boot SHA, amber PULL when origin/main is ahead; REVIEW surfaces chain_audit degradations as a red strip. After merging: pull, restart, check the chip.

- **Signal:** Three setup producers coexisted in the live loop — the walker chain, the old `cli/lib/setup-detector.js` candidate injected into the per-bar LLM turn ("trust the detector"), and a dead third engine (`runWalkerTickFor`) that was never called. When the two live brains disagreed, the surface validators threw at the model, and a trailing LLM no-trade could wipe the walker's setup off the screen 60s later. Separately, `buildDetectorInputs` read an undefined `session` variable — the ReferenceError was swallowed by a bare catch, leaving untaken_targets empty, which would have blocked every live packet on `missing_side_consistent_tp1`.
  **Action:** One producer per artifact: the chain surfaces, the LLM narrates (deterministic extraction → LLM synthesis, per the research). Never wrap context loads in bare `catch {}` — a swallowed ReferenceError reads as "no brief today". The backtest must run the same brain as live (record tape → fold the real truth fn → grade from bars), never a parallel implementation: the old engine passed a `bundle` argument `userTurn` doesn't accept and graded outcomes off a field that doesn't exist in the bundle, so no run ever completed — and no test noticed because the engine was only ever tested against mocks shaped like its own assumptions.

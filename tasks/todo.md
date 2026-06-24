# Todo — Validate the faithful-Lanto chain → live on Tradovate demo

Branch: `feat/faithful-lanto-rebuild`. See `tasks/plan.md` / `~/.claude/plans/mellow-frolicking-chipmunk.md`.
Strict gate first: no live session until Stage G passes. Live = armed auto-fire on demo, autonomous, monitored.

## Phase 0 — Smoke the harness
- [ ] 0.1 Inventory salvageable recorded inputs for the oracle dates (state/, run dirs)
- [ ] 0.2 Fold the existing 06-09 tape through the real chain; diff vs oracle D2
- [ ] 0.3 Fold any salvaged live sessions (fold-live-corpus); no crashes / sane block-reasons

## Phase 1 — Stage G: record + fold the oracle sessions (GATE)
- [ ] 1.1 06-09 (A+ Inversion short) — record/reuse → fold → compare → promote+verify
- [ ] 1.2 02-09 (A+ multi-align long) — record → fold → compare → promote+verify
- [ ] 1.3 12-12 (2/3-B short, MES) — record → fold → compare → promote+verify
- [ ] 1.4 10-02 (B long→flip, MNQ) — record → fold → compare → promote+verify
- [ ] 1.5 06-16 (B short) — record/reuse → fold → compare → promote+verify
- [ ] 1.6 06-17 (no-trade) — record/reuse → fold → compare → promote+verify
- [ ] 1.7 06-18 (marginal B long) — record/reuse → fold → compare → promote+verify
- [ ] **✅ CHECKPOINT G** — all oracle sessions match Lanto; `npm run tapes` + `npm test` green — user reviews

## Phase 2 — Chain fixes (looped with Phase 1)
- [ ] Per divergence: failing test → coherent fix → re-fold → full suite green → note in decisions ledger

## Phase 3 — Stage F: re-point UI to validated outputs
- [ ] 3.1 PREP/LIVE/REVIEW render 3-vote grade, 2×2 models, overnight vote, SMT, near-price draw, no-trim mgmt; no scale-in
- [ ] 3.2 Fix any stale/old-strategy field; re-probe matches chain output

## Phase 4 — Readiness + Tradovate arming (GATE, no orders placed)
- [ ] 4.1 TV Desktop CDP 9225 answers
- [ ] 4.2 Capture health all-fresh for London (Asia + ETH + 30m), MES+MNQ
- [ ] 4.3 live-check --session london clean / known blockers
- [ ] 4.4 Supervisor auto-arms london 03:00 ET; detector heartbeat; deterministic resolver active
- [ ] 4.5 Tradovate demo connected + account confirmed
- [ ] 4.6 automationMode=auto + resume-auto tapped; guardrails $250/$600
- [ ] 4.7 Routing dry-verify (adapter own-host route) — NO order placed
- [ ] **✅ CHECKPOINT R** — readiness green + demo armed — user confirms London target

## Phase 5 — First live demo session (next London)
- [ ] 5.1 Pre-open green; symbol pinned; mode armed
- [ ] 5.2 Background Monitor on bar-close + tail setups/no-trades/fills/logs
- [ ] 5.3 Supervise 03:00–06:00 ET; hot-fix plumbing only (engine owns orders)
- [ ] 5.4 Recap per-trade + defects + fixes
- [ ] **✅ CHECKPOINT (session review)** — traded correctly? triage defects

## Phase 6 — Iterate to fully working
- [ ] Fix Phase-5 defects (TDD + re-fold + re-probe); re-guard the gate; more clean sessions
- [ ] (later, separate gate) real-money path — out of scope here

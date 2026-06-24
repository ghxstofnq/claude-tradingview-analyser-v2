# Todo — Validate the faithful-Lanto chain → live on Tradovate demo

Branch: `feat/faithful-lanto-rebuild`. See `tasks/plan.md` / `~/.claude/plans/mellow-frolicking-chipmunk.md`.
Strict gate first: no live session until Stage G passes. Live = armed auto-fire on demo, autonomous, monitored.

## Phase 0 — Smoke the harness  ✅ DONE
- [x] 0.1 Inventory: NO salvageable inputs — only 06-09 had a tape; all oracle sessions need fresh schema-4 recordings
- [x] 0.2 Folded chain on real data (06-09); helper `scripts/fold-tape.mjs` added
- [x] 0.3 Folded 140-bar live 06-23 session clean (no crashes, sane block-reasons)

## ⚠️ Key finding (2026-06-23): old tapes are STALE (pre-Stage-A levels/prices). Re-record EVERY session on schema 4. The live chart confirms the oracle's levels (AS.L 29595.25, PDL 29113.75) — see [[stale-tape-verify-live-chart]].

## Phase 1 — Stage G: record + fold the oracle sessions (GATE)
- [~] 1.1 06-09 (A+ Inversion short) — RE-RECORDED on schema 4 (stale tape replaced). Chain produces Lanto's exact 10:27 short (entry 29760, TP1 AS.L 29595.25) BUT over-fires ~9 premature shorts first → blocked on Phase 2 fix, then promote+verify
- [ ] 1.2 02-09 (A+ multi-align long) — record → fold → compare → promote+verify
- [ ] 1.3 12-12 (2/3-B short, MES) — record → fold → compare → promote+verify
- [ ] 1.4 10-02 (B long→flip, MNQ) — record → fold → compare → promote+verify
- [ ] 1.5 06-16 (B short) — record/reuse → fold → compare → promote+verify
- [ ] 1.6 06-17 (no-trade) — record/reuse → fold → compare → promote+verify
- [ ] 1.7 06-18 (marginal B long) — record/reuse → fold → compare → promote+verify
- [ ] **✅ CHECKPOINT G** — all oracle sessions match Lanto; `npm run tapes` + `npm test` green — user reviews

## Phase 2 — Chain fixes (ACTIVE — grounded in the Entry Models transcript, not derived docs)
- [ ] 2a Inversion entry gate: only fire on the best-displacement / took-liq gap AFTER a major liquidity grab + reversal displacement, with price trending in the trade direction into the entry (Entry Models 09:21/31:25). Locus: `app/main/strategy/walkers/inversion-lifecycle.js` `findOpposingPdArrays` + spawn gate.
- [ ] 2b TP1 = nearest untaken major-liquidity draw (session/PD), swings only as fallback (Entry Models 10:18–11:15, 25:13). Locus: `app/main/strategy/walkers/execution-packet.js` `targetPool`.
- [ ] 2c TDD each + re-fold 06-09 → expect first packet ≈ 10:27 short, TP1 AS.L 29595.25, A+; full suite green; note in decisions ledger

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

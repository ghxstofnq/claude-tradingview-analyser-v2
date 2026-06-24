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
- [~] 1.5 06-16 (B short, MSS) — label authored, RECORDING in progress (task buphh0aa6); then fold → compare → promote
- [ ] 1.2 02-09 (A+ multi-align long) — author label → record → fold → compare → promote+verify
- [ ] 1.3 12-12 (2/3-B short, MES) — author label → record → fold → compare → promote+verify
- [ ] 1.4 10-02 (B long→flip, MNQ) — author label → record → fold → compare → promote+verify
- [ ] 1.6 06-17 (no-trade) — author label → record → fold → compare → promote+verify
- [ ] 1.7 06-18 (marginal B long) — author label → record → fold → compare → promote+verify
- Labels live in tests/fixtures/real-sessions/<date>-mnq-ny-am-*.label.json (06-09 + 06-16 done; 12-12 is MES). Oracle truth: docs/strategy/lanto-oracle.md Part D.
- [ ] **✅ CHECKPOINT G** — all oracle sessions match Lanto; `npm run tapes` + `npm test` green — user reviews

## Divergence table (chain vs oracle, fresh schema-4 folds)
| Session | Oracle | Chain's correct packet | Premature fires | Gap |
|---|---|---|---|---|
| 06-09 | A+ Inv short, e29731, TP1 AS.L 29595 | 10:27 Inv short e29760, TP1 AS.L 29595 ✓ | 9 premature Inv (09:34→) | inversion over-fire |
| 06-16 | B Reversal short, e30864, TP1 LO.L 30783 | 09:57 **Trend** short e30864 ✓, TP1 ~AS.L 30750 | 3 premature Inv (09:30→) | over-fire + model named Trend not Reversal/MSS |
| 06-17 | **NO-TRADE** (price quality) | — | **12 fired, 11 A+, ALL Inversion** | catastrophic false-positive |
- ALL premature fires are model=Inversion; Trend/MSS entries are CORRECT → the over-fire is localized to the Inversion lifecycle (findOpposingPdArrays spawns on every opposing FVG).
- 06-17 (no-trade) is the smoking gun: 12 Inversion packets (11 A+) where Lanto stands aside. THREE compounding gaps:
  - **A. Inversion over-fire** — the Inversion lifecycle fires on every opposing-FVG violation (primary).
  - **B. Grade rubber-stamps A+** — deriveGrade returns A+ for 11/12 on a no-trade day; no real discrimination.
  - **C. Pillar-2 entry veto misses two-sided chop** — `pillar2PoorAtEntry` (bar-close.js) checks tight-range/doji/weak-disp, NOT the directional-COHERENCE signal Stage B added in `cli/lib/pillar2-verdict.js`. Wire coherence into the entry veto.

## Phase 2 — Chain fixes (grounded in the Entry Models transcript)
GATE INSIGHT (2026-06-23): simple separators DON'T work — zone size_quality is "tiny" for BOTH premature
and real 06-09 zones; and a significant buy-side grab (PDH @09:05) predates the 09:34 premature short, so
"a grab happened" doesn't gate it. The real discriminator (Entry Models 31:25): "price [bearish] all the
way into your entry" — the REVERSAL must be established (recent significant high in, displacement down) AND
the entry is the retrace into the SIGNIFICANT HTF draw array (C→D handoff). Need the full multi-session
pattern before encoding — calibrate across the oracle, don't curve-fit to 06-09.
- [ ] 2a Inversion entry gate: reversal-established + retrace into the primary HTF draw array (not any opposing FVG). Calibrate across sessions. Locus: `inversion-lifecycle.js` + the C→D draw handoff.
- [ ] 2b TP1 is likely NOT broken — the 06-09 10:27 packet already targets AS.L 29595.25; the internal-swing TP1s were an artifact of the premature entry. Re-check after 2a.
- [ ] 2c TDD + re-fold 06-09 → expect first packet ≈ 10:27 short, TP1 AS.L 29595.25; full suite green; note in decisions ledger

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

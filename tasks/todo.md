# Todo — Faithful-Lanto deepening + backtest≡live parity (no live trading in scope)

Branch: `feat/faithful-lanto-rebuild`. Plan: [tasks/plan.md](plan.md). Goal: [docs/intent/2026-06-27-end-goal.md](../docs/intent/2026-06-27-end-goal.md).
Each task carries **acceptance** (done = true when…) and **verify** (how to prove it). Checkpoints are hard, user-reviewed gates.
Tracks run in parallel; only the arrows in the plan's dependency graph are hard blockers.

> **Scope (user, 2026-06-28):** NO live trading in this plan — live London demo, Tradovate arming, and the
> real-money gate are **deferred to a later plan**. This plan = faithfulness deepening + parity + corpus + UI.
>
> **Already done (do not redo):** Stage A–E brain merged; **Stage G complete 2026-06-23** (chain faithful on
> 5 oracle sessions). **3-vote grade (option 2) BUILT + default-on** (`pillar1-bias.js` + nested `deriveGrade`).
> **Near-price draw (gap #4) BUILT.** **Leader/SMT (option 1) corpus-folded + signed off** — adopt displacement
> leader behind `GOFNQ_FAITHFUL_LEADER` (off), demote divergence-SMT to confirmation overlay
> ([spec](../docs/superpowers/specs/2026-06-25-faithful-pair-leader-design.md)). Parity gate standing+green (`npm run parity`).

---

## TRACK 0 — Foundation: paired corpus + oracle (option 4)  ◂ binding constraint; start now

- [ ] **T0.1 — Replay-record paired MNQ+MES sessions (off-session only).** Via `tv record-tape` (single-TF;
      replay poisons live capture, so drive TV only off-session) → a paired tape on disk per session. Re-record
      recordable 2026 NY-AM (+ London) dates (Stage-G method). **Acceptance:** ≥3-4 paired weeks of tapes exist.
      **Verify:** `ls tests/tapes/` count grows; each has MNQ + MES; `npm run tapes` parses them.
- [ ] **T0.2 — Hand-grade each vs Discord + lock the oracle.** Compare bias/grade/model/side/instrument to
      Lanto's Discord call; record in `docs/strategy/lanto-oracle.md`; flip tape `verified:true` only after the
      user confirms. **Acceptance:** oracle grows past 7 sessions, each with a Discord-cited expectation.
      **Verify:** oracle diff reviewed; `npm run tapes` passes the newly-verified tapes.

## A — Parity gate (keeps the folds trustworthy)  ◂ mostly done

- [x] **A1 — Audit DONE (2026-06-27).** walker-inputs BAKE resolved context → valid parity = SAME-CODE dual-runs only.
- [x] **A2 — Standing parity gate DONE.** `make-parity-fixture.mjs` refuses to write unless live==bt; `parity-gate.test.js` re-folds both. Seeded 06-25.
- [ ] **A3 — Expand the parity corpus from EXISTING recordings.** Build fixtures with `npm run parity:add <date>`
      from any past/replay-recorded session that has `walker-inputs.jsonl` on disk (no new live trading).
      **Acceptance:** parity corpus > 1 session. **Verify:** `npm run parity` green on each added fixture.
- [x] **A4 — Wired into CI DONE.** `tests/parity-gate.test.js` in the `npm test` glob; suite green.
- [ ] **✅ CHECKPOINT P** — parity gate standing + green on the recorded corpus. **User reviews.**

## TRACK 2 — Faithful levers (each default-OFF flag, folded old-vs-new, user-approved one at a time)

- [ ] **G1 — Validate the 3-vote grade (option 2; already default-on).** Re-grade the Track-0 oracle under the live
      grade; fold `scripts/fold-pillar1.mjs` (and `fold-live-corpus.mjs`); spot-check vs Discord bias labels.
      **Acceptance:** grades match Lanto's actual calls on the checked sessions; no unexplained regressions; OR a
      tuning need is identified with a fold table. **Verify:** `npm test` (tape+parity gates) + `npm run smoke:fixtures` + the fold report. **◇ user reviews.**
- [ ] **G2a — MSS-significance spawn gate (gap #3).** A valid MSS/Inversion spawn needs significant liquidity +
      matching displacement, not any rejected sweep. Reuse the `pillar1-bias.js` significance logic in the walker
      spawn (`app/main/strategy/walkers/*-lifecycle.js`), behind `GOFNQ_MSS_SIGNIFICANCE=1`. **Acceptance:** premature
      MSS/inversion spawns drop on the chop days without losing the verified A+ days. **Verify:** unit tests on the gate +
      fold old-vs-new on the corpus; verified tapes still pass. **◇ user reviews fold.**
- [ ] **G2b — `join_consecutive` FVG de-noise (option 3).** Merge stacked same-direction FVGs before walker spawn
      (SMC `join_consecutive`), behind a flag. **Acceptance:** duplicate stacked-zone walkers collapse; no verified
      tape regresses. **Verify:** unit test + fold. **◇ user reviews fold.**
- [ ] **G3 — Faithful leader default-on + SMT overlay (option 1).** After ≥3-4 paired weeks (Track 0), fold
      `scripts/fold-pair-leader.mjs` (always-MNQ vs displacement-leader); if it survives, flip `GOFNQ_FAITHFUL_LEADER`
      on; expose divergence-SMT as an optional open-reaction direction confirmation (never the symbol/grade gate);
      add a test asserting the leader pick never alters the Pillar-1 grade. **Acceptance:** leader beats/ties always-MNQ
      across the paired weeks with no worse −3R profile; SMT is overlay-only. **Verify:** fold table + leader-pick unit tests. **◇ user reviews.**
- [ ] **G4 — Pillar-3 MES coverage (the dominant edge limiter).** Audit why MES setups ≠ Lanto's on the MES-led days
      (01-29/06-15/04-06/06-22 from spec §6b); close the entry-model gap so a correct leader converts. **Acceptance:**
      the MES-led oracle days produce the right entry/grade in the fold. **Verify:** fold on the MES tapes + verified-tape gate. **◇ user reviews.**

## TRACK 3 — UI fidelity (transparency mandate)  ◂ parallel
- [x] **B1 — Field→source map DONE (2026-06-27)** ([docs/ui-fidelity-audit.md](../docs/ui-fidelity-audit.md)); one violation fixed (`modelLabel`).
- [ ] **B2 — Re-point any remaining UI-only numbers.** **Acceptance:** no panel field computes a number the bot doesn't read. **Verify:** diff vs the B1 table.
- [ ] **B3 — Probe panel == bot (no computer-use).** Via design-harness/state-file reads, assert rendered value == bot input for grade/bias/draw/setup/stop/TP. **Verify:** probe prints equality per field; mismatch fails.
- [ ] **✅ CHECKPOINT U** — panels mirror the bot's analysis. **User reviews.**

---

## Deferred to a later plan (out of scope here)
Live London demo · Tradovate demo/real arming + order routing + live session supervision · real-money gate.
The end-goal ([docs/intent/2026-06-27-end-goal.md](../docs/intent/2026-06-27-end-goal.md)) still stands —
this plan is its prerequisite (make the chain trustworthy first).

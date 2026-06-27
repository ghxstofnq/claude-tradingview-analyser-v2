# Todo — Validated chain → next-London live demo, parity as the keystone

Branch: `feat/faithful-lanto-rebuild`. Plan: [tasks/plan.md](plan.md). Goal: [docs/intent/2026-06-27-end-goal.md](../docs/intent/2026-06-27-end-goal.md).
Each task carries **acceptance** (done = true when…) and **verify** (how to prove it). Checkpoints are hard, user-reviewed gates.

> **Already done (do not redo):** Stage A–E brain + Tradovate exec engine merged; **Stage G complete 2026-06-23**
> — the deterministic chain is faithful to Lanto on the 5 recordable 2026 oracle sessions (right bias/grade/model/side,
> stands aside on the no-trade day, valid winning entries). Detail in git + `docs/strategy/lanto-oracle.md` + the
> superseded checklist in git history. Parity fixes shipped: pre-open anchor `1459970`, honest labels `fae8449`,
> no-draw 2/3 days `c906e6b`.

---

## Phase A — Parity gate (THE keystone)  ◂ build first; everything trusts it

- [x] **A1 — Audit DONE (2026-06-27).** Mapped the existing pieces (verify-live-parity = one-off htf_fallback; backtest-parity
      = synthetic engine-invariant guards; day-tape = backtest-vs-oracle, the trustworthy current-code instrument). Key
      finding: `walker-inputs.jsonl` BAKES the resolved context, so a raw current-brain fold over OLD recordings = stale
      context, not a parity break (06-18 proof). Valid parity = SAME-CODE dual-runs only. Committed-fixture strategy: slim
      both sides (strip brief-time blocks, verified lossless) into `tests/parity/*.parity.json`.
- [x] **A2 — Standing parity gate DONE (2026-06-27).** `scripts/make-parity-fixture.mjs` folds live `walker-inputs` AND the
      backtest tape, REFUSES to write unless they agree (so a fixture IS a proof), slims losslessly. `tests/parity-gate.test.js`
      re-folds both committed sides and asserts identical packets + frozen expectation. Seeded with 06-25 (3 packets, live==bt,
      17 MB slim). `npm run parity` green; `npm run parity:add <date>` builds more. **Mechanical live==bt agreement — no
      grading needed** (faithfulness stays the day-tape gate's job).
- [ ] **A3 — Expand `verified:true` tapes 6 → corpus** (NEEDS USER LANTO HAND-GRADE — gate prints "hand-grade and flip the flag").
      Separately: grow the parity corpus with `npm run parity:add` from each FUTURE same-code live session (the demo onward).
- [x] **A4 — Wired into CI DONE (2026-06-27).** `tests/parity-gate.test.js` matches the `npm test` glob (`tests/*.test.js`),
      so a parity break fails the suite. Full suite **1564/0**. (Tamper-proof by construction: the builder refuses to create a
      fixture whose sides disagree.)
- [ ] **✅ CHECKPOINT P** — parity gate standing + green; backtest ≡ live on the corpus. **User reviews.** (keystone)

## Phase B — UI fidelity (transparency mandate)  ◂ parallel to A

- [x] **B1 — Field→source map DONE (2026-06-27)** ([docs/ui-fidelity-audit.md](../docs/ui-fidelity-audit.md)).
      Audited PREP · LIVE · REVIEW. **One real violation** (LIVE `modelLabel` ignored the bot's `model_class`) —
      found+fixed (now surfaced + read; +4 tests, suite 1562/0). PREP reads `brief.json` faithfully; REVIEW aggregates
      the bot's per-trade outcomes faithfully. Remaining items are transparent monitoring geometry / bot-field
      fallbacks, documented. (B2 re-point: only `modelLabel` needed it — already done in B1.)
- [ ] **B2 — Re-point violators.** Make each flagged field read the bot's source of truth; delete UI-only computation.
      **Acceptance:** no panel field computes a number the bot doesn't also read. **Verify:** code review of the diff
      against the B1 table; each former violation now reads the cited source.
- [ ] **B3 — Probe panel == bot (no computer-use).** Via the design-harness (Playwright headless) / state-file reads,
      assert the rendered panel value equals the bot's input value for the key fields (grade, bias, primary draw,
      surfaced setup, stop/TP). **Acceptance:** an automated probe passes for those fields on a recorded session.
      **Verify:** the probe script prints panel-value == bot-value per field; any mismatch fails.
- [ ] **✅ CHECKPOINT U** — panels mirror the bot's analysis. **User reviews.**

## Phase C — Live bring-up + Tradovate demo arming (GATE, no orders placed)

- [x] **C0 — deploy-parity arming guard (done 2026-06-27).** The supervisor refuses to cold-arm live when the running
      process is behind its on-disk code (`version-status.restart_needed`) — loud notify, no mode flip, no detector.
      Closes the #1 parity break (06-24 ran stale: 11 inversions live vs 6 backtest). `session-supervisor.js` +
      `electron-main.js`; +4 tests; suite 1559/0.
- [ ] **C1** TV Desktop CDP 9225 answers (`curl -s --max-time 4 http://127.0.0.1:9225/json/version`). *(green 06-24)*
- [ ] **C2** Capture health all-fresh for London (Asia + ETH + 30m), MES + MNQ. **Verify:** `capture_health.ok` both symbols.
- [ ] **C3** `node cli/index.js live-check --session london` clean / only known blockers. **Verify:** parseable, no hard blocks.
- [ ] **C4** Supervisor auto-arms london; detector heartbeat < 120s; deterministic open-reaction resolver active. *(green 06-24)*
- [ ] **C5** Tradovate **demo** connected + account confirmed (the 06-24 blocker — webview logged into Paper/Tradovate).
- [ ] **C6** `automationMode=auto` + resume-auto; guardrails set (per-trade / daily-loss). **Verify:** state shows armed + limits.
- [ ] **C7** Routing **dry-verify** (adapter own-host route resolves) — **NO order placed**. **Verify:** unit/inspection only.
- [ ] **✅ CHECKPOINT R** — readiness green + demo armed. **User confirms the London target.**

## Phase D — First live demo session (next London)

- [ ] **D1** Pre-open green; symbol pinned (PAIR_PRIMARY); mode armed.
- [ ] **D2** Background Monitor on bar-close + tail `setups`/`no-trades`/`fills`/logs.
- [ ] **D3** Supervise the session; hot-fix **plumbing only** (the engine owns orders) — slim-file starvation /
      unknown-session / missing-ltf-bias / symbol-mismatch / capture-wedge / exec-route.
- [ ] **D4** Recap: per-trade (vs what the chain expected) + defects + fixes.
- [ ] **✅ CHECKPOINT S** — traded correctly? triage defects. **User reviews.**

## Phase E — Iterate to clean

- [ ] **E1** Fix Phase-D defects (TDD + re-fold + re-probe); re-guard the parity gate; accumulate a few clean sessions.

## Phase F — Real-money gate (separate, later; out of scope for the demo)

- [ ] **F1** Define the trusted backtest window (representative; not the cherry-picked +138R weeks; regime-aware).
- [ ] **F2** Run the faithful backtest over it; record faithful-rate + net R.
- [ ] **F3** Present results; parity (Phase A) guarantees live reproduces them.
- [ ] **✅ CHECKPOINT M** — money gate: **user's explicit call** to arm real capital.

# Plan — From validated chain to the next-London live demo, with backtest≡live parity as the keystone

> Goal: [docs/intent/2026-06-27-end-goal.md](../docs/intent/2026-06-27-end-goal.md) — the north star.
> Checklist: [tasks/todo.md](todo.md).
> **Supersedes** the 2026-06-23 "validate the faithful chain" plan (Stage G is DONE — see git history
> + `docs/strategy/lanto-oracle.md`). This replan re-anchors the remaining work on the end goal's keystone:
> **backtest ≡ live parity**, and the sharpened real-money gate (trusted-window backtest results, not live hand-grading).

## Where we are (grounded 2026-06-27)

- ✅ **Brain** — the deterministic walker chain is faithful to Lanto on the 5 recordable 2026 oracle sessions
  (Stage G complete: right bias/grade/model/side, stands aside on the no-trade day, valid winning entries).
- ✅ **Live chain** runs the full chain **zero-LLM** end-to-end (proven London + NY in June).
- ✅ **Tradovate execution engine** exists — entry + OSO brackets + guardrails (valid stop · size · daily-loss halt)
  + tranches; demo-scoped, code + unit-tested, **not yet fully live-verified**.
- 🔧 **Parity** — fixes shipping (pre-open anchor `1459970`, honest labels `fae8449`, no-draw days `c906e6b`),
  but the proof is **fragmented** (`verify-live-parity.mjs`, `backtest-parity.test.js`, day-tape gate at 6/~20
  `verified:true`). No single standing gate asserts backtest ≡ live on real sessions.
- 🔧 **UI fidelity** — review-faithfulness redesign in flight; PREP/LIVE/REVIEW not fully re-pointed to the
  validated bot outputs; some panels may still carry UI-only/derived numbers.
- 🔧 **Live demo** — 06-24 NY-AM ran **observe-only** (Tradovate demo not logged in); never armed.
- ⛔ **Real-money gate** — the trusted-window backtest (faithful + net-positive) is not yet established
  (full-year fold showed the edge is regime-dependent; early-year OOS ran negative).

## Phases (each a complete vertical path; ordered by dependency)

**A. Parity gate — the keystone (foundational; everything trusts it).**
Consolidate the fragmented parity tooling into ONE standing, runnable gate that proves backtest ≡ live produce
**identical decisions** (setups/entries/stops/targets/trades; fills may differ) on real sessions, and expand the
`verified:true` tape corpus. Wire it into `npm test` so any change that breaks parity fails CI.

**B. UI fidelity — the transparency mandate (parallel to A, lands after the bot outputs are stable).**
Every PREP/LIVE/REVIEW panel (+ topbar chrome) reads the **same analysis the bot reads** — one source of truth,
no UI-only or fabricated numbers — and shows what the system is thinking and why. Verified panel-value == bot-input.

**C. Live bring-up + Tradovate demo arming (independent of B; needed for the demo).**
Readiness green for London (capture, live-check, supervisor, detector), Tradovate **demo** connected + account
confirmed + armed (automationMode=auto, guardrails), routing **dry-verified** by tests/inspection — **no orders placed**.

**D. First live demo session — the next London (depends on A + C; B strongly preferred).**
Armed auto-fire on Tradovate **demo**, autonomous, Claude-monitored; per-trade + defect recap.

**E. Iterate to clean (after D).**
Fix Phase-D plumbing defects (TDD + re-fold + re-probe), re-guard the parity gate, a few clean sessions.

**F. Real-money gate — separate, later (depends on A proven + a trusted-window backtest).**
Define the representative window, run the faithful backtest, confirm net-positive; parity guarantees live reproduces it.
**User makes the explicit flip-to-real call.** Out of scope for the London demo.

## Checkpoints (hard gates — user reviews)

- **P** (after A): the parity gate is green and standing — backtest ≡ live on the corpus. *This is the keystone sign-off.*
- **U** (after B): UI fidelity probed — panels mirror the bot's analysis.
- **R** (after C): readiness green + demo armed — user confirms the London target.
- **S** (after D): session review — did it trade correctly? triage defects.
- **M** (before F): money gate — user's explicit call to arm real capital.

## Standing rules (from CLAUDE.md + memory)

- Zero LLM in the trade path; the deterministic chain is the only setup producer.
- Faithful-to-Lanto first; never "fix" a faithful behavior to protect P&L.
- CLI only (`./bin/tv`), TV Desktop CDP 9225; no MCP TV tools; no computer-use.
- **Never place test orders** — the user places them; verify by unit test / read-only inspection; clean up any test fills.
- Run git/tests **in the worktree**; guard tests with `GOFNQ_STATE_DIR`.
- Feature branches + PR; never push to main; co-author tag on commits.

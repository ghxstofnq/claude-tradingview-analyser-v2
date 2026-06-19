# Todo — Backtest baseline + TESTS + history

Base: `origin/main` (d2441e4). One symbol at a time. See `tasks/plan.md`.

- [x] **T1** Worktree off `origin/main` + branch `claude/backtest-baseline-tests` + node_modules symlinks
- [x] **T2** `foldSymbol` core (`app/main/backtest-baseline.js`) → faithful run_details + per_day + total; unit test `buildAnalytics(run_details).cum_r == total_r`
- [x] **T3** Baseline persistence: read/write/refold + `shouldSnapshot` history; index refresh; IPC `baseline:get|refold|history`; preload; unit tests
- [x] **✅ CHECKPOINT A** — headless MNQ +117.05R / MES +67.87R (invariant OK on real corpus); baselines written — REVIEWED
- [x] **T4** `useBaseline(symbol)` hook
- [x] **T5** LIBRARY dashboard fed by faithful baseline + RE-FOLD button + staleness
- [x] **T6** BASELINE HISTORY panel in LIBRARY
- [x] **✅ CHECKPOINT B** — dashboard faithful + history live; CDP DOM verified (+117.0R, RE-FOLD, history Δ) — REVIEWED
- [x] **T7** `save-fold-test.mjs`; tests read/write/verdict helpers; IPC `tests:list|get|verdict|delete`; preload; unit tests
- [x] **T8** TESTS switcher tab + `useTests` + accept/reject/reason + per-day expand
- [ ] **✅ CHECKPOINT C** — TESTS end-to-end; accept/reject persists — pending final quiet boot
- [x] **T9** symbolView wiring + CSS + `/fold-test` doc update + full suite (floor 10/10, npm test 1320/1320, smoke 22/22)

## Verification commands
- floor: `GOFNQ_STATE_DIR=$(mktemp -d) node --test tests/day-tape.test.js`  → 10/10
- unit: `node --test tests/backtest-baseline.test.js`  → 8/8
- suite: `GOFNQ_STATE_DIR=$(mktemp -d) npm test`  → 1320/1320
- smoke: `npm run smoke:fixtures`  → 22/22
- in-app DOM check (quiet window, mode=prep): compare rendered CUMULATIVE R to `baseline/<slug>.json`

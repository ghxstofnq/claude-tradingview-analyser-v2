# Todo — Backtest baseline + TESTS + history

Base: `origin/main` (d2441e4). One symbol at a time. See `tasks/plan.md`.

- [ ] **T1** Worktree off `origin/main` + branch `claude/backtest-baseline-tests` + node_modules symlinks
- [ ] **T2** `foldSymbol` core (`app/main/backtest-baseline.js`) → faithful run_details + per_day + total; unit test `buildAnalytics(run_details).cum_r == total_r` + MES total matches +67.87R
- [ ] **T3** Baseline persistence: read/write/refold + `shouldSnapshot` history; IPC `baseline:get|refold|history`; preload; unit test snapshot logic
- [ ] **✅ CHECKPOINT A** — headless MNQ +117.05R / MES +67.87R; `baseline/<slug>.json` written — HUMAN REVIEW
- [ ] **T4** `useBaseline(symbol)` hook
- [ ] **T5** LIBRARY dashboard fed by faithful baseline + RE-FOLD button + staleness; DOM-verify total
- [ ] **T6** BASELINE HISTORY panel in LIBRARY
- [ ] **✅ CHECKPOINT B** — dashboard faithful + history live — HUMAN REVIEW
- [ ] **T7** `fold-week.mjs --save-test`; tests read/write/verdict helpers; IPC `tests:list|get|verdict|delete`; preload; unit test delta + verdict round-trip
- [ ] **T8** TESTS switcher tab + `useTests` + accept/reject/reason + per-day expand
- [ ] **✅ CHECKPOINT C** — TESTS end-to-end; accept/reject persists — HUMAN REVIEW
- [ ] **T9** symbolView wiring + CSS polish + `/fold-test` doc update + full suite (day-tape floor, npm test, smoke)

## Verification commands
- floor: `GOFNQ_STATE_DIR=$(mktemp -d) node --test tests/day-tape.test.js`
- unit: `node --test tests/backtest-baseline.test.js`
- suite: `npm test`
- smoke: `npm run smoke:fixtures`
- in-app DOM check (quiet window, mode=prep): compare rendered CUMULATIVE R to `baseline/<slug>.json`

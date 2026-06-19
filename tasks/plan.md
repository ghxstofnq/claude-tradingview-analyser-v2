# Plan — Backtest popover: faithful baseline + TESTS section + baseline history

**Intent:** [docs/intent/2026-06-19-backtest-baseline-and-tests.md](../docs/intent/2026-06-19-backtest-baseline-and-tests.md)
**Base:** `origin/main` (d2441e4 — has #144/#145/#146). The current worktree
(`claude/smt-leader-selection`) is behind and must NOT be the base.

## Goal
The LIBRARY dashboard shows the **faithful fold-week** baseline (regen + AM→PM
carry), refreshed by a button; add a TESTS section (accept/reject + reason) and
versioned baseline history. One symbol at a time (MNQ / MES separate).

## Why the dashboard is wrong today
`LibraryBody` feeds `Analytics` from `useAnalytics(symRuns)` →
`buildAnalytics(runDetails)` → pairs each run's **raw `setups.jsonl`** (the
generation-time replay outcomes: stale targets, no carry). The faithful numbers
live only as `total_r` in `index.json` (written by `save-fold-baseline.mjs`),
which has no per-trade rows for the rich dashboard. Fix: a reusable fold that
emits faithful `run_details` (the exact shape `buildAnalytics` consumes), cached
per symbol; feed THAT to the existing `Analytics` component unchanged.

## Architecture (reuse-first)
- **Reused unchanged:** `Analytics.jsx`, `cli/lib/backtest-analytics.js`
  (`buildAnalytics`), `runBacktest`, `contextFromBriefPayloads`, `gradeOpenTrade`,
  `buildBriefDigest`, `buildDirectSessionBriefPayloads`, popover view-switch
  pattern, `.section`/`.pill`/`.lib-table` CSS.
- **New core:** `app/main/backtest-baseline.js` — electron-free. `foldSymbol()`
  (lifts the regen + bus-capture + AM→PM-carry logic out of
  `scripts/save-fold-baseline.mjs`) returns buildAnalytics-ready `run_details` +
  `per_day` + `total_r`. Plus baseline read/write/refold(+snapshot) + history.
- **New artifacts** under `state/backtest/`:
  - `baseline/<slug>.json` — current faithful baseline (full `run_details`).
  - `baseline/<slug>.history.json` — array of prior baseline summaries.
  - `tests/<id>.json` — one fold-test result.
  - `<slug>` = `symbol.replace(/[^A-Z0-9]/gi,"")` → `MNQ1` / `MES1`.
- **New IPC** (in `ipc-backtest.js`) + preload bridge (`app/preload.cjs`):
  `backtest:baseline:get|refold|history`, `backtest:tests:list|get|verdict|delete`.
- **New renderer:** `useBaseline(symbol)` + `useTests(symbol)` hooks; LIBRARY fed
  by baseline; RE-FOLD button; BASELINE HISTORY panel; TESTS switcher tab.
- **Script:** extend `scripts/fold-week.mjs` with `--save-test "<label>"`.

### Artifact shapes
```
baseline/<slug>.json
{ symbol, built_at, code_sha, corpus:{n_sessions, dates:[...]},
  total_r, per_day:[{date,session,r}],
  run_details:[{entry:{date,session,open_reaction}, setups:[ {type:"open",id,entry,stop,tp1,tp2,grade,model,side,event_ts}, {type:"outcome",setup_id,outcome,realized_r} ]}],
  reason: null }

baseline/<slug>.history.json
[ { built_at, code_sha, corpus_n, total_r, reason } ]   // prior baselines, newest last

tests/<id>.json
{ id, label, symbol, created_at, code_sha, dates:[...],
  baseline_total, treatment_total, delta,
  corpus_match: bool,                                   // false = corpus differs from baseline; warn
  per_day:[{date,session,baseline_r,treatment_r,delta}],
  treatment_run_details:[...],                          // for the expand → buildAnalytics
  status: "pending"|"accepted"|"rejected", reason: null }
```

## Dependency graph
T1 → T2 → T3 → {T4 → T5} ; T3 → T6 → T7 ; {T5,T7} → T8 → T9
(T2 core feeds T3 baseline + T6 tests; T4 IPC feeds T5 UI; T6 feeds T7 UI.)

## Constraints carried
- CLI only for TV; `foldSymbol` is pure compute (no TV/chart) → safe even during
  a live session. Only booting the Electron app for visual check needs a quiet
  window (mode=prep).
- No false numbers (constraints #6/#7) — every figure code-derived from the fold.
- Run git/tests in the worktree; never push to main; Conventional Commits +
  `Co-Authored-By: Claude <noreply@anthropic.com>`; no `--no-verify/--force/--amend`.
- Immutability floor must stay green: deterministic chain output is unchanged
  (we only read its results into a new shape).

---

## Task 1 — Clean worktree off origin/main
**Files:** none (git only).
**Steps:**
- `git worktree add -b claude/backtest-baseline-tests <wt> origin/main`
- symlink node_modules: `ln -sfn <main>/node_modules <wt>/node_modules`;
  `ln -sfn <main>/app/node_modules <wt>/app/node_modules`
- copy these plan files into `<wt>/tasks/`.
**Acceptance:** `git -C <wt> log --oneline -1` shows `d2441e4`; `node --test`
runs in the worktree; `scripts/save-fold-baseline.mjs` + canonical `fold-week.mjs`
present.
**Verify:** `GOFNQ_STATE_DIR=$(mktemp -d) node --test tests/day-tape.test.js` green.

## Task 2 — `foldSymbol` core + unit test
**Files:** Create `app/main/backtest-baseline.js`; Test
`tests/backtest-baseline.test.js`.
**Build:** export `foldSymbol({ symbol, stateDir, dates })`. Lift `regen`,
`pmCarry`, `findRun`, and the bus-capture fold from `save-fold-baseline.mjs`, but
capture the FULL surfaced setup + outcome (not just R) and emit
`run_details:[{entry,setups}]` with open+outcome rows (shape above), plus
`per_day:[{date,session,r}]` and `total_r`. Reuse `runBacktest` to a temp
`stateDir`. `code_sha` via `git rev-parse --short HEAD` (best-effort).
**Acceptance:**
- `buildAnalytics(result.run_details).cum_r` === `result.total_r` (±0.01).
- Folding the registered MES corpus yields `total_r` matching
  `save-fold-baseline.mjs MES1!` (the +67.87R reference).
**Verify (TDD):** unit test on a 1–2 run fixture asserts run_details shape +
the cum_r==total_r invariant; then a manual `node -e` fold of MES asserts the
total. RED first (module missing) → GREEN.

## Task 3 — Baseline persistence (refold + snapshot) + IPC + preload + unit test
**Files:** Modify `app/main/backtest-baseline.js`, `app/main/ipc-backtest.js`,
`app/preload.cjs`; Test `tests/backtest-baseline.test.js`.
**Build:**
- `readBaseline({stateDir,symbol})`, `writeBaseline(...)`, `readHistory(...)`.
- `shouldSnapshot(oldB, newB)` (pure) → true iff `total_r` or `code_sha` differ.
- `refoldBaseline({stateDir,symbol,reason})` = foldSymbol → if existing baseline
  && shouldSnapshot → append old summary to history → write new baseline → return.
- IPC: `backtest:baseline:get|refold|history` (thin wrappers, `STATE_DIR`).
- Preload: add the three under the `backtest:` bridge.
**Acceptance:** first refold writes baseline + empty history; second refold with a
changed `total_r` appends exactly one history record; an unchanged refold appends
none.
**Verify (TDD):** unit test drives `refoldBaseline` twice against a temp stateDir
with a stubbed `foldSymbol` (inject via param) — asserts snapshot logic. RED→GREEN.

### ✅ CHECKPOINT A — headless baseline correct (before any UI)
Run `refoldBaseline` for MNQ + MES against the main `state/backtest`; confirm
totals = +117.05R / +67.87R and `baseline/<slug>.json` written. **Human review.**

## Task 4 — `useBaseline` hook
**Files:** Create `app/renderer/src/hooks/useBaseline.js`.
**Build:** `useBaseline(symbol)` → `{ baseline, loading, refolding, refold() }`.
Loads `baseline:get` on symbol change; `refold()` sets `refolding`, calls
`baseline:refold`, replaces baseline on resolve.
**Acceptance:** returns null cleanly when no baseline; `refold()` toggles
`refolding`.
**Verify:** `node --test` on a tiny extracted pure reducer if any; else covered
by Task 5 in-app check.

## Task 5 — LIBRARY dashboard reads faithful baseline + RE-FOLD button
**Files:** Modify `app/renderer/src/BacktestPopover.jsx` (`LibraryBody`).
**Build:** replace `useAnalytics(symRuns)` with
`buildAnalytics(baseline?.run_details ?? [])` via `useBaseline(symbolView)`; render
`Analytics A={A}`; add a header row with `built_at` + "RE-FOLD BASELINE" button
(disabled while `refolding`, shows "RE-FOLDING…"); empty state when no baseline.
Keep the AGGREGATE grid + filters + table (index.json-based) as-is.
**Acceptance:** MNQ dashboard CUMULATIVE R == faithful baseline total (not the raw
re-fold); clicking RE-FOLD recomputes and updates without reload.
**Verify:** boot the app in a quiet window (mode=prep); read the rendered value
via `preview_eval`/DOM query (per global rule — don't trust screenshots) and
compare to `baseline/MNQ1.json` total.

## Task 6 — Baseline history panel (in LIBRARY)
**Files:** Modify `BacktestPopover.jsx` (`LibraryBody`).
**Build:** collapsible "BASELINE HISTORY" `.section` listing prior baselines
(built_at · total · Δ to current · reason), from `useBaseline().baseline` +
`baseline:history`. Reuse existing list styles.
**Acceptance:** after two refolds with a code change between them, the prior
baseline shows with a non-zero Δ.
**Verify:** in-app DOM check after forcing a second baseline.

### ✅ CHECKPOINT B — dashboard faithful + history live. **Human review (eyeball).**

## Task 7 — Test artifact: `fold-week.mjs --save-test` + tests IPC + preload + unit test
**Files:** Modify `scripts/fold-week.mjs`, `app/main/backtest-baseline.js`
(test read/write helpers), `app/main/ipc-backtest.js`, `app/preload.cjs`; Test
`tests/backtest-baseline.test.js`.
**Build:**
- `fold-week.mjs --save-test "<label>" --symbol <sym>`: fold current code
  (treatment) via the shared core; read accepted `baseline/<slug>.json` for
  baseline numbers; compute per-day + total delta; write `tests/<id>.json`
  (status "pending"). `corpus_match` = same date+session set.
- Helpers: `listTests({stateDir,symbol})`, `readTest`, `writeTestVerdict({id,status,reason})`.
- IPC: `backtest:tests:list|get|verdict|delete`; preload bridge.
**Acceptance:** running `--save-test` writes a tests file with correct per-day
delta vs the accepted baseline; `verdict` sets `status`+`reason` on disk.
**Verify (TDD):** unit test on delta computation (pure `diffPerDay(baseline,treatment)`)
+ verdict write/read round-trip. RED→GREEN. Then one real `--save-test` on MNQ.

## Task 8 — TESTS view (renderer) + accept/reject/reason + expand
**Files:** Create `app/renderer/src/hooks/useTests.js`; Modify
`BacktestPopover.jsx` (add `TESTS` to `BT_SWITCHER`, new `TestsBody`),
`app/renderer/src/Backtest.helpers.js` (`nextState` mapping for `TESTS`).
**Build:** `useTests(symbol)` → list + verdict action. `TestsBody`: newest-first
rows (label · treatment total · Δ vs baseline · status pill · reason); click
expands to per-day comparison table + `Analytics` of `treatment_run_details`;
pending rows get ACCEPT / REJECT + a reason input (calls `verdict`). Match
existing `.section`/`.pill`/`.lib-table` styling.
**Acceptance:** a saved test appears under TESTS; ACCEPT → green pill + reason
persists; REJECT → red pill + reason; expand shows per-day deltas.
**Verify:** in-app DOM check on a real saved MNQ test; re-open popover → verdict
persisted.

### ✅ CHECKPOINT C — TESTS end-to-end. **Human review (run a test, accept/reject).**

## Task 9 — symbolView wiring, CSS polish, docs, full suite
**Files:** `BacktestPopover.jsx`, `app/renderer/src/app.css` (minimal),
`.claude/commands/fold-test.md`, intent xref.
**Build:** ensure baseline + tests follow `symbolView` (MNQ/MES); add only the
CSS needed (delta +/- coloring, status pills reuse `.pill`); document
`--save-test`, the baseline artifact, the RE-FOLD button, and accept/reject in
the `/fold-test` skill; update its stale "MNQ tape-only" corpus note (MNQ briefs
were re-captured).
**Acceptance:** switching MNQ↔MES swaps baseline + tests; styling matches.
**Verify (final):**
- `GOFNQ_STATE_DIR=$(mktemp -d) node --test tests/day-tape.test.js` green
  (immutability floor — chain output unchanged).
- `npm test` green (modulo the documented pre-existing failures).
- `npm run smoke:fixtures` green.
- in-app: MNQ + MES dashboards faithful, a test saved + accepted/rejected.

---

## Open question for human (non-blocking)
`--save-test` compares treatment (current working code) against the **accepted
baseline artifact**. When the corpus differs from when the baseline was folded,
`delta` conflates code + corpus — surfaced via `corpus_match:false` warn in the
UI. The rigorous old-vs-new env-toggle fold stays the `/fold-test` procedure; the
artifact records its verdict. Confirm this is the intended comparison.

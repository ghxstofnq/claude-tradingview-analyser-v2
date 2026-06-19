# /fold-test — test a strategy/chain change by folding the corpus old-vs-new

Decide whether a change to the walker chain, grading, or a proposed filter/edge
actually helps — by folding the backtest corpus through the REAL chain
old-vs-new. Never by eyeballing a static R-split on captured trades.

## Hard rules

1. **ONE SYMBOL AT A TIME.** The backtest corpus mixes MNQ and MES runs
   side by side; pooling them is meaningless. Always pass `--symbol MNQ1!`
   (or `MES1!`). Use the symbol the user names. If they don't name one,
   default to `MNQ1!` and say so — never silently pool.
2. **BACKTEST DATA BY DEFAULT** — all runs for that symbol, all dates. Only
   restrict dates when the user asks (`--dates 2026-06-09,2026-06-10`). Only
   fold LIVE data when the user explicitly asks for it — then use
   `fold-live-corpus.mjs` (the faithful per-bar live record).
3. **A static separation is NOT evidence.** A bucket table, an R-split, or a
   "skip-X" simulation on the captured trades is survivorship — it assumes the
   trades you'd cut vanish and nothing else moves. It counts only after it's
   implemented and folded. (Memory: `fold-before-trusting-a-separator`,
   `filters-dont-separate`.)

## Procedure

1. **Clean worktree off `origin/main`** (so the current branch can't confound
   the result):
   ```
   git worktree add -b claude/<name> <wt> origin/main
   ln -sfn <main>/node_modules <wt>/node_modules
   ln -sfn <main>/app/node_modules <wt>/app/node_modules
   ```
2. **Baseline fold** — record per-run lines + the total:
   ```
   node scripts/fold-backtest-corpus.mjs <main>/state/backtest --symbol <SYM>
   ```
3. **Implement the change behind an ENV TOGGLE** (e.g. `process.env.TV_X==='1'`)
   so baseline behavior is byte-for-byte unchanged when the toggle is off.
4. **Treatment fold** with the toggle on; diff per-run and total vs baseline.
5. **Immutability floor:** the committed frozen tapes must stay green:
   ```
   GOFNQ_STATE_DIR=$(mktemp -d) node --test tests/day-tape.test.js
   ```
   Use a temp state dir so the run can't clobber live `state/`.
6. **Verdict:** ships only if net-positive on the symbol's corpus AND no gate
   regression. Report the per-run winners and losers, not just the total — a
   total that improves by zeroing a few big winners is a red flag.
7. **Cleanup:** remove the worktree and delete the branch.

## Corpus reality (as of 2026-06-19)

`state/backtest` holds **~59 foldable MNQ runs** (5 weeks, May 11–June; net ≈
**+79R** on a current-code re-fold) and ~57 MES runs (May–June, net ≈ +9.66R).
Most MNQ runs predate the `brief-payloads.json` format, so the fold rebuilds
their context from each tape's embedded bundle / recorded per-bar inputs.

**Faithfulness caveat:** these MNQ runs are backtest *replays*, not live
walker-inputs, and the rebuilt-from-tape context is approximate — so the
absolute R is a re-fold, NOT the stored summaries (a run that summarised
+25R may re-fold to +8R as code evolves). Use it for **breadth and for
gate DELTAS** (same corpus, toggle on/off — robust, since gates read fixed
per-bar tape data). For live-faithful absolutes, fold `state/session`
(`fold-live-corpus.mjs`) — but that is currently ~1 week of MNQ.

## Scripts (committed)

- `scripts/fold-backtest-corpus.mjs` — symbol-aware backtest fold (the workhorse).
- `scripts/fold-live-corpus.mjs` — faithful live-session fold (opt-in only).
- `tests/day-tape.test.js` + `tests/tapes/*.tape.json` — frozen-tape immutability
  floor (run via `node --test`). Avoid `refold-gate.mjs` / `refold-week-*.mjs`
  as the floor: they pin specific backtest-run ids and break after a data cleanup.

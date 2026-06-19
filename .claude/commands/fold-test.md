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

`state/backtest` holds ~5 MNQ runs (recent June only, net ≈ **−1.93R**) and
~57 MES runs (May–June, net ≈ **+9.66R**). **The MNQ backtest sample is thin** —
say so when you report MNQ numbers, and offer the live corpus (`state/session`,
all MNQ) as a second read if the user wants more MNQ evidence.

## Scripts (committed)

- `scripts/fold-backtest-corpus.mjs` — symbol-aware backtest fold (the workhorse).
- `scripts/fold-live-corpus.mjs` — faithful live-session fold (opt-in only).
- `tests/day-tape.test.js` + `tests/tapes/*.tape.json` — frozen-tape immutability
  floor (run via `node --test`). Avoid `refold-gate.mjs` / `refold-week-*.mjs`
  as the floor: they pin specific backtest-run ids and break after a data cleanup.

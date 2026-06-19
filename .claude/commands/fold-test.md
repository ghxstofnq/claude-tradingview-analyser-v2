# /fold-test — test a strategy/chain change by folding the corpus old-vs-new

Decide whether a change to the walker chain, grading, or a proposed filter/edge
actually helps — by folding the backtest corpus through the REAL chain
old-vs-new. Never by eyeballing a static R-split on captured trades.

## Hard rules

1. **ONE SYMBOL AT A TIME.** The backtest corpus mixes MNQ and MES runs side by
   side; pooling them is meaningless. Always pass `--symbol MNQ1!` (or `MES1!`).
   Use the symbol the user names; if they don't, default to `MNQ1!` and say so.
2. **BACKTEST DATA BY DEFAULT** — all runs for that symbol, all dates. Restrict
   dates only when the user asks. Fold LIVE data only when explicitly asked
   (then `fold-live-corpus.mjs` — the faithful per-bar live record).
3. **A static separation is NOT evidence.** A bucket table, an R-split, or a
   "skip-X" sim on captured trades is survivorship — it assumes the trades you'd
   cut vanish and nothing else moves. It counts only after it's implemented and
   folded. (Memory: `fold-before-trusting-a-separator`, `filters-dont-separate`.)
4. **R is never comparable across corpora.** A "131 → 79" drop is almost always
   a different corpus or harness, not a code regression. To test code, hold the
   corpus FIXED and vary only the code (env-toggle, or git-checkout the same fold).

## The canonical harness: `fold-week.mjs`

This is the correct way to fold — it's the most faithful. Two reasons:

- **Self-healing brief.** For each run it re-reads the recorded `brief-bundle.json`
  and **recomputes the brief (digest + payloads) with TODAY's code** — so the fold
  uses the current chain's HTF read, not the stale targets baked into the old tape
  (the "never trust a tape's baked targets after a brief change" lesson). Falls
  back to the recorded payloads if there's no bundle; **SKIPs a run that has
  neither** (a tape-only legacy run — re-record it first).
- **AM→PM carry.** A morning trade still open at the session boundary keeps
  grading against *that day's* afternoon bars to the 16:00 close — runners that
  span lunch earn their full R instead of being truncated at the session edge.

Then it folds the deterministic chain (auto mode, same truth/grade fns) — no
gate, no reprice — and prints per-session R + the booked trades + bias + week total.

**Usage** (literal dates — zsh does NOT word-split a `$var`, so pass them literally;
`--bt` points a worktree at the main checkout's data):

```
node scripts/fold-week.mjs --bt <main>/state/backtest --symbol MNQ1! \
  2026-05-11 2026-05-12 2026-05-13 2026-05-14 2026-05-15   # ...all weeks
```

**Requires full-format runs** (each run needs `brief-bundle.json`). Tape-only
runs print `SKIP` — fold-week can't fold them faithfully; they must be
re-recorded first.

## Procedure (old-vs-new)

1. **Clean worktree off `origin/main`** (so the current branch can't confound):
   ```
   git worktree add -b claude/<name> <wt> origin/main
   ln -sfn <main>/node_modules <wt>/node_modules
   ln -sfn <main>/app/node_modules <wt>/app/node_modules
   ```
2. **Baseline fold** — `fold-week.mjs --bt <main>/state/backtest --symbol <SYM>
   <dates>`; record per-session R + week total.
3. **Implement the change behind an ENV TOGGLE** so baseline is byte-for-byte
   unchanged when off.
4. **Treatment fold** with the toggle on; diff per-session + total vs baseline.
5. **Immutability floor:** `GOFNQ_STATE_DIR=$(mktemp -d) node --test tests/day-tape.test.js`
   must stay green (temp state dir so it can't clobber live `state/`).
6. **Verdict:** ships only if net-positive on the symbol's corpus AND no floor
   regression. Report the per-session winners and losers, not just the total —
   a total that improves by zeroing a few big winners is a red flag.
7. **Cleanup:** remove the worktree and delete the branch.

## Fallback (less faithful): `fold-backtest-corpus.mjs`

`node scripts/fold-backtest-corpus.mjs <main>/state/backtest --symbol <SYM>`
iterates every run and, when a run is **tape-only** (no brief bundle — e.g. the
current MNQ runs), rebuilds an **approximate** context from the tape's embedded
per-bar inputs. It has **no self-healing regen and no AM→PM carry**, so its
absolute R is not faithful. Use it ONLY when fold-week can't run (tape-only runs
and re-recording isn't done yet) — and for **gate DELTAS, not absolutes** (the
deltas are robust because the gate reads fixed per-bar tape data).

## Corpus reality (as of 2026-06-19)

MNQ + MES are BOTH full-format now (the MNQ briefs were re-captured via
`scripts/recapture-mnq-briefs.mjs`), 58 am+pm runs each on an identical
timeline (May 11 – Jun 18). Faithful fold-week baselines: **MNQ +117.05R**,
**MES +67.87R**. The live corpus (`state/session`) is full-format MNQ.

## Saving a test to the BACKTEST popover (TESTS section)

After folding a change old-vs-new, persist the result so it lives in the app,
not terminal scrollback. The popover has a faithful-baseline dashboard + a TESTS
section; both update via:

- `scripts/save-fold-baseline.mjs <SYM>` — write the faithful per-run totals into
  `index.json` + summaries (legacy path). The **RE-FOLD BASELINE** button in the
  popover does the same plus writes `state/backtest/baseline/<slug>.json` (the
  dashboard's source) and snapshots the prior baseline into history.
- `scripts/save-fold-test.mjs <SYM> "<label>" [dates...]` — fold the CURRENT
  working code (the treatment) and diff it against the accepted baseline file,
  writing `state/backtest/tests/<id>.json` (status `pending`). Set the change's
  env gate before running so the diff is the change's effect. Accept/reject +
  reason is set from the popover and is a **record, not a code-swap** — adopting
  the change is still the normal edit → merge → RE-FOLD path. The baseline files
  are read by the popover, so the dashboard + tests are per-symbol and faithful.

## Scripts (committed)

- `scripts/fold-week.mjs` — **canonical**: self-healing regen + AM→PM carry,
  `--symbol` + `--bt` + literal dates.
- `scripts/save-fold-baseline.mjs` / `app/main/backtest-baseline.js` `foldSymbol`
  — fold a whole symbol corpus (all registered runs) the canonical way; feeds the
  popover's faithful baseline.
- `scripts/save-fold-test.mjs` — fold current code vs the accepted baseline,
  write a TESTS artifact for the popover.
- `scripts/fold-backtest-corpus.mjs` — fallback for tape-only runs (approximate).
- `scripts/fold-live-corpus.mjs` — faithful live-session fold (opt-in only).
- `tests/day-tape.test.js` + `tests/tapes/*.tape.json` — frozen-tape immutability
  floor (`node --test`). Avoid `refold-gate.mjs` / `refold-week-*.mjs` as the
  floor: they pin specific run ids and break after a data cleanup.

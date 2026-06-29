# Oracle rebuild kickoff audit

Date: 2026-06-29
Branch: `docs/rebuild-oracle-from-authority`
Base: `03ffb8c chore: prune scripts and retire callout authority`

## Goal

Rebuild the paired-session oracle/corpus from allowed evidence only, so pair-leader and strategy folds are not scored against retired callout / alerted-trade-derived labels.

Allowed authority:

- `docs/strategy/*.md`
- `docs/strategy/transcripts/*.md`
- chart/tape evidence
- explicit user approval

Retired-source labels can explain history, but cannot set instrument, side, entry, stop, target, grade, or leader-truth.

## Current hard blocker

`node scripts/fold-pair-leader.mjs` currently has **0 scored paired sessions** in this workspace because every configured row is missing at least the MES tape, and the retired candidate rows are missing both local tapes.

Observed output:

```text
2026-06-16: MISSING tape (record MES)
2026-06-09: MISSING tape (record MES)
2026-06-17: MISSING tape (record MES)
2026-06-18: MISSING tape (record MES)
2026-02-09: MISSING tape (record MES)
2026-01-29: MISSING tape (record MES)
2026-06-15: MISSING tape (record MES)
2026-04-06: MISSING tape (record MES)
2026-06-22: MISSING tape (record MES)
=== ARM TOTALS (0 paired sessions) ===
```

Local `tests/tapes/*.tape.json` inventory currently has only:

- `tests/tapes/2026-02-09-ny-am-replay.tape.json`
- `tests/tapes/2026-06-09-ny-am-replay.tape.json`
- `tests/tapes/2026-06-16-ny-am-replay.tape.json`
- `tests/tapes/2026-06-17-ny-am-replay.tape.json`
- `tests/tapes/2026-06-18-ny-am-replay.tape.json`
- `tests/tapes/2026-06-24-ny-am.tape.json`
- `tests/tapes/0001-synthetic-mss-long.tape.json`

No local `*-mes-ny-am-replay.tape.json` files were found.

One MES tape is recoverable from git history but should **not** be recommitted:

- `tests/tapes/2026-06-16-mes-ny-am-replay.tape.json` was added in `77e45c3` and deleted in
  `40aa7ed chore(smt): keep MES validation tapes local (too large for git)`.
- Blob size in `77e45c3`: `64,750,344` bytes (~64.8 MB).
- If needed for local analysis only, recover with `git show 77e45c3:tests/tapes/2026-06-16-mes-ny-am-replay.tape.json > tests/tapes/2026-06-16-mes-ny-am-replay.tape.json`, run the fold, then delete/ignore the file.

Temporary local-only recovery of that tape produced one scored row:

```text
2026-06-16 · oracle: MNQ short
  MNQ: Trend short B → 4.59R (tp1)
  MES: Inversion long B → -1R (stopped)
  disp-leader → MNQ (primary_higher_disp_score) ✓ matches oracle
  smt-leader  → MES (smt_divergence)
```

The recovered 64.8 MB MES tape was deleted after the fold and is not part of this branch.

### Tape recovery slice 1 — 2026-06-29

History search across the approved pair rows found only one MES counterpart in git history:

| MES tape path | Git history result | Action |
|---|---|---|
| `tests/tapes/2026-02-09-mes-ny-am-replay.tape.json` | no history | record fresh MES tape |
| `tests/tapes/2026-06-09-mes-ny-am-replay.tape.json` | no history | record fresh MES tape |
| `tests/tapes/2026-06-16-mes-ny-am-replay.tape.json` | recoverable from `77e45c3`; deleted by `40aa7ed`; blob size `64,750,344` bytes | local-only recovery for fold evidence; do not recommit |
| `tests/tapes/2026-06-17-mes-ny-am-replay.tape.json` | no history | record fresh MES tape |
| `tests/tapes/2026-06-18-mes-ny-am-replay.tape.json` | no history | record fresh MES tape |

The local-only 2026-06-16 recovery was repeated after this audit commit point and produced the same single scored row:

```text
=== PAIR-LEADER FOLD ===

2026-06-16  ·  oracle: MNQ short
  MNQ: Trend short B → 4.59R (tp1)
  MES: Inversion long B → -1R (stopped)
  disp-leader → MNQ (primary_higher_disp_score)  ✓ matches oracle
  smt-leader  → MES (smt_divergence)

2026-06-09: MISSING tape (record MES)
2026-06-17: MISSING tape (record MES)
2026-06-18: MISSING tape (record MES)
2026-02-09: MISSING tape (record MES)
2026-01-29: MISSING tape (record MES)
2026-06-15: MISSING tape (record MES)
2026-04-06: MISSING tape (record MES)
2026-06-22: MISSING tape (record MES)
=== ARM TOTALS (1 paired session) ===
  always-MNQ      : 4.59R
  displacement    : 4.59R
  divergence-SMT  : -1R

  (anecdotal until ≥5 paired sessions — read the trend, not one row)
```

The recovered MES blob was deleted again after the fold. `git status --short --untracked-files=no` was clean immediately afterward.

### Tape recording slice 2 — approved pair corpus materialized locally

Recorded the four missing approved-row MES counterparts through `./bin/tv record-tape` against TradingView Desktop / bar replay. These files are intentionally **local-only** and ignored by `.gitignore` (`tests/tapes/*-mes-ny-am-replay.tape.json`) because they are too large for normal git history.

| MES tape | Source | Entries | First event | Last event | Size | Verification status |
|---|---|---:|---|---|---:|---|
| `tests/tapes/2026-02-09-mes-ny-am-replay.tape.json` | fresh `record-tape` | 92 | `2026-02-09T14:29:00.000Z` | `2026-02-09T16:00:00.000Z` | `39,525,026` bytes | `verified:false`; no MES expectation assigned |
| `tests/tapes/2026-06-09-mes-ny-am-replay.tape.json` | fresh `record-tape` | 92 | `2026-06-09T13:29:00.000Z` | `2026-06-09T15:00:00.000Z` | `39,811,047` bytes | `verified:false`; no MES expectation assigned |
| `tests/tapes/2026-06-16-mes-ny-am-replay.tape.json` | local-only recovery from `77e45c3` | 152 | `2026-06-16T13:29:00.000Z` | `2026-06-16T16:00:00.000Z` | `64,750,344` bytes | `verified:false`; no MES expectation assigned |
| `tests/tapes/2026-06-17-mes-ny-am-replay.tape.json` | fresh `record-tape` | 107 | `2026-06-17T13:29:00.000Z` | `2026-06-17T15:15:00.000Z` | `46,461,318` bytes | `verified:false`; no MES expectation assigned |
| `tests/tapes/2026-06-18-mes-ny-am-replay.tape.json` | fresh `record-tape` | 92 | `2026-06-18T13:29:00.000Z` | `2026-06-18T15:00:00.000Z` | `39,749,447` bytes | `verified:false`; no MES expectation assigned |

With those local-only tapes present, `node scripts/fold-pair-leader.mjs` now has the five approved oracle rows foldable:

```text
=== PAIR-LEADER FOLD ===

2026-06-16  ·  oracle: MNQ short
  MNQ: Trend short B → 4.59R (tp1)
  MES: Inversion long B → -1R (stopped)
  disp-leader → MNQ (primary_higher_disp_score)  ✓ matches oracle
  smt-leader  → MES (smt_divergence)

2026-06-09  ·  oracle: MNQ short
  MNQ: Inversion short A+ → 3.39R (tp1)
  MES: Inversion long B → -1R (stopped)
  disp-leader → MNQ (inconclusive_margin_below_threshold)  ✓ matches oracle
  smt-leader  → MNQ (no_divergence_measured)

2026-06-17  ·  oracle: no-trade
  MNQ: no_trade
  MES: Inversion long A+ → -1R (stopped)
  disp-leader → MNQ (inconclusive_margin_below_threshold)  (not scored vs oracle)
  smt-leader  → MNQ (no_divergence_measured)

2026-06-18  ·  oracle: MNQ long
  MNQ: Inversion long B → -1R (stopped)
  MES: no_trade
  disp-leader → MNQ (inconclusive_margin_below_threshold)  ✓ matches oracle
  smt-leader  → MNQ (no_divergence_measured)

2026-02-09  ·  oracle: MNQ long
  MNQ: Inversion long A+ → 2.3R (tp1)
  MES: Trend long B → -1R (stopped)
  disp-leader → MNQ (inconclusive_margin_below_threshold)  ✓ matches oracle
  smt-leader  → MNQ (no_divergence_measured)

2026-01-29: MISSING tape (record MES)
2026-06-15: MISSING tape (record MES)
2026-04-06: MISSING tape (record MES)
2026-06-22: MISSING tape (record MES)
=== ARM TOTALS (5 paired sessions) ===
  always-MNQ      : 9.28R
  displacement    : 9.28R
  divergence-SMT  : 3.69R

  (anecdotal until ≥5 paired sessions — read the trend, not one row)
```

Interpretation discipline:

- This makes the approved pair rows mechanically foldable; it does **not** assign MES oracle truth.
- The 2026-06-17 oracle is `no-trade`, so leader-pick matching is intentionally not scored against an instrument pick.
- Arm totals over five rows are now useful audit evidence but still not a license to wire/default-on pair-leader behavior.

## Evidence inventory

| Date | Current paired use | Fixture status | Allowed docs/transcript evidence found | Current action |
|---|---:|---|---|---|
| 2026-02-09 | scored as `MNQ long` in `scripts/fold-pair-leader.mjs` | MNQ labeled A+ Trend long; MES counterpart unlabeled | Yes: `docs/strategy/lanto-oracle.md:137-162`; `docs/strategy/transcripts/How-I-Enter-The-Market-Entry-Models-292026-CLASS-RECORDING-MoFNCTq9aXs-formatted-transcript.md:81-95`; `docs/strategy/daily-bias.md:32-47` | Keep MNQ oracle. Record/recover MES tape before pair scoring. Do not assign MES expectation. |
| 2026-06-09 | scored as `MNQ short` | MES counterpart unlabeled | Yes in oracle: `docs/strategy/lanto-oracle.md:164-184`; no direct dated transcript hit found | Keep MNQ oracle as user-approved/replay-confirmed. Record/recover MES tape before pair scoring. Do not assign MES expectation. |
| 2026-06-16 | scored as `MNQ short` | MNQ labeled B MSS short; MES counterpart unlabeled | Yes in oracle: `docs/strategy/lanto-oracle.md:285-328` | Keep MNQ oracle. Record/recover MES tape before pair scoring. Do not assign MES expectation. |
| 2026-06-17 | scored as `no-trade` | MNQ labeled no-trade; MES counterpart unlabeled | Yes in oracle: `docs/strategy/lanto-oracle.md:330-345` | Keep MNQ no-trade oracle. Record/recover MES tape before pair scoring. |
| 2026-06-18 | scored as `MNQ long` | MNQ labeled B Trend long; MES counterpart unlabeled | Yes in oracle: `docs/strategy/lanto-oracle.md:347-364` | Keep MNQ oracle. Record/recover MES tape before pair scoring. Do not assign MES expectation. |
| 2025-12-12 | not currently in pair fold | MES `needs_gxofnq_review`; exact trade levels nulled | Yes for bias/grade only: `docs/strategy/lanto-oracle.md:186-213`; transcript support: `docs/strategy/transcripts/How-I-Develop-Daily-Bias-12122025-CLASS-kix1SDRSCiU-formatted-transcript.md:71-89` | Keep bias/grade facts only. Reconstruct instrument/entry/stop/TP from chart evidence, then ask user approval before promotion. |
| 2026-01-29 | pending review in pair fold | MNQ/MES both unlabeled | No direct allowed docs/transcript hit found for the date; previous exact labels came from retired material | Leave `oracle_pick: null`; requires fresh chart/tape re-grade and user approval. |
| 2026-04-06 | pending review in pair fold | MNQ/MES both unlabeled | No direct allowed docs/transcript hit found for the date; previous exact labels came from retired material | Leave `oracle_pick: null`; requires fresh chart/tape re-grade and user approval. |
| 2026-06-15 | pending review in pair fold | MNQ/MES both unlabeled | No direct allowed docs/transcript hit found for the date; previous exact labels came from retired material | Leave `oracle_pick: null`; requires fresh chart/tape re-grade and user approval. |
| 2026-06-22 | pending review in pair fold | MNQ/MES both unlabeled | No direct allowed docs/transcript hit found for the session date; `docs/strategy/lanto-oracle.md` references 2026-06-22 as a grading date, not an oracle session | Leave `oracle_pick: null`; requires fresh chart/tape re-grade and user approval. |

## Recommended next work order

1. **Keep the approved pair-row MES tapes local-only** under `.gitignore` unless a separate large-artifact storage policy is approved.
   - The five approved rows are now mechanically foldable in this workspace.
   - The MES labels remain `verified:false` / unlabeled; do not promote MES expectations without allowed evidence and user approval.

2. **Re-grade 2025-12-12 next** because it has strong transcript support for the bias/grade but intentionally lacks allowed exact trade levels.
   - Preserve: 2/3-B bearish, no HTF vote.
   - Reconstruct from chart/tape: traded vehicle, model, side, entry array, stop invalidation level, TP1/TP2 draw.
   - Promote only after user approval.

3. **Only after that**, re-grade / record the retired candidate pair dates (`2026-01-29`, `2026-04-06`, `2026-06-15`, `2026-06-22`) from chart/tape + strategy rubric.
   - No old instrument/entry/SL/TP labels can be reused as truth.
   - If evidence is insufficient, keep `pending_review`.

4. **Do not wire or default-on any pair-leader behavior** until `scripts/fold-pair-leader.mjs` has a clean, scored corpus with paired tapes and approved oracle rows, plus an explicit implementation decision.

## Verification run for this kickoff

Commands run:

```bash
git status --short --branch
node scripts/fold-pair-leader.mjs
git log --oneline -- tests/tapes/2026-06-16-mes-ny-am-replay.tape.json
git cat-file -s 77e45c3:tests/tapes/2026-06-16-mes-ny-am-replay.tape.json
git show 77e45c3:tests/tapes/2026-06-16-mes-ny-am-replay.tape.json > tests/tapes/2026-06-16-mes-ny-am-replay.tape.json
node scripts/fold-pair-leader.mjs
rm tests/tapes/2026-06-16-mes-ny-am-replay.tape.json
```

Result:

- Branch created: `docs/rebuild-oracle-from-authority`
- Pair fold executed successfully but found `0` paired sessions because MES/candidate tapes are absent in this workspace.

## Verification run after local MES recording

Commands run:

```bash
./bin/tv record-tape --label tests/fixtures/stage-g-sessions/2026-06-09-mes-ny-am.label.json --from 09:30 --to 11:00 --fixture 2026-06-09-mes-ny-am-replay --out tests/tapes/2026-06-09-mes-ny-am-replay.tape.json
./bin/tv record-tape --label tests/fixtures/stage-g-sessions/2026-02-09-mes-ny-am.label.json --from 09:30 --to 11:00 --fixture 2026-02-09-mes-ny-am-replay --out tests/tapes/2026-02-09-mes-ny-am-replay.tape.json
./bin/tv record-tape --label tests/fixtures/stage-g-sessions/2026-06-17-mes-ny-am.label.json --from 09:30 --to 11:15 --fixture 2026-06-17-mes-ny-am-replay --out tests/tapes/2026-06-17-mes-ny-am-replay.tape.json
./bin/tv record-tape --label tests/fixtures/stage-g-sessions/2026-06-18-mes-ny-am.label.json --from 09:30 --to 11:00 --fixture 2026-06-18-mes-ny-am-replay --out tests/tapes/2026-06-18-mes-ny-am-replay.tape.json
git show 77e45c3:tests/tapes/2026-06-16-mes-ny-am-replay.tape.json > tests/tapes/2026-06-16-mes-ny-am-replay.tape.json
git diff --check
node scripts/fold-pair-leader.mjs
npm run tapes
npm run test
git status --ignored --short -- tests/tapes/*-mes-ny-am-replay.tape.json
```

Results:

- All four fresh MES recordings returned `success: true`, expected bar counts, and empty `warnings: []`.
- `node scripts/fold-pair-leader.mjs` exited 0 with `=== ARM TOTALS (5 paired sessions) ===`.
- `npm run tapes` exited 0: six tracked verified tapes passed; the five local MES tapes skipped as `verified:false` as intended.
- `npm run test` exited 0: root tests `1607 pass / 0 fail`; app tests `9 pass / 0 fail`.
- The MES tapes show as ignored local files (`!!`) and are not part of the commit.

## Current next target

The approved pair rows are now foldable locally. The next oracle-rebuild slice should be **2025-12-12 re-grade**:

1. Use allowed transcript/strategy evidence to preserve only the supported bias/grade facts.
2. Reconstruct instrument, side, entry, stop, and TP levels from chart/tape evidence.
3. Ask for user approval before promoting any exact oracle expectation.
4. Keep retired candidate dates (`2026-01-29`, `2026-04-06`, `2026-06-15`, `2026-06-22`) as `pending_review` until after 2025-12-12 is resolved.

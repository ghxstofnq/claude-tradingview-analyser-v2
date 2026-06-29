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

1. **Record fresh MES counterpart tapes** for the remaining approved MNQ/no-trade oracle rows that have no recoverable MES history:
   - `2026-02-09`
   - `2026-06-09`
   - `2026-06-17`
   - `2026-06-18`

   `2026-06-16` has local-only fold evidence from the recoverable historical MES blob; do not recommit that 64.8 MB tape unless a separate storage policy is approved.

2. **Re-run `node scripts/fold-pair-leader.mjs` after each new MES recording** and append row-level output here.
   - A clean paired corpus target is at least the five approved rows above.
   - Treat interim arm totals as anecdotal until the corpus has enough paired weeks.

3. **Re-grade 2025-12-12 after the approved rows are foldable** because it has strong transcript support for the bias/grade but intentionally lacks allowed exact trade levels.
   - Preserve: 2/3-B bearish, no HTF vote.
   - Reconstruct from chart/tape: traded vehicle, model, side, entry array, stop invalidation level, TP1/TP2 draw.
   - Promote only after user approval.

4. **Only after that**, re-grade the retired candidate pair dates (`2026-01-29`, `2026-04-06`, `2026-06-15`, `2026-06-22`) from chart/tape + strategy rubric.
   - No old instrument/entry/SL/TP labels can be reused as truth.
   - If evidence is insufficient, keep `pending_review`.

5. **Do not wire or default-on any pair-leader behavior** until `scripts/fold-pair-leader.mjs` has a clean, scored corpus with paired tapes and approved oracle rows.

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

## Current next recording target

Record fresh MES counterpart tapes for the four approved rows with no recoverable MES history:

1. `2026-02-09-mes-ny-am-replay.tape.json`
2. `2026-06-09-mes-ny-am-replay.tape.json`
3. `2026-06-17-mes-ny-am-replay.tape.json`
4. `2026-06-18-mes-ny-am-replay.tape.json`

After each recording, run `node scripts/fold-pair-leader.mjs`, append the new row-level output above, and keep any unapproved expectations `pending_review`.

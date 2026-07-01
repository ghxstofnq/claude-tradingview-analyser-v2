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

## 2025-12-12 re-grade slice 1 — transcript locked, exact levels blocked

Allowed evidence re-read:

- `docs/strategy/transcripts/How-I-Develop-Daily-Bias-12122025-CLASS-kix1SDRSCiU-formatted-transcript.md:65-99`
- `docs/strategy/daily-bias.md:12-30`, `docs/strategy/daily-bias.md:104-120`
- `docs/strategy/entry-models.md:89-115`
- `docs/strategy/confirmation.md:13-39`
- `docs/strategy/risk-and-management.md:41-52`
- `docs/strategy/lanto-oracle.md:186-213` only as the already-audited transcript summary / caution, not as a source for retired exact levels.

Transcript-grounded facts that remain promotable:

| Fact | Evidence | Action |
|---|---|---|
| HTF was **not** a vote | Lanto: “the whole week we didn't have a clear ultra higher time frame look” and “we didn't end up using higher time frame today … there wasn't anything massive” (`transcript:71`, `transcript:83-85`) | Preserve `no HTF vote` |
| Overnight was **bearish** | Asia/London/overnight described as bearish; London lows were the key level (`transcript:65`, `transcript:83-85`) | Preserve bearish overnight vote |
| NY-open reaction was **bearish** | Price swept London lows, then the 9:40 5m sequence displaced back down and confirmed downside (`transcript:65`, `transcript:69`) | Preserve bearish open-reaction vote |
| Grade was **B / 2 of 3** | Lanto defines 2/3 as tradable but not A+ (`transcript:71-73`; `daily-bias.md:20-30`) | Preserve `grade: B` |
| Reversal long was rejected | London-low sweep alone was not enough; no major bullish displacement, overnight stayed bearish (`transcript:83-95`) | Do not promote any long oracle |
| Trade direction clue is short; exact trade still unapproved | Lanto compares ES vs NQ at ~9:59/10:00 “confirmation off this trade” and says ES showed more aggressive sell (`transcript:97-99`) | Treat ES/MES short as a working clue only; do not promote exact levels |

Chart/tape evidence attempt:

```bash
./bin/tv record-tape \
  --label state/regrades/2025-12-12-mes-regrade-working.label.json \
  --from 09:30 --to 11:00 \
  --fixture 2025-12-12-mes-ny-am-regrade-working \
  --out tests/tapes/2025-12-12-mes-ny-am-replay.tape.json
```

Result:

```text
Replay date unavailable: The selected date is not available for playback. The chart was moved to the first point available for playback. The requested date has no data for this timeframe.
```

Fallback `capture-replay` / TradingView WebSocket checks also failed to produce usable intraday evidence:

- `./bin/tv capture-replay --label state/regrades/2025-12-12-mes-label-est.json --out state/regrades/2025-12-12-mes-capture-1000-est.json --force`
  - validation blockers: `missing bars_by_tf.h4`, `missing bars_by_tf.h1`, `missing bars_by_tf.m15`, `missing bars_by_tf.m5`, `missing bars_by_tf.m1`.
- Direct TradingView WebSocket pull for `CME_MINI:MES1!` 1m did not reach the 2025 session; returned only recent June 2026 intraday rows.
- Explicit `CME_MINI:MESZ2025` 1m did not include 2025-12-12; first returned intraday row was `2025-12-14T23:00:00Z`.

Decision for this slice: **NOT READY to promote exact oracle levels.**

Keep `tests/fixtures/stage-g-sessions/2025-12-12-mes-ny-am-trend-short.label.json` as `needs_gxofnq_review` with exact `model`, `side`, `entry`, `stop`, `tp1`, and `tp2` unpromoted. The transcript supports the day-level read — bearish 2/3-B, no HTF vote, no long reversal — but the exact execution packet still needs chart/tape evidence or explicit user approval.

## Recent-date oracle rebuild pivot — 2026-06-29

User approved pivoting the exact oracle rebuild away from unavailable historical MES replay and toward recent sessions from the last two months. `2025-12-12` remains a **transcript-only calibration case** unless a usable intraday chart/tape source appears.

Promotion policy for any exact oracle row:

1. **Allowed authority only:** `docs/strategy/*.md`, `docs/strategy/transcripts/*.md`, chart/tape evidence, and/or explicit user approval. Retired callout / alerted-trade-derived material cannot assign exact truth.
2. **Paired evidence preferred:** MNQ and MES tapes must exist for the same session/window, or the row must be explicitly documented as single-instrument-only.
3. **Exact packet required:** model, side, entry, stop, TP1/TP2, grade, first-packet timestamp, and outcome must be tied to chart/tape evidence or an approved strategy-oracle doc row.
4. **Approval before mutation:** do not flip labels/tape expectations out of `unlabeled`, `needs_gxofnq_review`, or stale expectation states until the exact packet is shown to the user and approved.
5. **Verification gate:** after any approved promotion, run `npm run tapes`, `node scripts/fold-pair-leader.mjs`, and `npm run test`.

Phase-1 candidate deck:

| Batch | Date | Session | Current state | Action |
|---|---|---|---|---|
| A | `2026-06-09` | NY-AM | paired tapes exist; tracked MNQ tape expectation conflicts with corrected `lanto-oracle.md` exact row | prepare correction packet; do not promote stale tape expectation |
| A | `2026-06-16` | NY-AM | paired tapes exist; fixture aligns better with `lanto-oracle.md` than tracked tape expectation | prepare correction packet |
| A | `2026-06-17` | NY-AM | paired tapes exist; no-trade row aligns with `lanto-oracle.md` | keep as seed no-trade candidate pending final approval |
| A | `2026-06-18` | NY-AM | paired tapes exist; fixture aligns better with `lanto-oracle.md` than tracked tape expectation | prepare correction packet |
| B | `2026-06-12` | NY-AM | persisted recent long candidate in `state/session` | record/complete paired tapes, then hand-grade |
| B | `2026-06-22` | NY-AM | recent no-setup/no-trade candidate | record paired tapes, then hand-grade no-trade or reject |
| B | `2026-06-23` | NY-AM | recent no-setup/no-trade candidate | record paired tapes, then hand-grade no-trade or reject |
| C | `2026-06-19` | NY-AM | ambiguous/multiple setup candidates in `state/session` | stress-day review; likely review-only until clarified |
| C | `2026-06-24` | NY-AM | unverified MNQ long tape candidate; MES missing | record MES counterpart and hand-grade |
| C | `2026-06-29` | NY-AM | very recent bearish/no-setup context | use after session completeness/replay stability is verified |

Phase-1 target is **6–8 high-confidence rows**, not all candidates. Desired balance: 2–3 longs, 2–3 shorts, 2 no-trades, at least one A+, at least two B-grade rows, and at least one MNQ/MES disagreement row if evidence supports it.

### Batch A seed sanity result

Batch A review packets were written under `docs/audits/recent-oracle-packets/` for:

- `2026-06-09-ny-am.md`
- `2026-06-16-ny-am.md`
- `2026-06-17-ny-am.md`
- `2026-06-18-ny-am.md`

Key finding: the existing fold is mechanically runnable, but three tracked MNQ tape expectations are **not safe as final oracle truth** without correction/approval because they conflict with the corrected strategy-oracle rows:

| Date | Existing tape expectation | Corrected oracle row in `docs/strategy/lanto-oracle.md` | Batch A recommendation |
|---|---|---|---|
| `2026-06-09` | Inversion short A+ at `29964.75 / 30027.75 / 29751.25` | Option A evidence-backed Inversion short B at `29760 / 29818.75 / 29595.25`, TP2 `29113.75`, first valid packet `2026-06-09T14:27:00Z` | **Correct before promotion** |
| `2026-06-16` | Trend short B at `30864.25 / 30889 / 30750.75` | Reversal/MSS-leg FVG short B; later fresh/user-corrected no-lookahead packet is entry `30864.25`, stop `30905`, TP1 `30750.75`; NYAM.L `30561.75` is runner/outcome context, not executable packet TP2 | **Correct before promotion** |
| `2026-06-17` | no-trade | no-trade on price-quality veto despite bearish directional read | **Seed candidate** |
| `2026-06-18` | Inversion long B at `30470.25 / 30411 / 30615` | Continuation/Trend long B at `30452.75 / 30400 / 30615` | **Correct before promotion** |

Decision: **do not treat current Batch A fold totals as final performance evidence yet.** The fold currently scores stale tape expectations for 06-09/06-16/06-18. Next step is to get explicit user approval for the corrected Batch A packets, then update labels/tape expectations and re-run the fold/tests.

### Batch A approval application — 2026-06-29

User approved all four Batch A packets. Applied the approval conservatively:

| Date | Applied change | Verification state |
|---|---|---|
| `2026-06-09` | Option A replaced the inconsistent A+ target with the evidence-backed `Inversion short B` packet: entry `29760`, stop `29818.75`, TP1 `29595.25`, TP2 `29113.75` | `verified:true` once the chain suppresses the stale 10:00 ET low-coherence inversion latch |
| `2026-06-16` | Superseded by fresh/user-corrected no-lookahead row: `MSS`/reversal short B, entry `30864.25`, stop `30905`, TP1 `30750.75`, TP2 executable `null`; NYAM.L `30561.75` retained as runner/outcome context | `verified:true` after the 06-16 fresh-context MSS regression and full gate passed; the older `30896 / 30783 / 30561.75` executable expectation is stale |
| `2026-06-17` | Added approval metadata to the no-trade tape expectation | Remains `verified:true`; chain emits no packet |
| `2026-06-18` | Updated tracked MNQ tape expectation to approved `Trend` long B packet: entry `30452.75`, stop `30400`, TP1 `30615` | `verified:false` because the current deterministic chain still emits a later `Inversion` long at `30470.25` |

`verified:false` here is intentional: it means the oracle truth is approved, but the current deterministic chain has not yet earned a green regression on those rows. The next implementation slice should align the walker with the approved packets, then flip the relevant tapes back to `verified:true` only after `npm run tapes` passes against the approved expectations.

`node scripts/fold-pair-leader.mjs` was updated so primary MNQ tapes with `verified:false` are skipped as `PRIMARY tape unverified (approved oracle pending chain alignment)`, rather than scoring stale first-packet output as if it were final performance evidence.

Verification after applying approval:

```text
node scripts/fold-pair-leader.mjs → ARM TOTALS (2 paired sessions); 06-09/06-16/06-18 skipped as primary-unverified, 06-17 no-trade + 02-09 long remain foldable.
npm run tapes → 3 PASS, 9 unverified skipped.
npm run test → root 1607 pass / 0 fail; app 9 pass / 0 fail.
```

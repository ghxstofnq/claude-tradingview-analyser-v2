# Cleanup hygiene audit — generated artifacts + scripts

Date: 2026-06-29
Branch at audit time: `chore/remove-lanto-callout-authority`
Scope: read-only audit of local/generated artifacts, gitignore hygiene, and tracked scripts that may be leftovers from previous work.

## Executive summary

The repo is in a generally safe state for generated artifacts: the large local/generated directories found in the working tree are ignored and have **0 tracked files**. There are also **0 untracked files not covered by `.gitignore`**.

The main cleanup opportunity is the `scripts/` directory:

- 86 tracked scripts exist under `scripts/`.
- 46 scripts have no package-script reference and no tracked text reference outside themselves.
- The largest clusters are diagnostic/research-style scripts:
  - `diag-*`: 14 files
  - `trace-*`: 7 files
  - `grade-*`: 5 files
  - `fold-*`: 10 files total, mixed reusable + one-off

Do **not** delete them blindly. Several unreferenced scripts still have useful headers and may be reusable research/operator tools. The next safe step is to split scripts into supported/operator tools vs research diagnostics, then prune only confirmed one-offs.

## Current repo safety context

`git status --short --branch` showed substantial existing strategy-authority work already in progress on `chore/remove-lanto-callout-authority`. This audit intentionally did not modify those files.

Existing modified areas included strategy docs, walker files, labels/fixtures, and tests. Keep cleanup changes separate from strategy/oracle changes when possible.

## Artifact audit

Method:

- Checked tracked files with `git ls-files`.
- Checked ignored local files with `git ls-files -o -i --exclude-standard`.
- Checked nonignored untracked files with `git ls-files -o --exclude-standard`.
- Calculated local disk sizes for candidate generated/local paths.

### Summary table

| Path | Tracked files | Ignored local files | Local size | Classification | Recommendation |
|---|---:|---:|---:|---|---|
| `state/` | 0 | 1509 | 2,765,133,575 bytes | IGNORE / MANUAL-REVIEW | Keep ignored. Consider manual local cleanup or archive if disk pressure; do not commit. |
| `screenshots/` | 0 | 18 | 6,334,276 bytes | IGNORE / MANUAL-REVIEW | Keep ignored. Move only selected evidence screenshots into docs if intentionally useful. |
| `graphify-out/` | 0 | 28 | 3,804,140 bytes | DELETE-CANDIDATE local only | Generated analysis output. Safe candidate for local cleanup after confirming no active viewer needs it. |
| `.understand-anything/` | 0 | 65 | 4,711,388 bytes | DELETE-CANDIDATE local only | Generated tool output/cache. Safe candidate for local cleanup after confirming no active run needs it. |
| `auto-research/` | 0 | 5 | 25,425 bytes | MANUAL-REVIEW | Ignored research scratch. If valuable, promote summary to `docs/research/`; otherwise local cleanup candidate. |
| `config/` | 0 | 1 | 87 bytes | KEEP ignored | Machine-local config. Keep ignored. |
| `headroom_memory.db` | 0 | 1 | 57,344 bytes | KEEP ignored | Machine-local DB. Keep ignored. |
| `.claude/launch.json` | 0 | 1 | 239 bytes | KEEP ignored | Machine-local Claude config. Keep ignored. |
| `.impeccable/` | 0 | 1 | 8,771 bytes | KEEP ignored | Local tool cache. Keep ignored. |

### Artifact findings

1. **No tracked generated artifacts found in the main generated paths.**
   - `state/`, `screenshots/`, `graphify-out/`, `.understand-anything/`, `auto-research/`, `config/`, `headroom_memory.db`, `.claude/launch.json`, and `.impeccable/` all had 0 tracked files.

2. **`.gitignore` is doing its job for the inspected local paths.**
   - `git ls-files -o --exclude-standard` returned count `0`.

3. **`state/` is large locally.**
   - About 2.76 GB of ignored local state/backtest output exists.
   - This is not a git hygiene problem, but it is a local disk/review ergonomics problem.

### Artifact recommendations

- No immediate git changes required for generated artifacts.
- Optional local-only cleanup, after user approval:
  - delete/archive `graphify-out/`
  - delete/archive `.understand-anything/`
  - review `auto-research/` and promote any useful summary into `docs/research/`
  - prune old `state/backtest/*` runs if not needed for current comparisons
- Keep `.gitignore` entries for generated/local paths as-is.

## Script audit

Method:

- Enumerated tracked `scripts/*.js` and `scripts/*.mjs` files.
- Searched tracked text files for each script basename/path outside the script itself.
- Checked whether each script is referenced by root `package.json` scripts.
- Classified by evidence only; no deletion performed.

### Script inventory

- Total tracked scripts: 86
- By prefix:
  - `diag-*`: 14
  - `fold-*`: 10
  - `trace-*`: 7
  - `grade-*`: 5
  - `verify-*`: 4
  - `refold-*`: 3
  - `run-*`: 3
  - many singletons (`new-fixture`, `smoke-fixtures`, `real-review`, etc.)

### Supported / keep by direct package entrypoint

These are referenced by root `package.json` scripts and should be treated as supported unless deliberately replaced:

| Script | Package script / role | Classification |
|---|---|---|
| `scripts/run-root-tests.mjs` | `npm run test:unit` | KEEP |
| `scripts/smoke-fixtures.js` | `npm run smoke:fixtures` | KEEP |
| `scripts/verify-citations.js` | `npm run verify:citations` | KEEP |
| `scripts/fixture-coverage.js` | `npm run fixture:coverage` | KEEP |
| `scripts/new-fixture.js` | `npm run fixture:new` | KEEP |
| `scripts/judge-report.js` | `npm run judge:report` | KEEP |
| `scripts/replay-runner.js` | `npm run replay` | KEEP |
| `scripts/real-review.js` | `npm run review:real`, `npm run verify:grading` | KEEP |
| `scripts/tape-runner.js` | `npm run tapes` | KEEP |
| `scripts/make-parity-fixture.mjs` | `npm run parity:add` | KEEP |

### Keep / document because referenced by app, tests, commands, or docs

These are not necessarily package entrypoints, but have tracked references and should not be pruned without deeper review:

| Script | Evidence | Classification |
|---|---|---|
| `scripts/diff-bundle.js` | Referenced by `CLAUDE.md`, webview docs, and `tests/diff-bundle.test.js` | KEEP / document |
| `scripts/diff-prompt-shape.js` | Referenced by prompt-cache docs and `scripts/snapshot-prompts.js` | KEEP / document |
| `scripts/snapshot-prompts.js` | Referenced by prompt-cache docs and `CLAUDE.md` | KEEP / document |
| `scripts/verify-prompts-byte-identical.js` | Referenced by prompt-cache docs and `tests/system-prompt-partials.test.js` | KEEP / document |
| `scripts/fold-week.mjs` | Referenced by app backtest code, docs, and other scripts | KEEP / document |
| `scripts/fold-bias.mjs` | Referenced by app backtest baseline | KEEP / document |
| `scripts/fold-tape.mjs` | Referenced by deterministic backtest test | KEEP / document |
| `scripts/fold-live-corpus.mjs` | Referenced by `.claude/commands/fold-test.md` and current task docs | KEEP / document |
| `scripts/fold-pair-leader.mjs` | Referenced by current task docs and currently modified | KEEP until current branch settles |
| `scripts/save-fold-test.mjs` | Referenced by app UI/backtest hook and `.claude/commands/fold-test.md` | KEEP |
| `scripts/save-fold-baseline.mjs` | Referenced by `.claude/commands/fold-test.md` and baseline code | KEEP |
| `scripts/run-backtest-headless.js` | Referenced by app/backtest deps and record-corpus scripts | KEEP |
| `scripts/run-week-proof.mjs` | Referenced by replay recovery and audit docs | KEEP / document |
| `scripts/promote-day-tape.js` | Referenced by `CLAUDE.md` and bar-close code | KEEP |
| `scripts/refold-gate.mjs` | Referenced by `.claude/commands/fold-test.md`, audits, and other scripts | KEEP / document |
| `scripts/refold-run.js` | Referenced by `CLAUDE.md`, plans, and regen script | KEEP / document |
| `scripts/analyze-patterns.mjs` | Referenced by backtest analytics and dashboard plan | MANUAL-REVIEW |
| `scripts/five-m-confirm-sim.mjs` | Referenced by `docs/audits/regrade-june-8-12.md` | MANUAL-REVIEW / historical |
| `scripts/reclaim-gate-test.mjs` | Referenced by audit docs and `fold-week` | MANUAL-REVIEW |
| `scripts/refresh-tape-briefs.mjs` | Referenced by audit docs | MANUAL-REVIEW / historical |
| `scripts/trade-dump.mjs` | Referenced by audit docs | MANUAL-REVIEW / historical |
| `scripts/verify-scale-in-parity.mjs` | Referenced by live tranche execution plan | MANUAL-REVIEW |
| `scripts/spike-tv-paper.mjs` | Referenced by execution-engine docs | MANUAL-REVIEW / spike |

### Unreferenced script candidates

These had no package-script reference and no tracked text reference outside themselves at audit time. That does **not** prove they are unused; it means they need owner review before they stay in the supported tool surface.

#### Likely one-off diagnostic/research candidates

These are the highest-confidence cleanup candidates because their names and headers indicate targeted investigations:

- `scripts/diag-disp.mjs`
- `scripts/diag-draw-dist.mjs`
- `scripts/diag-inv-side.mjs`
- `scripts/diag-inversion-confirm.mjs`
- `scripts/diag-inversion-fvg.mjs`
- `scripts/diag-loss-times.mjs`
- `scripts/diag-month-week.mjs`
- `scripts/diag-near-draw.mjs`
- `scripts/diag-parity-corpus.mjs`
- `scripts/diag-pillar3-models.mjs`
- `scripts/diag-regime.mjs`
- `scripts/diag-stop-then-tp.mjs`
- `scripts/diag-stops.mjs`
- `scripts/diag-structure.mjs`
- `scripts/trace-0129-confirm.mjs`
- `scripts/trace-0129-mes.mjs`
- `scripts/trace-0129-zone.mjs`
- `scripts/trace-0615-detect.mjs`
- `scripts/trace-bias.mjs`
- `scripts/trace-inv-gate.mjs`
- `scripts/trace-mss.mjs`
- `scripts/winner-loser-study.mjs`

Recommended action: move to an archive folder or delete after confirming no active branch/task relies on them. If the findings are still valuable, preserve a markdown summary in `docs/research/` or `docs/audits/` before deleting executable scripts.

#### Unreferenced fold/grade/calibration candidates

These may encode useful experimental folds, but are not discoverable from package scripts/docs:

- `scripts/add-5m-track.mjs`
- `scripts/backtag-run-symbols.mjs`
- `scripts/calib-pillar2.mjs`
- `scripts/fold-near-band.mjs`
- `scripts/fold-trend-fvgstop.mjs`
- `scripts/grade-1002.mjs`
- `scripts/grade-1m.mjs`
- `scripts/grade-htf.mjs`
- `scripts/grade-session.mjs`
- `scripts/grade-snapshot.mjs`
- `scripts/pm-grade-test.mjs`
- `scripts/validate-pillar1.mjs`
- `scripts/validate-coherence.mjs`
- `scripts/tune-leader-metric.mjs`

Recommended action: classify as either supported research tools or historical one-offs. If supported, add them to `scripts/README.md` with exact usage and expected inputs. If historical, archive/delete.

#### Unreferenced operator/backtest/corpus candidates

These look potentially useful but are not documented/discoverable enough:

- `scripts/drive-app-backtest.mjs`
- `scripts/rebuild-backtest-library.mjs`
- `scripts/record-corpus-batch.mjs`
- `scripts/record-corpus.mjs`
- `scripts/refold-week.mjs`
- `scripts/refresh-tape-context.mjs`
- `scripts/regen-payloads.mjs`
- `scripts/sweep-fold.mjs`
- `scripts/time-gate-test.mjs`
- `scripts/trade-report.mjs`
- `scripts/verify-live-parity.mjs`
- `scripts/promote-stage-g-tapes.mjs`

Recommended action: keep only if they are still part of an operator/backtest workflow. Otherwise archive/delete after extracting any reusable logic.

## Recommended cleanup plan

### Phase A — documentation only, low risk

1. Add `scripts/README.md` with three sections:
   - Supported operator/test scripts
   - Research/diagnostic scripts
   - Historical/retired scripts
2. Link package scripts to that README.
3. Do not delete anything yet.

### Phase B — local generated cleanup, user-approved

1. Delete or archive local-only generated dirs if user wants disk cleanup:
   - `graphify-out/`
   - `.understand-anything/`
2. Review `auto-research/` manually:
   - promote useful notes to `docs/research/`
   - delete ignored scratch files only after review
3. Consider pruning old `state/backtest/*` runs locally after confirming current baselines/fixtures do not depend on them.

### Phase C — script pruning, conservative

1. Start with `diag-*` and `trace-*` scripts.
2. For each candidate:
   - read header
   - search exact basename/path references
   - check whether current branch/task needs it
   - if useful, document it in `scripts/README.md`
   - if spent, delete it in a dedicated commit
3. Run after each pruning batch:
   - `npm test`
   - `npm run smoke:fixtures` if strategy/fixture-related scripts were touched
   - `git diff --check`

### Phase D — supported command surface

After pruning/classification, add a small guard test that package-script entrypoints and documented supported scripts exist. This prevents docs/scripts from drifting again.

## Do not clean automatically

Do not automatically remove:

- strategy evidence
- fixture labels
- source-health checks
- backtest/replay gates
- risk controls
- broker/execution reconciliation logic
- tests protecting strategy faithfulness

Ponytail-style minimization is useful here only after safety and provenance are preserved.

## Proposed first deletion batch, pending user approval

If the user wants to proceed after this report, the safest first prune batch is likely the no-reference diagnostic/trace group:

```text
scripts/diag-*.mjs
scripts/trace-*.mjs
scripts/winner-loser-study.mjs
```

But only after a final per-file check and after deciding whether any findings should be preserved as markdown under `docs/research/` or `docs/audits/`.

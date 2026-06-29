# Scripts guide

This directory contains supported operator/test scripts plus a small number of documented diagnostics. Treat this file as the first stop before running or pruning anything here.

Generated from:

- `docs/audits/2026-06-29-cleanup-hygiene-audit.md`
- `docs/audits/2026-06-29-script-prune-review.md`

## Rules

- Do not delete scripts only because they are not package scripts; some are invoked by `.claude/commands/*`, tests, docs, or app code.
- Do not delete strategy/replay/backtest scripts without checking current branch work and fixture provenance.
- Prefer documenting a useful script over leaving it as an unexplained one-off.
- If a script is only a spent investigation, preserve any enduring finding in `docs/research/` or `docs/audits/` before pruning.

## Supported package entrypoints

These are directly wired from root `package.json` and are part of the supported tool surface.

| npm command | Script | Purpose |
|---|---|---|
| `npm run test:unit` | `run-root-tests.mjs` | Dynamic root Node test runner. |
| `npm run smoke:fixtures` | `smoke-fixtures.js` | Fixture smoke checks. |
| `npm run verify:citations` | `verify-citations.js` | Verify citation formatting/coverage. |
| `npm run fixture:coverage` | `fixture-coverage.js` | Fixture coverage report. |
| `npm run fixture:new` | `new-fixture.js` | Create a new fixture scaffold. |
| `npm run judge:report` | `judge-report.js` | Judge/report helper. |
| `npm run replay` | `replay-runner.js` | Replay runner. |
| `npm run review:real` | `real-review.js` | Real-session review. |
| `npm run verify:grading` | `real-review.js --verify-grading` | Grading verification. |
| `npm run tapes` | `tape-runner.js` | Tape runner. |
| `npm run parity:add` | `make-parity-fixture.mjs` | Add parity fixture. |

## Referenced internal/support scripts

These are referenced by app code, tests, `.claude/commands`, or docs. They are not safe prune candidates without deeper review.

| Group | Scripts |
|---|---|
| Prompt/cache helpers | `snapshot-prompts.js`, `diff-prompt-shape.js`, `verify-prompts-byte-identical.js` |
| Bundle/diff helpers | `diff-bundle.js` |
| Fold/backtest helpers | `fold-week.mjs`, `fold-bias.mjs`, `fold-tape.mjs`, `fold-live-corpus.mjs`, `fold-pair-leader.mjs`, `save-fold-test.mjs`, `save-fold-baseline.mjs`, `run-backtest-headless.js`, `run-week-proof.mjs`, `refold-gate.mjs`, `refold-run.js` |
| Tape/promotion helpers | `promote-day-tape.js`, `recapture-mnq-briefs.mjs`, `refresh-tape-briefs.mjs` |
| Historical/manual review | `analyze-patterns.mjs`, `five-m-confirm-sim.mjs`, `reclaim-gate-test.mjs`, `trade-dump.mjs`, `verify-scale-in-parity.mjs`, `spike-tv-paper.mjs` |

## Retained diagnostics

These are not package entrypoints, but they were retained because they are general-purpose diagnostics rather than spent one-off probes.

| Script | Purpose |
|---|---|
| `diag-parity-corpus.mjs` | Corpus-wide live-vs-backtest parity measurement. |
| `trace-bias.mjs` | Per-bar LTF bias trace for diagnosing wrong-side sessions. |
| `trace-inv-gate.mjs` | General inversion-gate diagnostic for any tape. |
| `trace-mss.mjs` | MSS walker/packet trace over the pinned corpus. |

## Remaining scripts needing owner classification

These are still candidates for a later cleanup pass. They were not touched in the first prune batch because they may encode operator/backtest workflows or experimental folds.

### Experimental fold/grade/calibration scripts

- `add-5m-track.mjs`
- `backtag-run-symbols.mjs`
- `calib-pillar2.mjs`
- `fold-near-band.mjs`
- `fold-trend-fvgstop.mjs`
- `grade-1002.mjs`
- `grade-1m.mjs`
- `grade-htf.mjs`
- `grade-session.mjs`
- `grade-snapshot.mjs`
- `pm-grade-test.mjs`
- `validate-pillar1.mjs`
- `validate-coherence.mjs`
- `tune-leader-metric.mjs`

### Operator/backtest/corpus scripts needing owner classification

- `drive-app-backtest.mjs`
- `rebuild-backtest-library.mjs`
- `record-corpus-batch.mjs`
- `record-corpus.mjs`
- `refold-week.mjs`
- `refresh-tape-context.mjs`
- `regen-payloads.mjs`
- `sweep-fold.mjs`
- `time-gate-test.mjs`
- `trade-report.mjs`
- `verify-live-parity.mjs`
- `promote-stage-g-tapes.mjs`

## Pruning process

For each candidate batch:

1. Read the script header.
2. Search exact basename/path references.
3. Decide: `KEEP`, `DOCUMENT`, `ARCHIVE`, or `DELETE-CANDIDATE`.
4. Preserve useful findings in docs before deleting executables.
5. Run:

```bash
npm test
npm run smoke:fixtures
git diff --check
```

Do not prune strategy evidence, source-health checks, risk controls, or tests protecting strategy faithfulness just to reduce file count.

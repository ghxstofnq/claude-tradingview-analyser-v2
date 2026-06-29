# Operator/backtest/corpus script owner audit

Date: 2026-06-29
Branch at review time: `chore/remove-lanto-callout-authority`
Base checkpoint: `f93623f chore: prune spent experimental scripts`
Scope: final sensitive script-cleanup batch from `scripts/README.md` / `docs/audits/2026-06-29-cleanup-hygiene-audit.md`.

## Method

For each candidate script, checked:

- exact basename/path references in tracked text files
- references from root `package.json` scripts
- app/test imports and docs/command references
- header/comments and import shape
- whether it was read-only, local-state mutating, fixture/tape mutating, or TV/app-driving

The reference scan excluded cleanup docs/README so reports did not create false usage.

## Result

- 12 files reviewed.
- 8 files retained and documented as operator/report/parity helpers or high-risk manual-review tools.
- 4 files classified as spent hardcoded experiments/migrations and pruned.

## Retained scripts

| Script | Classification | Reason |
|---|---|---|
| `scripts/drive-app-backtest.mjs` | DOCUMENT — app-driven operator | Drives the running app via renderer CDP so the app remains the single owner of the TradingView chart. Useful but requires app/CDP readiness and writes backtest state. |
| `scripts/rebuild-backtest-library.mjs` | MANUAL-REVIEW — high-risk state rebuild | Resets `state/backtest/index.json`, writes clean runs, and neutralizes orphan folders. Keep documented, but run only when intentionally rebuilding local backtest library state. |
| `scripts/record-corpus-batch.mjs` | DOCUMENT — corpus recorder | Long-lived `runBacktest` loop for recording multiple sessions through `PROD_DEPS`; useful operator path for corpus capture. |
| `scripts/record-corpus.mjs` | MANUAL-REVIEW — legacy corpus recorder | Hardcoded repo path and shells out to `run-backtest-headless.js` once per session. It has a market-hours guard and resumability, but its process strategy conflicts with `record-corpus-batch.mjs`; keep until a single canonical recorder is chosen. |
| `scripts/regen-payloads.mjs` | DOCUMENT — state maintenance | Dry-run by default; with `--write`, backs up and regenerates `brief-payloads.json` from `brief-bundle.json`. Useful after direct-session-brief changes, but state-mutating when written. |
| `scripts/sweep-fold.mjs` | DOCUMENT — read-only fold/report | Read-only faithful corpus fold for one symbol with carry+regen and temp state dirs. Useful for parameter sweeps in throwaway worktrees. |
| `scripts/trade-report.mjs` | DOCUMENT — report helper | Per-trade carry-refold report for selected dates. Writes only to a report state dir; useful for manual review. |
| `scripts/verify-live-parity.mjs` | DOCUMENT / MODERNIZE-LATER — parity diagnostic | Live resolver vs recorded backtest parity check for HTF fallback. It has hardcoded expected-session commentary, but it protects a live/backtest equivalence concern; keep until replaced by an automated, assertion-backed parity gate. |

## Pruned scripts

These had no package entrypoint and no tracked references outside cleanup docs. They were hardcoded, historical, or one-time state/tape migration helpers.

| Script | Reason pruned |
|---|---|
| `scripts/refold-week.mjs` | Hardcoded June 1-5 scale-in comparison; superseded by general fold/report tools. |
| `scripts/refresh-tape-context.mjs` | Hardcoded Stage-G tape context migration from a past `contextFromLabel` change; state-mutating and no current caller. Recover from git history if needed. |
| `scripts/time-gate-test.mjs` | Historical time-of-day gate experiment with hardcoded 5-week baseline; no current caller. |
| `scripts/promote-stage-g-tapes.mjs` | One-time Stage-G tape promotion/freezing migration; dangerous to leave as an easy baseline-moving script. |

## Safety notes

- No package entrypoints were pruned.
- No app/test/import references were pruned.
- No strategy docs, fixtures, tapes, risk controls, source-health checks, or tests were deleted.
- Parity/execution-adjacent checks were retained rather than pruned unless they were clearly one-time baseline-moving migrations.
- Retained state-mutating operators are now documented with risk labels in `scripts/README.md`.

## Verification results

After pruning, ran:

```bash
GOFNQ_STATE_DIR=$(mktemp -d) npm test
npm run smoke:fixtures
git diff --check
```

Results:

- `GOFNQ_STATE_DIR=$(mktemp -d) npm test` — passed (`1607` root tests + `9` app tests).
- `npm run smoke:fixtures` — passed (`22/22` checks across `14` fixtures).
- `git diff --check && git diff --cached --check` — passed.
- Deleted-script reference scan — passed (`0` unexpected references outside audit docs).

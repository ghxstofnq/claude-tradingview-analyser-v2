# Script prune review — experimental fold/grade/calibration batch

Date: 2026-06-29
Branch at review time: `chore/remove-lanto-callout-authority`
Base checkpoint: `ae394c7 chore: prune spent diagnostic scripts`
Scope: second conservative pruning batch from `scripts/README.md` / `docs/audits/2026-06-29-cleanup-hygiene-audit.md`.

## Method

For each candidate script, checked:

- exact basename/path references in tracked text files
- references from root `package.json` scripts
- header/comments and import shape
- whether the script looked like a reusable manual-validation tool or a spent one-off migration/calibration probe

The reference scan excluded cleanup docs/README so they did not create false usage.

## Result

- 14 files reviewed.
- 12 files classified as spent experimental scripts and pruned.
- 2 files retained as reusable manual-validation helpers and documented in `scripts/README.md`.

## Retained manual-validation helpers

| Script | Reason retained |
|---|---|
| `scripts/grade-snapshot.mjs` | One-shot replay snapshot for hand-grading / fixture-oracle evidence capture. Useful for future provenance audits because it dumps engine evidence + OHLC rather than making a trading decision. |
| `scripts/validate-coherence.mjs` | Small, wedge-resistant Pillar-2 coherence validator using 15m closes. Useful as an evidence check and referenced conceptually by `grade-snapshot.mjs`. |

## Pruned scripts

These had no package entrypoint and no tracked references outside cleanup docs. They appeared to be spent one-off migrations, calibration folds, or stale oracle probes.

| Script | Header/purpose summary | Reason pruned |
|---|---|---|
| `scripts/add-5m-track.mjs` | One-time migration adding a 5m structure track to MNQ corpus tapes. | State-mutating corpus migration; no refs; should not remain as a loose operator script. Recover from git history if ever needed. |
| `scripts/backtag-run-symbols.mjs` | One-time migration stamping backtest runs with recovered symbols. | Spent state migration; no refs. |
| `scripts/calib-pillar2.mjs` | Stage-B Pillar-2 calibration probe. | Historical calibration probe; no refs. |
| `scripts/fold-near-band.mjs` | Calibration fold for `GOFNQ_NEAR_PRICE_PCT`. | Historical env-lever sweep; no refs. |
| `scripts/fold-trend-fvgstop.mjs` | Test Trend FVG-candle stop override. | Historical feature-fold probe; no refs. |
| `scripts/grade-1002.mjs` | No durable header; local replay/grade probe. | Undocumented one-off. |
| `scripts/grade-1m.mjs` | 1m entry-pin probe. | Historical calibration probe; no refs. |
| `scripts/grade-htf.mjs` | HTF-vote audit probe. | Historical audit probe; no refs. |
| `scripts/grade-session.mjs` | Full-session setup-finder over replay. | Superseded by retained snapshot/evidence helpers; name risks implying a second setup brain. |
| `scripts/pm-grade-test.mjs` | Force every PM trade to grade B and report 5-week result. | Historical outcome experiment; no refs. |
| `scripts/validate-pillar1.mjs` | Stage-C validation with hardcoded old oracle expectations. | Stale oracle probe; hardcoded expectations risk confusing current strategy-authority cleanup. |
| `scripts/tune-leader-metric.mjs` | A/B candidate leader metrics against a 9-session paired corpus and Lanto picks. | Historical tuning probe tied to retired/fragile authority assumptions. |

## Safety notes

- No package entrypoints were pruned.
- No app/test/import references were pruned.
- No strategy docs, fixtures, risk controls, source-health checks, or tests were deleted.
- The retained helpers are documented as evidence/manual-validation tools, not setup authorities.

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

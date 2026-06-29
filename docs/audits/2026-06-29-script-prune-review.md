# Script prune review — diag/trace batch

Date: 2026-06-29
Branch at review time: `chore/remove-lanto-callout-authority`
Scope: first conservative pruning batch from `docs/audits/2026-06-29-cleanup-hygiene-audit.md`.

## Method

For each candidate script, checked:

- exact basename/path references in tracked text files
- references from root `package.json` scripts
- header/comments and import shape
- whether the script looked like a reusable diagnostic or a spent one-off/research probe

The reference scan excluded the cleanup docs added during this audit (`docs/audits/2026-06-29-cleanup-hygiene-audit.md` and `scripts/README.md`) so they did not create false usage.

## Result

- 22 files reviewed.
- 18 files classified as spent one-off diagnostics/research and pruned.
- 4 files retained as reusable diagnostics and documented in `scripts/README.md`.

## Retained reusable diagnostics

These had no operational references, but their headers indicate reusable debugging value rather than spent one-off research:

| Script | Reason retained |
|---|---|
| `scripts/diag-parity-corpus.mjs` | Corpus-wide live-vs-backtest parity measurement; header calls it a keystone diagnostic. |
| `scripts/trace-bias.mjs` | General per-bar LTF bias trace for diagnosing wrong-side sessions. |
| `scripts/trace-inv-gate.mjs` | General inversion-gate diagnostic for any tape. |
| `scripts/trace-mss.mjs` | General MSS walker/packet trace over the pinned corpus. |

## Pruned scripts

These had no references outside cleanup docs/README and appeared to be spent one-off diagnostics, date-specific traces, or exploratory outcome studies:

| Script | Header/purpose summary | Reason pruned |
|---|---|---|
| `scripts/diag-disp.mjs` | Aggregate outcome by entry-zone `disp_score`. | Exploratory one-off aggregate. |
| `scripts/diag-draw-dist.mjs` | No durable header; local draw/distribution probe. | Undocumented one-off. |
| `scripts/diag-inv-side.mjs` | Inversion short-vs-long asymmetry. | Exploratory one-off aggregate. |
| `scripts/diag-inversion-confirm.mjs` | Compare inversion confirmation candle features for winners vs losers. | Exploratory one-off aggregate. |
| `scripts/diag-inversion-fvg.mjs` | Compare inverted FVG height/ATR/size quality for winners vs losers. | Exploratory one-off aggregate. |
| `scripts/diag-loss-times.mjs` | Print losing-trade entry times to inspect time-of-day clustering. | Exploratory one-off aggregate. |
| `scripts/diag-month-week.mjs` | Tally wins/losses by month/week-of-month. | Exploratory one-off aggregate. |
| `scripts/diag-near-draw.mjs` | No durable header; local bias/near-draw probe. | Undocumented one-off. |
| `scripts/diag-pillar3-models.mjs` | Break trades down by Pillar-3 model. | Exploratory one-off aggregate. |
| `scripts/diag-regime.mjs` | Compare profitable vs bleeding weeks and trend-regime proxy. | Exploratory one-off aggregate. |
| `scripts/diag-stop-then-tp.mjs` | For losing trades, scan later bars to see whether TP was reached after stop. | Exploratory one-off aggregate. |
| `scripts/diag-stops.mjs` | Aggregate stop rule/kind, risk distance, and outcome. | Exploratory one-off aggregate. |
| `scripts/diag-structure.mjs` | Compare trades aligned/against HTF structure. | Exploratory one-off aggregate. |
| `scripts/trace-0129-confirm.mjs` | Date/zone-specific trace for 2026-01-29 MES. | Spent date-specific trace. |
| `scripts/trace-0129-mes.mjs` | One-off trace for 2026-01-29 MES Lanto short. | Spent date-specific trace. |
| `scripts/trace-0129-zone.mjs` | One-zone trace for 2026-01-29 MES. | Spent date-specific trace. |
| `scripts/trace-0615-detect.mjs` | One-off trace for 2026-06-15 Lanto long. | Spent date-specific trace. |
| `scripts/winner-loser-study.mjs` | Profile winners vs losers across entry-time attributes. | Exploratory one-off aggregate. |

## Safety notes

- No package entrypoints were pruned.
- No app/test/import references were pruned.
- No strategy docs, fixtures, risk controls, source-health checks, or tests were deleted.
- The retained diagnostics are explicitly documented so they are no longer unexplained loose scripts.

## Verification results

After pruning, ran:

```bash
npm test
npm run smoke:fixtures
git diff --check
```

Results:

- `GOFNQ_STATE_DIR=$(mktemp -d) npm test` — passed (`1607` root tests + `9` app tests).
- `npm run smoke:fixtures` — passed (`22/22` checks across `14` fixtures).
- `git diff --check` — passed.
- Deleted-script reference scan — passed (`0` unexpected references outside audit docs).

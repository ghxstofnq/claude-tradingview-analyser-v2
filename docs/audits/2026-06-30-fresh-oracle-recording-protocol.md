# Fresh oracle re-recording protocol — 2026-06-30

## User directive

Re-record the oracle corpus from scratch for **both MNQ and MES**, then verify and monitor it. Do not trust old labels, old tape expectations, or pair-fold output blindly.

## Scope

Fresh capture manifest:

- `docs/audits/2026-06-30-fresh-oracle-recording-manifest.json`
- 11 NY-AM dates × 2 symbols = 22 capture jobs:
  - `2026-01-29`
  - `2026-02-09`
  - `2026-04-06`
  - `2026-06-09`
  - `2026-06-15`
  - `2026-06-16`
  - `2026-06-17`
  - `2026-06-18`
  - `2026-06-22`
  - `2026-06-24`
  - `2026-06-25`

Each date records both:

- `CME_MINI:MNQ1!`
- `CME_MINI:MES1!`

Default window: `09:30–12:00 ET`, NY-AM.

## Non-negotiable recording policy

1. **Fresh capture labels are capture-only.** They live under `tests/fixtures/oracle-capture-labels/` and carry `expected.outcome: unknown`.
2. **No direction defaulting.** `contextFromLabel()` now keeps unknown/no-trade labels neutral (`bias:null`, `htf_ltf_alignment:unclear`, empty targets), so capture-only tapes do not silently default long/bullish.
3. **Fresh tapes are local artifacts.** They write under `tests/tapes/fresh-oracle/`, which is git-ignored.
4. **No `verified:true` from recording alone.** Fresh tapes stay `verified:false` / `expected.outcome: unknown` until reviewed against chart/engine evidence and explicitly user-approved.
5. **No pair-leader R scoring until approved.** A fresh tape can prove replay availability and engine state, but it is not oracle truth.
6. **Do not record during live market hours.** The recorder refuses 09:25–16:05 ET unless `--force-market-hours` is passed. Do not force while a live session could be active.
7. **Monitor every run.** Recording logs go to `state/oracle-fresh-recording/`; folding summaries come from `scripts/fold-fresh-oracle-tapes.mjs`.

## Commands

Dry run the queue:

```bash
node scripts/record-fresh-oracle-tapes.mjs --dry-run
```

Record one job after market close:

```bash
node scripts/record-fresh-oracle-tapes.mjs --limit 1
```

Record one date for both symbols:

```bash
node scripts/record-fresh-oracle-tapes.mjs --only 2026-06-24
```

Record the full manifest, resumable because existing outputs are skipped:

```bash
node scripts/record-fresh-oracle-tapes.mjs
```

Fold/monitor fresh captures without assigning oracle truth:

```bash
node scripts/fold-fresh-oracle-tapes.mjs
```

## Promotion workflow after capture

For each date/symbol pair:

1. Confirm the tape has enough bars and no fatal recorder errors.
2. Fold it with `scripts/fold-fresh-oracle-tapes.mjs` and document current production packets/no-packets.
3. Review chart/engine evidence and strategy docs/transcripts.
4. Write/update a review packet under `docs/audits/recent-oracle-packets/`.
5. Ask for user approval.
6. Only after approval, create/update the tracked oracle tape/label and flip `verified:true` **only if** `npm run tapes` proves the deterministic chain emits the approved packet/no-trade.

## Current blocker

At setup time it was `15:11 ET`, inside the market-hours guard window. Recording was intentionally not started. Start after `16:05 ET` or later.

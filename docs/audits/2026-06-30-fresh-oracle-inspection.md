# Fresh oracle inspection — first pass

**Date:** 2026-06-30

**Branch:** `docs/rebuild-oracle-from-authority`

**Scope:** Fresh MNQ+MES NY-AM oracle recordings from `docs/audits/2026-06-30-fresh-oracle-recording-manifest.json`.

## Executive summary

Fresh recording is complete, but **no oracle truth should be promoted yet**.

The fresh tapes are good raw evidence:

- 22 / 22 tapes recorded after retrying the one transient failure (`2026-06-09 MES`).
- 11 dates × 2 symbols (`MNQ1!`, `MES1!`).
- Each tape has 152 primary 1m entries across `09:30–12:00 ET`.
- Each tape has merged `m5` + `m15` evidence.
- `h4` is present on all tapes; `h1` is present on 21/22 in the first health scan.
- Warning persistence gap found after the first recording: the old recorder returned HTF-anchor warnings to stdout but did not save them into the tape artifact. `record-tape` now persists recorder warnings into future tapes; the 2026-06-30 fresh corpus should be treated as needing explicit HTF-presence inspection rather than trusted as "warning-clean".

However, the first inspection fold shows that capture-only tapes are **not enough by themselves** to recreate approved oracle truth. After rebuilding deterministic brief context from each fresh tape's anchor bundle, current production code emits packets that diverge from the previously approved Batch A rows on several dates.

This is expected and healthy: the new workflow prevents old labels from leaking into the fold, so any packet/no-trade must now be re-derived and reviewed instead of assumed.

## Commands run

Fresh recording:

```bash
node scripts/record-fresh-oracle-tapes.mjs --force-market-hours
node scripts/record-fresh-oracle-tapes.mjs --force-market-hours --only 2026-06-09-mes
```

Raw capture fold/monitor:

```bash
node scripts/fold-fresh-oracle-tapes.mjs
```

Context-rebuild inspection:

```bash
node scripts/inspect-fresh-oracle-tapes.mjs
```

Generated local evidence summaries:

- `state/oracle-fresh-recording/fresh-context-fold-summary.json`
- `state/oracle-fresh-recording/fresh-context-fold-summary.md`

These are local/ignored evidence artifacts, not oracle fixtures.

## First-pass mechanical fold table

This table is a **mechanical inspection**, not approval.

| Date | Pair-leader evidence | MNQ context fold | MES context fold | Initial status |
|---|---|---|---|---|
| `2026-01-29` | displacement → MES; SMT none | context none (`data_gap`) | no setup, divergent | not ready; context blocker |
| `2026-02-09` | inconclusive; SMT none | context none (`data_gap`) | context none (`data_gap`) | not ready; contradicts previous approved MNQ long seed |
| `2026-04-06` | inconclusive; SMT → MES | no setup, divergent | context none (`data_gap`) | not ready; context blocker |
| `2026-06-09` | inconclusive; SMT none | **B MSS short** `29476.75 / 29554.75 / 29113.75`, stopped | context none (`data_gap`) | not ready; contradicts approved Option A Inversion packet |
| `2026-06-15` | inconclusive; SMT none | no setup, clean | **A+ Trend long** `7630.5 / 7627 / 7640`, stopped | review-only candidate, not oracle truth |
| `2026-06-16` | displacement → MNQ; SMT → MES | **B MSS short** `30864.25 / 30896 / 30783.75`, TP1 | B Trend short `7612 / 7617.5 / 7598.25`, unresolved | closest approval candidate; still requires chart/strategy review |
| `2026-06-17` | inconclusive; SMT none | no setup, divergent | no setup, divergent | candidate no-trade; verify context |
| `2026-06-18` | inconclusive; SMT none | no setup, clean | no setup, divergent | not ready; contradicts previous approved MNQ Trend long seed |
| `2026-06-22` | inconclusive; SMT none | no setup, divergent | no setup, divergent | candidate no-trade; verify context |
| `2026-06-24` | inconclusive; SMT → MNQ | no setup, divergent | context none (`data_gap`) | not ready; context blocker |
| `2026-06-25` | inconclusive; SMT none | no setup, degraded HTF fallback | **A+ Trend short** `7449.75 / 7464.75 / 7404`, unresolved | review-only candidate; prior parity no-trade is contradicted |

Post-alignment update (2026-07-01): `2026-06-16` MNQ has since been user-corrected and promoted. The deterministic chain now emits `B MSS short 30864.25 / 30905.00 / 30750.75`, and the tracked tape expectation is `verified:true` with that corrected row.

Post-alignment update (2026-07-01): `2026-06-18` MNQ Option A has since been reconciled against the fresh MNQ capture. The deterministic direct-brief fold now emits the approved `B Trend long 30452.75 / 30400 / 30615` at `2026-06-18T13:46:00.000Z`; MES remains no-setup/divergent and unverified.

## Key blockers found

### 1. Capture-only raw fold correctly emits zero packets

`node scripts/fold-fresh-oracle-tapes.mjs` reports:

```text
22 tape(s), 0 with packets
```

That is not a market verdict. It only proves the capture-only labels stayed neutral:

```json
{
  "expected": { "outcome": "unknown", "model": null, "side": null }
}
```

This is the desired anti-contamination behavior.

### 2. Deterministic context reconstruction is now the main reliability boundary

`inspect-fresh-oracle-tapes.mjs` rebuilds a direct-session brief from each tape's first captured bundle, then folds through `runBacktest(...)` with the production truth function.

This exposed rows where no context builds because the deterministic brief reports `data_gap`, commonly when no primary draw is selected and at least one HTF anchor is missing. The first 2026-06-30 fresh corpus did not reliably attach `daily` because `freshChartForReplay({ timeframe: 'D' })` verified the chart resolution by strict string equality, while TradingView reports Daily as `1D`. That made Daily replay-anchor capture fail before replay started.

Fix applied after first-pass inspection:

- `pinChart` now accepts `D` ↔ `1D` via the same timeframe-alias logic used by engine meta checks.
- Recorder warnings are persisted into tape artifacts.
- A representative re-record of `2026-06-09 MNQ` attached `daily`, `h4`, `h1`, `m15`, and `m5` with `warnings=[]`.

Before promotion, the remaining fresh corpus should be regenerated or Daily-backfilled with this fixed recorder so all rows have consistent HTF evidence.

That still leaves a strategy/design decision before promotion:

- require successful Daily/H4/H1 anchor capture for every approved row, or
- explicitly allow H4/H1-only context when Daily is unavailable, with tests and a visible warning.

### 3. Approved Batch A rows are not automatically reproduced from fresh context

The fresh mechanical fold currently disagrees with some already-approved rows:

- `2026-06-09` approved Option A: `Inversion short B` at `29760 / 29818.75 / 29595.25` around `14:27Z`.
  - Fresh context fold currently emits later `MSS short B` at `29476.75 / 29554.75 / 29113.75`, stopped.
- `2026-06-18` approved MNQ Trend long is now reconciled by the Option A direct-brief fold fix: `B Trend long 30452.75 / 30400 / 30615`, TP1 hit.
- `2026-02-09` approved row was MNQ long, but fresh context fold currently builds no context.

Therefore these fresh folds are review signals, not replacements.

### 4. Pair-leader evidence is mostly inconclusive in the first 30 minutes

Only two dates produced displacement leaders:

- `2026-01-29`: MES
- `2026-06-16`: MNQ

SMT divergence leaders appeared on:

- `2026-04-06`: MES
- `2026-06-16`: MES
- `2026-06-24`: MNQ

No pair-leader rule should be promoted from this inspection alone.

## Current approval posture

No fresh oracle row is approved yet.

Possible next review priorities:

1. `2026-06-16 MNQ` — closest to current known Batch A behavior and mechanically profitable.
2. `2026-06-17` / `2026-06-22` — no-setup candidates, but both need context verification.
3. `2026-06-09` / `2026-02-09` — remaining high-priority contradiction/context cases because they disagree with already-approved rows.
4. `2026-06-25 MES` — new mechanical packet contradicts prior parity no-trade; do not promote without chart review.

## Required next steps

1. Fix or explicitly document the Daily HTF capture/context policy.
2. For each high-priority date, inspect the fresh tape evidence around:
   - anchor brief / primary draw selection,
   - open reaction window,
   - first walker lifecycle transition,
   - packet bar and immediate outcome bars.
3. Write revised per-date approval packets that include both MNQ and MES fresh evidence.
4. Ask user approval before any promotion.
5. Only after approval, create tracked oracle tapes/labels and run `npm run tapes`.

## Non-negotiable conclusion

Fresh recording succeeded. Fresh oracle approval has **not** succeeded yet. The correct next work is not to flip `verified:true`; it is to debug/review the context reconstruction boundary and reconcile contradiction dates first.

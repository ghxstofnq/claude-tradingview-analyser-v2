# Gate-corpus capture manifest

The real-money-gate corpus (intent: [docs/intent/2026-07-05-gate-corpus.md](intent/2026-07-05-gate-corpus.md)).
This document is the "data exactly known" contract: what is recorded, by which code,
through which pipeline, with which proven guarantees and which known divergences.

## What

Every NY AM (09:30–12:00 ET) and NY PM (13:00–16:00 ET) session, **2026-01-10 → 2026-07-03**,
MNQ1! and MES1! (two sequential passes), recorded via
`scripts/record-corpus.mjs --from 2026-01-10 --to 2026-07-03 [--symbol MES1!]`.
Holidays skipped by the runner's `HOLIDAYS` set. 2026-07-03 ny-pm is an expected FAIL
(early close 13:00 ET — no PM bars); it logs as a failure on every resume pass, harmlessly.

## Pipeline (per session)

`record-corpus.mjs` → one process per (date, session) → `run-backtest-headless.js` →
`backtest-engine.js` (deterministic, $0, no LLM) → `recordEntries` — the SAME capture core
`tv record-tape` uses and the parity certification covered. Per bar: full detector-input
shape (`event` OHLC + bar times, `inputs.bundle` incl. `engine` + `engine_by_tf` + gates,
`ltf_bias_context`, `session_state`, `untaken_targets`) — identical to live
`buildDetectorInputs`. Output: `state/backtest/<run-id>/<session>/walker-inputs.jsonl` +
index entry in `state/backtest/index.json`.

## Code identity

- Pine: **ICT Engine V5, CODE_REV = 1, schema 4** (repo main @ `946b23a`, TV script v29).
  Every recorded bar carries `engine.meta.code_rev` — a corpus bar without `code_rev=1`
  was NOT recorded by this code and must not be folded.
- Both fold-gated levers (`useReactionWindowRejection`, `useOriginLegAnchor`) recorded OFF
  (production semantics) with the lever-ON variants dual-emitted additively on every bar:
  sweep `rejected_rw`, quality `leg_high_org/leg_low_org(+_ms)`. One recording, both worlds.

## Proven guarantees (certification, scripts/gate-corpus/parity-diff.py)

1. **Recorder determinism** (2026-07-05, 07-02 recorded twice): byte-identical except
   `emit_ms`/`emit_ny` wall-clock stamps. Fold comparisons must ignore only those.
2. **Replay price identity vs live** (07-02 and 07-06): every live bar present, OHLC exact.
3. **Engine-value parity vs live on identical code** (2026-07-06, both sides v29):
   **0 hard mismatches** across 135 bars — levels, sweeps (incl. `rejected`/`rejected_rw`),
   zone boundaries and lifecycle fields, structures, pools, session/overnight/OR quality
   fields all identical.

## Known bounded divergences vs live (documented, not defects)

- **Forming-tick quality scalars** (~7% of bars on 07-06: `atr_14/atr_17/coherence/
  range_vs_normal/displacement/candle/regime` on the current-TF quality row): the live
  capture reads the emit ~1s into the forming bar; replay reads at the bar boundary.
  Bounded and irrelevant to fold self-consistency (the corpus is internally deterministic).
- **Context domain** (`ltf_bias_context`, brief-derived fields): the backtest derives
  context deterministically at the anchor; live may carry the day's LLM-written chain.
  This is the long-documented context-parity domain, out of scope for evidence parity.
- Live sessions recorded **before 2026-07-05** ran a drifted Pine deploy (caught by the
  07-02 parity diff: wrong session labels for 58 NY-AM bars, old disp_score formula).
  Their engine evidence must not be treated as ground truth; the corpus replaces it.

## Operational rules

- The recorder must be the SOLE CDP driver: app stopped, no manual chart use.
- Pause any time: `pkill -f record-corpus` — fully resumable, healthy (date, session)
  runs are skipped on re-run; failures retry.
- Resume/nights: re-run the same command (`--force` needed inside 09:25–16:05 ET weekdays).
- MES pass: same command + `--symbol MES1!` after the MNQ pass completes.

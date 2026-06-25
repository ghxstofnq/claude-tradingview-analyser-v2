# /tv-record-tape — record a verified day-tape for the oracle / regression

Steps replay across a session and records the per-bar schema-4 evidence as a reusable tape (the
day-tape gate / Stage-G oracle). Wraps the **/tv-replay** loop (reload + two-pass 1m+5m +
emit-verified + wedge recovery).

## Command
- `./bin/tv record-tape --label <label.json> --from HH:MM --to HH:MM [-o <out>]`
  - `--label` is a `gxofnq.real-session-label.v1` JSON (date, `contract_hint`, session, and
    `expected` once hand-graded). Shape: `tests/fixtures/real-sessions/*.label.json`.
  - default window 09:30–12:00 ET; **prefer a tight window** (~3–5s per bar). ET times.
  - writes `tests/tapes/<date>-<session>.tape.json` with `verified:false`.

## Procedure
1. **/tv-health first** — the engine must be "ICT Engine V5" schema-4, or the tape records the
   stale schema-2 (a reload during recording would otherwise revert it).
2. Write a minimal label (date / contract_hint / session) — `expected` can start as a placeholder.
3. Record. Then **hand-grade** the tape: read the evidence, apply the rubric (grade the FULL move —
   see /tv-replay), fill `expected`, and flip `verified:true`.
4. `npm run tapes` folds it through the real walker chain (the day-tape regression gate).

## Notes
- Continuous futures (MNQ1!/MES1!) have full intraday replay history.
- The recorder leaves the chart reloaded + pinned to 1m, replay stopped.

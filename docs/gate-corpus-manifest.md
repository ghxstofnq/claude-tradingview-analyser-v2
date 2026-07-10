# Gate-Corpus Capture Manifest

Intent: [docs/intent/2026-07-05-gate-corpus.md](intent/2026-07-05-gate-corpus.md).

This is the real-money-gate corpus contract: data is trusted only when the recorded artifacts prove the session was captured through the backtest replay pipeline, with healthy brief context, full tape coverage, and a machine-generated parity certificate.

## What

Window: 2026-01-10 through 2026-07-03.

Symbols: `MNQ1!`, `MES1!`.

Sessions: `ny-am`, `ny-pm`.

Expected full sessions per symbol: **239**.

- `ny-am`: 120 sessions, each with 152 one-minute tape entries from 09:29 through 12:00 ET.
- `ny-pm`: 119 sessions, each with 182 one-minute tape entries from 12:59 through 16:00 ET.
- 2026-07-03 `ny-pm` is excluded because the early close at 13:00 ET means there is no full PM session. A recorded attempt is reported as an expected exception/unexpected artifact, not as ordinary full-session coverage.

Holidays skipped by the runner: 2026-01-19, 2026-02-16, 2026-04-03, 2026-05-25, 2026-06-19.

No-trade days are still recorded with `GOFNQ_CORPUS_RECORD_ALL=1`; a deterministic no-trade is valid evidence when the capture artifacts are healthy. Genuine `data_gap` capture failures remain retryable failures and cannot certify.

## Pipeline

`scripts/record-corpus.mjs` -> `run-backtest-headless.js` -> `app/main/backtest-engine.js` -> `recordEntries`.

Required artifact identity per selected run:

- `state/backtest/index.json` row has `engine: "deterministic-walker-chain"`.
- The index row has a parseable `created_at`, which is required for deterministic retry ordering.
- `tape.json` top-level `date`, `session`, and `source: "backtest-engine"` match the index row and expected backtest pipeline.
- `brief-bundle.json` parses and every required `engine_by_tf` row (`daily`, `h4`, `h1`, `m30`, `m15`, `m5`, `m1`) has matching schema, Pine `code_rev`, and symbol. The duplicate top-level `engine` may be null; if present, its meta must also match.
- `brief-bundle.json` has explicitly healthy capture status: `capture_health.ok === true` and `capture_health.missing` is an empty array.
- Every `tape.json` entry has `event.tf === "1m"` and matching `inputs.bundle.engine.meta`, not only the first or last entry.

Artifact paths are fail-closed: empty or unsafe `run_id` path segments are rejected before joining paths, and both lexical and real (symlink-resolved) artifact paths must remain under `state/backtest`.

## Certification CLI

`./bin/tv backtest certify` reads only disk artifacts, respects `GOFNQ_STATE_DIR`, prints the full machine-readable report, and exits nonzero when `certified:false`.

Report shape includes:

```json
{
  "manifest_id": "gate-corpus-2026-h1-v1",
  "certified": false,
  "requirements": {},
  "selection_digest": "<sha256>",
  "symbols": {
    "MNQ1!": {
      "expected": 239,
      "valid": 0,
      "missing": [],
      "duplicates": [],
      "retries": [],
      "invalid": [],
      "selected": {},
      "selected_artifacts": {},
      "no_trade_sessions": [],
      "unexpected": [],
      "exceptions": []
    }
  },
  "parity": {},
  "blockers": []
}
```

Selection policy is stable: for each `(date, session, symbol)` key, the latest valid artifact wins. Failed newer retries do not invalidate an older valid artifact, but they are reported.

- `retries`: present for any key with more than one candidate. Includes all candidate run IDs and `created_at` values, each candidate validation status and reasons, the selected valid winner, and whether the newest attempt was invalid.
- `duplicates`: present only when more than one candidate is valid. It does not include failed retries.
- `valid` counts selected keys only and cannot be inflated by retries.
- `selected_artifacts` records the selected run ID and SHA-256 hashes of its tape and brief; `selection_digest` binds all selected keys, run IDs, and artifact bytes.
- `no_trade_sessions` preserves selected deterministic no-trade keys instead of dropping them from coverage.

## Parity Certificate

Parity certification requires a structured machine-generated artifact at `state/backtest/parity-certificate.json`. A handwritten/free-form object such as `{ "certified": true, "evidence": "..." }` is not valid evidence.

Generate the certificate with `scripts/gate-corpus/parity-diff.py` after selecting the corpus:

```bash
python3 scripts/gate-corpus/parity-diff.py \
  /abs/path/to/tape.json \
  /abs/path/to/walker-inputs.jsonl \
  --certificate-out state/backtest/parity-certificate.json \
  --manifest-id gate-corpus-2026-h1-v1 \
  --selection-digest <report.selection_digest> \
  --schema 4 \
  --code-rev 1
```

The script deletes any stale requested output before validation and writes a positive certificate atomically only on exact `PASS`. Empty inputs, duplicate or missing event keys, absent OHLC evidence, malformed selection digests, `FAIL`, and `PASS-WITH-NOTES` all exit nonzero and leave no positive certificate.

The certifier validates:

- schema version and generator ID
- `PASS` verdict
- ISO, non-future `generated_at`
- manifest ID, 64-hex selection digest, schema, and code revision
- symbol/date/session scope identifying one selected manifest key
- absolute source tape/live paths
- SHA-256 hash of each current source file
- parity tape hash equality with the selected corpus tape for the scoped key
- zero alignment, OHLC, and hard-mismatch counts

Malformed, stale, handwritten, mismatched, unselected-tape, or hash-drifted certificates fail closed.

## Current Status

Do not claim the corpus is certified. The current real corpus is blocked by missing/invalid MNQ and MES coverage plus the absence of a valid parity certificate. Rows where `brief-bundle.json` has `capture_health.ok === false` correctly fail certification as data gaps.

## Operational Rules

- Recorder must be the only CDP driver: app stopped, no manual chart use.
- Pause with `pkill -f record-corpus`; recording is resumable.
- Resume with the same command; use `--force` only when deliberately running inside market-session guard hours.
- MES pass uses the same command plus `--symbol MES1!` after MNQ completes.

## Readiness Evidence
`tv backtest verdict --symbol MNQ1!` and the Backtest baseline UI render the same fail-closed readiness object. Positive R is evidence only; readiness also requires current green test evidence, certified corpus, certified parity, explicit strategy review approval, and explicit user-window approval.

Use `tv backtest verify-tests` to run the broad repository test command. It writes `state/backtest/readiness/tests-green.json` only after exit 0 and only for a fully clean worktree at the current HEAD SHA. Failed tests or dirty code leave no current positive evidence.

Use `tv backtest approve --symbol MNQ1! --strategy-review approved --user-window-approved --note "..."` only after `tv backtest verify-tests` and review. The approval record is timestamped and bound to manifest ID, selection digest, the exact evidence scope/window digest, clean full code SHA, symbol, and normalized non-secret `GOFNQ_*` strategy levers. Any code, corpus selection, scope/window, symbol, or strategy-lever drift makes approval pending again.

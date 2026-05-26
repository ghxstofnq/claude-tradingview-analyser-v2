# Miss-regression fixtures

Each fixture pins one of the 8 strategy-fidelity misses from the
2026-05-26 session log (see [docs/research/2026-05-26-llm-strategy-fidelity.md](../../../docs/research/2026-05-26-llm-strategy-fidelity.md)).

The detector must NOT replicate the misread on any bundle here. Tests
in `tests/setup-detector.test.js` (added Task 17) load each fixture and
assert the detector's output does not exhibit the miss pattern.

These fixtures live in a subfolder so the smoke fixture script
(which only scans `tests/fixtures/*.bundle.json` one level deep) doesn't
try to validate them as analyze-time bundles — they're detector inputs.

## Detector-relevant misses (have fixtures here)

- `miss-04-swept-tp` — TP cite must come from `untaken_above[]`, never a swept level (`session_levels.<L>.taken=true`).
- `miss-05-locked-ltf-bias` — side driven by `htf_destination.dir`, not the locked LTF bias passed in via context.
- `miss-07-wrong-stop` — `stop_options[0]` is `fvg_candle1_low` when bars and FVG are present; FVG bottom is fallback.
- `miss-08-pullback-already-played` — `retrace_to_fvg.present` requires `inside_fvgs[]` to currently contain the FVG; a fresh-just-created FVG with empty `inside_fvgs[]` is not yet retested.

## Covered upstream (no detector fixture)

- **miss-01** (bars_by_tf cite) — fixed by `brief_digest` emission (PR #61).
- **miss-02** (fabricated sizing) — fixed by `cli/lib/sizing.js` + injection in `app/main/session-brief.js` (PR #61).
- **miss-03** (chain_status null) — auto-derived in `app/main/tools/surface.js` (PR #61).
- **miss-06** (premature phase tag) — phase derived from ET clock in `app/main/tools/surface.js` (PR #61).

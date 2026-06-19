# Intent — Backtest popover: faithful baseline + TESTS section + baseline history

Confirmed via `/interview-me`, 2026-06-19.

## Outcome
The BACKTEST popover's LIBRARY dashboard shows the **faithful fold-week baseline**
(brief regen + AM→PM carry), not the live re-fold of raw `setups.jsonl`. Add a
TESTS section and versioned baseline history.

## Re-fold
A **button** recomputes the faithful baseline from the current corpus + current
code. Run it after adding replays or accepting a code change. Reads/writes a
cached artifact — no fold-on-every-render, no continuous realtime fold.

## TESTS section
Lists every fold-test (newest first):
- label, per-day + total R, **delta vs accepted baseline**
- **accepted / rejected status + the reason**
- expandable to the day-by-day comparison table

I create tests by running the fold (terminal / `/fold-test`). Not configured in
the UI. Verdicts are **records, not deployment**: accept/reject + reason is
documentation (in-app version of the `filters-dont-separate` rejection log).
Nothing in the UI mutates strategy code or auto-swaps the baseline. Actual code
change stays edit → merge → re-fold.

## Baseline history
Each time we accept a new baseline, the previous one is **snapshotted** (date,
total, per-day, reason) so we can look back and compare old vs new.

## Per-symbol
Baseline, tests, and history are all **one symbol at a time** (MNQ / MES
separate). Styling matches the existing popover components.

## Out of scope
- running / configuring tests from the UI
- auto code-swap on accept
- true continuous realtime folding

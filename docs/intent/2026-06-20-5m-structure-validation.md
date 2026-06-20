# Intent — 5m LTF structure (validated before ship)

Status: confirmed (interview-me, 2026-06-20)

## Outcome
The walker reads LTF **structure** — swings, MSS/BoS, and the PD-array zone (FVG/iFVG)
it taps — from the **5-minute**, not the 1-minute. The 1-minute stays **only** as the
entry trigger (the tap into the zone + the confirming close that fires the order).

## User
The trader (project owner). Fewer false-structure entries → fewer junk losses.

## Why now
The 1-minute throws **false structure confirmations**. It also contradicts the strategy
doc, which reads structure on 5m ("breaks the 5m lower high… leaves a clean 5m FVG…
retrace into that 5m FVG") and uses 1m only for the tap/close. The 1m structure is the
suspected source of invalid losing trades (this came out of the losers audit).

## Success
A re-fold shows corpus R **holds or improves** AND the false-structure losing / −3R days
clean up. Judged by **the number**, not "it matches the doc."

## Constraint (binding)
Existing tapes saved **1m engine data only**, so a 5m-structure read **cannot** be folded
on them as-is. Therefore: **build a validation harness first** — capture 5m structure,
fold the **worst weeks first**, then the **whole backtest corpus**. Nothing ships live
until it passes.

## Out of scope
- No change to divergent-day grading — divergent days stay tradeable at **B**.
- The 1m entry trigger / confirming close stays.
- Prep does **not** become a hard reject-gate (the prep-as-validation idea collapsed into
  "read cleaner 5m structure").

## Known caveat
A prior test moved the *confirmation close* to 5m and cost ~−55R ("1m entry load-bearing").
That is **not** this change — here only the **structure** moves to 5m; the entry stays 1m.
This variant is untested.

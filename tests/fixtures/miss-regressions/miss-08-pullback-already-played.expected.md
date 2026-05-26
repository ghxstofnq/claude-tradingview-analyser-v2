# miss-08: fresh FVG without inside_fvgs[] is NOT a retrace

This bundle has a fresh bull FVG (just created at current bar) but price has displaced away (last=30012, well above FVG top=29998.5). `inside_fvgs` is EMPTY. The original miss had the model interpreting `state: fresh` + `reacted: true` as "pullback already played" — confusing FVG creation with FVG retest.

Detector requirements:

- MSS candidate's `retrace_to_fvg.present` MUST be `false`.
- `missing_reason` MUST include "not yet retested".
- MSS candidate is non-tradable for this bar.
- Detector's `rejection_summary` should describe waiting for retrace.

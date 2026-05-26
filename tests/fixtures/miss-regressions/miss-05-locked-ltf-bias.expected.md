# miss-05: side driven by htf_destination, not locked ltf_bias

This bundle has HTF dir=above + valid MSS-bull signals (sweep, failure_swing, fresh FVG, bull confirmation). The original miss had a locked-bear ltf_bias prevent the bullish entry even though current structure had flipped.

Test passes `ltf_bias_context.bias = "bear"` (stale snapshot). Detector requirements:

- `best_candidate.side` MUST be `"long"` (driven by htf_destination, not ltf_bias snapshot).
- `best_candidate.model` MUST be `"MSS"`.
- Detector ignores the bear ltf_bias for the side decision.

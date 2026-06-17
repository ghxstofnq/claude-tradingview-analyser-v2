# Intent: make confirmed setups surface LIVE

Confirmed via interview-me, 2026-06-17.

## Outcome
Live recognizes a just-closed candle's confirmation in time to enter on the
NEXT candle — taking the same setups the backtest does, instead of reading the
engine table too early and seeing nothing (the 0/64 problem).

## Model (corrected by user)
- Confirmation candle **N** must CLOSE to confirm.
- Entry is on candle **N+1** (the candle after). The backtest already does this.
- So live entering on N+1 is PARITY, not divergence.

## Root cause (found during implementation, 2026-06-17)
NOT a timing problem. The measurement campaign disproved every timing hypothesis:
- The 1-bar engine recognition lag is IDENTICAL in live and backtest (tape: 35/35
  at exactly 60s), so sub-bar polling (Path A) fixes nothing.
- Entering a bar late (Path B) looked +18R but was a mirage — entries drift toward
  the fixed stop, shrinking risk and inflating R; those tiny stops get wicked live.
- Refolding live inputs vs the backtest tape through the SAME brain: live=0,
  backtest=4 setups → the bundles differ, not the logic.

The actual bug: the live capture's `bars.last_5_bars[-1]` (and the derived
`confirmation.last_bar`) is the still-FORMING candle — `O=H=L=C`, range 0, a doji
(112/135 bars). The walker can't read a violation/displacement off a flat doji,
and the bridge's in-current-bar window anchors to the forming bar's time, so a
freshly-recognized inversion falls outside it → no confirmation → `no_confirmed_packet`
on every bar. The backtest tape recorder DROPS the forming bar at capture
(`closedBarsOnly`), so its `confirmation.last_bar` is the real closed candle.

## Mechanism (the fix)
Drop the still-forming candle at capture so confirmation facts read the just-CLOSED
bar — mirroring the tape recorder. New `dropFormingBar(last5, quoteTime)` in
`cli/lib/last-bar.js` (guarded: only drops when the last bar's period hasn't
elapsed vs the quote time; never drops a real closed bar). Applied in
`cli/commands/analyze.js` at both capture sites before `lastBarFacts`. No
confirmation-logic, timing, or entry change. Validated: refolding today's live
inputs with the forming bar dropped surfaces the backtest's exact setups
(+2.17R, 3 Inversion shorts); a live capture now yields a real closed
`confirmation.last_bar` instead of a doji.

## Success (measurable)
Refolding today's LIVE recording through the fix surfaces the backtest's setups
— today's AM yields the clean ~3-4 Inversion shorts (+2.17R), not 0, and not
#118's fake trades.

## Constraints
- No widened acceptance window (that was #118 — reverted, net -21R).
- Entry stays on N+1; if the confirmation hasn't landed before N+1 closes, SKIP
  (never chase to N+2+).
- Same brain as backtest.
- Gating check before building: verify the backtest's entry really is N+1's
  price, not N's close.

## Out of scope
Entry-model / stop / tp logic; any "take-by-age" widening; auto-exec changes
(manual mode stays).

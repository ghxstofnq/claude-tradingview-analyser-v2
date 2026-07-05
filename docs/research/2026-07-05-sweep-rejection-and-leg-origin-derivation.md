# Derivation: sweep-rejection semantics + leg-origin anchor (2026-07-05)

Authority derivation for the two behavior changes deferred from the 2026-07-05 Pine audit,
per the standing rule (faithfulness rulings derive from Lanto's transcripts + the Discord
alerted-trades archive, cited verbatim; derived docs are context only). Every quote below
was verified verbatim against its source by an independent checker; two transcript quotes
carry a `[compressed]` marker where the checker found faithful-but-shortened wording.

Sources: `docs/strategy/transcripts/` (BIAS = How-I-Develop-Daily-Bias 12122025, PRICE =
How-To-Identify-Price-Action, TRADE24 = HOW-I-TRADE-THE-STOCK-MARKET-2024), the Discord
export ("Lantos Alerted Trades - Organized", dates given per message), `docs/strategy/lanto-oracle.md`.

---

## 1. Sweep rejection is a revisable reaction-window read, not a 3-bar latch

**Defect being ruled on** (`trackSweep`, pine/ict-engine.pine): once a level is wick-swept,
any close back through it within `SWEEP_REJECTION_BARS = 3` flips `rejected` to true
permanently; nothing ever reverts it short of the level re-forming.

### His words

- "all you got to wait for is one gap go invert. No, you got to see more more more more." — BIAS 39:20
- "imagine you see one three-minute candle or one fiveminute candle disrespect one array … If you see one bearish gap get disrespected, [does that] mean going see full reversal? Ideally, no." — BIAS 30:30 `[compressed]`
- "instead of waiting and waiting for the full reaction they simply see a liquidity grab … boom they take trade … instantly get stopped out … Just because we see a couple candles here off the five-minute kind of retrace [does not mean] we're going see full reversal. This why you see me chat wait for later displacement" — BIAS 38:23 `[compressed]`
- "It's not chat. It's not the initial liquidity that we end up taking. It's the reaction right? … Reaction gives lower time frame outlook also confirms or does not confirm higher time frame bias." — BIAS 20:33
- "when you see price … off a one minute gap just consistently reject and reject and hesitate and hesitate where we eventually see one candle close above the gap and technically quote unquote inverse, that doesn't give me the motive and interest" — PRICE 27:25
- Retests "only give you … invalidation of potential move to come or validation of potential move to come" — TRADE24 04:00
- Timing anchors: the NY-open reaction forms over the **first 15–30 minutes** (BIAS 23:21 / 27:42, carried into daily-bias.md §4); an interaction that fights for "longer than 10 to 15 minutes" is a failed interaction (PRICE 25:34). He never states a bar count.

### His live behavior (Discord archive)

- 2026-06-11 11:06 AM — the cleanest statement of two-outcome pending semantics on ONE zone:
  "This 5m gap is perfect for bias confirmation in lower or higher. NQ took London lows, now
  if we inver[t] this 5m bearish gap, can expect higher back in range. If we tap, and respect,
  expect lower." The verdict is decided by subsequent candles, not stamped at the interaction bar.
- 2026-06-16 — 10:20 "Price is back below Asia lows, can see an AM sell now"; 10:40 "If we hold
  Asia lows on ES, and 4HR gap on NQ, can flip narrative back to upside. All on the reaction off
  these lows." Same level, read revised, both directions live.
- 2026-06-22 — "Consolidating. Will give this until 1:30ET to confirm or we are hands off."
  2026-06-19 — "30 mins in, and still haven't see a full ORM reaction. No forcing here."
  Early breaks are held UNRESOLVED, on an explicit clock.
- Reads get invalidated by later action as a matter of course: "Bullish SMT wiped out with NQ
  taking London lows" (06-10); "Bullish SMT off London lows wiped" (06-11); "Divergence flip mid
  trade" (06-22).

### Derived rule

A swept level's reject-vs-accept verdict is the **current read of whether price holds back
through the level, evaluated over a bounded reaction window on the order of 15 minutes
(15–30 min at the NY open), revisable in both directions within that window, frozen when the
window closes.** A single transient close back through the level must not fix the verdict —
in either direction.

- **Case A (settled):** an ultimately-accepted break with one transient pullback close within
  a few bars must NOT read rejected forever. Fixed by the window read.
- **Case B (bounded, not overridden):** a genuine rejection followed much later by a decisive
  re-break is, in his framework, NEW information ("never marry the bias") — but he never states
  that the earlier rejection is retroactively unflagged. The faithful conservative model is a
  **new interaction**, not a mutation of the old one. Re-arming the sweep on a later re-break is
  therefore OUT OF SCOPE of this change and left for a future derivation + fold.

### Gaps (disclosed)

1. His material is mostly gaps/PD arrays + the NY-open reaction; the transfer to horizontal
   session-level sweep flags is inference from "any area of liquidity" (BIAS 10:18).
2. No verbatim bar count exists; 15 minutes is the conservative end of his stated window and
   coincides with his failed-interaction bound.
3. Case B's mutate-vs-new-interaction question is under-specified by his words — settle by
   fold + hand-grade, not by more quoting.

### Implementation + gate

`useReactionWindowRejection` input, **default OFF** (emits the legacy 3-bar-latch values until
enabled). Enablement requires: full-corpus fold old-vs-new (blocked on the corpus re-record)
plus two hand-graded case days (an accepted-break-with-pullback day; a rejection-then-re-break
day) confirming the window read reproduces Lanto's own calls.

---

## 2. Leg extremes (SH/SL) anchor at the leg ORIGIN, not the break bar

**Defect being ruled on** (leg block, pine/ict-engine.pine): on an external structure event,
`legHigh/legLow` reset to the BREAK bar's high/low. On a bear break the SH line therefore marks
the break candle near the leg's bottom — not the swing the down-leg came from.

### The render already states the correct convention

pine/ict-engine.pine renderLeg comment (~line 1543): the strong extreme is "the extreme that
PRODUCED the last swing-tier break … protected, 'should not be taken out'." The reset code
contradicts the file's own stated convention; the reset code is the bug.

### His words / live behavior

- Stops anchor at the entry array or the relative/origin swing — "a good area of interest …
  where if you do get stopped out … it makes sense for us to reverse"; live callouts name
  "Stop swing high" / "Stop swing low" / "relative low stop" / "Stop, wick low" — never a break
  candle (Discord archive; lanto-oracle.md; risk-and-management.md §Stops).
- The Inversion model's stop already uses the "failed-leg extreme" (execution-packet.js), which
  IS the origin extreme of the leg that produced the break.

### Derived rule

After an external break, the protected (strong) extreme = the origin swing extreme of the leg
that produced the break: bear break → keep the pre-break high (typically the liquidity-grab
high); bull break → keep the pre-break low. The with-trend (weak) extreme starts fresh at the
break bar and extends with the new leg.

**Zero-new-state implementation (Option A):** at the moment of a bear event, the running
`legHigh` already equals the accumulated max since the last bull event — i.e. exactly the
origin high. So the fix is a direction-aware reset: keep the opposite-side accumulated extreme,
reset only the with-trend side. Dual-direction bars (both events in one bar) degrade to the
legacy both-reset behavior.

**Open ruling (documented choice):** on consecutive same-direction events (bear → bounce →
bear), Option A keeps the strong high at the WHOLE structure's origin (the last bull-break
peak), not the intermediate lower high. This matches "structural invalidation of the bearish
structure" and the render's stated convention; if the strategy instead wants the stop to trail
to the most recent lower high, that is a different variant requiring its own fold. Default
here: structure origin.

### Consumers (why this is fold-gated despite being values-only at emit)

`leg_high/leg_low(+_ms)` feed: the bridge's `structural_stops` pool (app/main/bar-close.js),
the MSS/Inversion beyond-zone stop selectors and the generic stop fallback
(execution-packet.js), the Inversion depth-in-leg gate (inversion-lifecycle.js,
`legHigh - legLow`), and leg-direction classifiers (`legHighMs` vs `legLowMs` in
classifySetupModel / lifecycle-utils / live-ltf-resolver). Changing the values changes bot
behavior.

### Implementation + gate

`useOriginLegAnchor` input, **default OFF** (legacy break-bar values until enabled).
Enablement requires the full-corpus fold old-vs-new. The visual SH/SL defect remains on the
chart until the lever flips — accepted cost of keeping the visual and the bot on the same
single source of truth (docs/intent/2026-06-27-end-goal.md: UI reads the SAME analysis).

---

## 3. Related cleanup ruled safe without derivation

- `build-strategy-context.js` `chop_15m` blocker: can never fire (the engine quality row
  carries no such key since schema 4) and is doubly redundant — Pine bakes the chop cutoff into
  `confirm_close` (a chopped zone never confirms) and the walker has its own
  `TAP_CONFIRMATION_TIMEOUT_MS` 15-minute tap timeout. Deleted.
- `meta.bar_closed`: kept — honest forming-vs-confirmed emit metadata, no consumer, negligible cost.
- Bridge `entry_state === 'confirmed'` filter (bar-close.js ~1224): dead in live schema-4 flow
  (live confirmation = the violation-close synthesis for Inversion; wick-tap retrace in the
  MSS/Trend walkers) but load-bearing in the V2-shaped runtime test
  (`bar-close-deterministic-packet-runtime.test.js:289`). Left in place, documented as V2
  back-compat; removing it requires rewriting that test to the violation path.

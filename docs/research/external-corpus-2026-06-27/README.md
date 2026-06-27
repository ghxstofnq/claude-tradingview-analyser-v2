# External research corpus — 2026-06-27

Web + source crawl to support **Lanto faithfulness**, **bot trading correctness**, and
the **Pine engine**. Gathered with crawl4ai / yt-dlp / gh / context7. Each finding is
mapped to the documented fidelity gaps in
[`docs/strategy/lanto-source-of-truth.md` §6](../../strategy/lanto-source-of-truth.md)
(the ranked-divergence list). Nothing here changes code — it is a reference base. Per
project method, every lever still folds old-vs-new on the corpus behind a default-off
flag before it ships.

> Sources are third-party educational content; the distilled `.md` files are summaries
> in our own words with links back. Lanto's transcripts are his own spoken words
> (auto-generated subs — treat as lower-fidelity than the formatted class transcripts in
> `docs/strategy/transcripts/`).

## Contents

| File | What it is | Feeds gap |
|---|---|---|
| [smt-divergence-spec.md](smt-divergence-spec.md) | SMT (ES↔NQ) mechanics + leading/lagging asset rule, distilled into an implementable spec | **Gap #2 — SMT/leading asset (absent on main)** |
| [smc-mechanical-reference.md](smc-mechanical-reference.md) | `joshyattridge/smart-money-concepts` algorithms (FVG/BOS/CHoCH/OB/liquidity) vs our engine | Bot detection · Pine engine correctness |
| [smc-source-reference.py](smc-source-reference.py) | Raw upstream `smc.py` (MIT) — the actual detection code | same |
| [pine-v6-htf-non-repaint.md](pine-v6-htf-non-repaint.md) | Pine v6 non-repainting HTF request pattern | Pine engine correctness |
| [ict-daily-bias-external.md](ict-daily-bias-external.md) | Third-party daily-bias method (City Traders Imperium) — corroborates the 3-vote model | **Gap #1 — grade model** |
| [lanto-method-transcripts/](lanto-method-transcripts/) | 5 fresh Lanto YouTube method-video transcripts (his words) | Gaps #1, #3, #7 · oracle extension |
| [lanto-method-transcripts/extracted-rules.md](lanto-method-transcripts/extracted-rules.md) | Rules pulled from those transcripts, cited to video+text | same |

---

## Headline findings (mapped to the ranked gaps)

### Gap #1 — grade model (bot uses *alignment*; Lanto uses a *3-vote count*) — **CONTRADICTS**
A **fresh Lanto transcript independently confirms the exact 3-step model** the
source-of-truth already cites from the class recording:

> "Step one, higher time frame bias… Step two, overnight… Step three, the opening range
> move." — *3M From 3 Steps Strategy* (`kBAZYIqlLMg`)

Same FVG-quality definition too: "a good fair value gap has a strong displacement
sequence, takes previous liquidity, and clean candle bodies." This is two independent
Lanto sources for the same grade model, strengthening the case that
`deriveGrade` should count three votes (HTF · overnight · NY-open) rather than gate on
`htfLtfAlignment`. The third-party City Traders Imperium guide corroborates the inputs
(daily/4H order flow → dealing range → external liquidity → Asian sweep trap → MSS +
OTE entry) but Lanto's own words remain the authority.

### Gap #2 — SMT / ES↔NQ leading asset (**absent on main**) — biggest unfilled gap
The SMT crawl gives a clean, mechanical spec for the thing the bot is missing:
- SMT = two correlated assets (for us **ES/NQ**, tightest pair) print **opposite
  structure on the same timeframe**: one makes a HH, the other fails (LH) → the failing
  asset is "manipulated" → **bearish** reversal. Mirror for bullish (one LL, other HL).
- It is a **confirmation, not an entry** — only valid when it forms **at a key zone**
  (FVG/OB/PD-array/liquidity). This matches our chain: SMT would gate/raise grade at the
  walker's PD array, not spawn trades on its own.
- The **lagging asset is usually the cleaner trade** (more stable structure).
- This reconciles with the prior internal attempt (memory `smt-leader-selection`, PR
  #134 unmerged: requires *opposite* signs = real SMT). The external spec validates
  "opposite signs" as the correct test and adds the "must be at a zone" gate the earlier
  version lacked. See [smt-divergence-spec.md](smt-divergence-spec.md).

### Gap #3 — MSS significance gate (any rejected sweep qualifies) — **PARTIAL**
Lanto (3-steps + entry transcripts) ties a valid MSS to **significant liquidity + a
matching displacement leg** — not any rejected sweep. The SMC `bos_choch` reference
formalizes BOS vs CHoCH off confirmed swing pivots, useful as a stricter structural
definition than "rejected sweep." See [smc-mechanical-reference.md](smc-mechanical-reference.md).

### Bot detection / Pine correctness
- SMC's mechanical FVG/swing/BOS/OB/liquidity definitions are a clean cross-check for
  our Pine engine and walker logic. Notable: SMC `liquidity` clusters equal highs/lows
  within `range_percent` (default 1%) — a concrete recipe for liquidity-pool detection
  if we ever want to tighten ours.
- **Pine v6 non-repaint rule**: any HTF `request.security()` must use `close[1]` +
  `barmerge.lookahead_on` or it repaints on the realtime bar. Relevant if the engine
  ever pulls HTF series in-Pine (today we switch the chart per-TF via the CLI, which
  sidesteps this — but worth recording). See [pine-v6-htf-non-repaint.md](pine-v6-htf-non-repaint.md).

## Sources
- SMT: [tradingfinder](https://tradingfinder.com/education/forex/ict-smt-divergence/) · [innercircletrader.net](https://innercircletrader.net/tutorials/ict-smt-divergence-smart-money-technique/) · [TradingView SMT NQ vs ES script](https://www.tradingview.com/script/QDq5dTaK-SMT-Divergence-NQ-vs-ES/)
- SMC source: [github.com/joshyattridge/smart-money-concepts](https://github.com/joshyattridge/smart-money-concepts) (MIT)
- Daily bias: [City Traders Imperium](https://citytradersimperium.com/daily-bias-ict-concepts/) · [ChartingLens ICT guide](https://chartinglens.com/blog/ict-trading-strategy-guide)
- Pine v6: [TradingView Pine docs — other timeframes & repainting](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data)
- Lanto: [YouTube @lantotrades](https://www.youtube.com/@lantotrades)

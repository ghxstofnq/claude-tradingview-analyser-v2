# SMT divergence — implementable spec (gap #2)

Distilled from the SMT crawls (tradingfinder / innercircletrader.net) + ICT's original
definition. This is the reference for closing the **#2 ranked fidelity gap** (SMT /
ES↔NQ leading asset, absent on `main`). Our own words; sources linked at bottom.

## What it is

SMT (Smart Money Technique / Divergence) = **two correlated assets print opposite market
structure on the same timeframe**. For us the pair is **ES (MES) ↔ NQ (MNQ)** — the
tightest, most predictable index pair, the one ICT introduced SMT on (2022).

Three components must all be present for SMT to be meaningful:
1. **Inherent correlation** — ES/NQ normally move together (satisfied by construction).
2. **Structural divergence** — one index makes a new high/low; the correlated one fails.
3. **Smart-money footprint in the zone** — the divergence sits at an FVG / OB / PD-array
   / liquidity pool. Without this, the divergence is noise.

## The leading/lagging rule (the thing the bot is missing)

| Direction | Setup (positive correlation) | Manipulated (failing) asset | Bias |
|---|---|---|---|
| **Bearish SMT** | both trending up; one makes **HH**, the other makes **LH** (fails to make HH) | the one that made the **LH** | **bearish reversal** |
| **Bullish SMT** | both trending down; one makes **LL**, the other makes **HL** (fails to make LL) | the one that made the **LL** | **bullish reversal** |

- The asset that **fails to confirm** is the "manipulated" one — it reveals the truth.
- The **lagging asset is usually the cleaner trade** (more stable structure, better R:R).
- SMT is a **confirmation, not an entry**. Price must first reach a key zone; SMT then
  confirms the order flow. Entry is the normal model (FVG/OB tap + 1m confirm); SMT
  raises conviction / un-gates the side.

## How it should plug into our chain

- **Not a setup producer.** Per the single-brain rule, the walker chain stays the only
  producer. SMT is a **grade/side input**, evaluated at the walker's PD array.
- **Where:** at open-reaction resolution and/or at packet build, compare the leader's
  swing structure to the other index's over the same window. Opposite signs at a zone =
  real SMT (this is the test PR #134 got right — memory `smt-leader-selection`).
- **Effect:** SMT-confirmed side → allow / bump toward A+; SMT against the proposed side
  → block or cap. Aligns with the side-vs-bias gate already in `deriveGrade`.
- **Leader selection:** "which index to trade" = the **lagging** one (cleaner). We
  already pick a PAIR_PRIMARY; SMT gives a principled per-session reason to pick it,
  rather than a static default.

## What the earlier attempt missed (memory `smt-leader-selection`, PR #134)

PR #134 correctly required *opposite signs* (real SMT, not a magnitude gap) but was
"NEUTRAL, no edge yet" on the June 8–12 paired week. The external spec suggests why:
SMT was likely evaluated **structurally only**, without the **"must be at a key zone"**
gate (component #3). Re-test idea: only count SMT when the divergence pivot coincides
with a tracked FVG/OB/liquidity level — fold old-vs-new on the paired corpus.

## Data we already have for this

- `engine_by_tf.<tf>.swings[]` per symbol (HH/HL/LH/LL with `is_high`) — both legs of the
  comparison exist once both symbols are captured (paired `tv analyze --pair`).
- `gates.engine.pillar1.liquidity_pools` / session levels — the "key zone" for component
  #3.
- Pair capture already runs (`brief_digest.symbols.<sym>`), so both structures are in one
  bundle.

## Open calibration questions (fold to answer)

1. Window for the structure comparison (per-session swing tier? last N pivots?).
2. Whether SMT only un-gates (permissive) or can also block a counter-SMT side.
3. Whether to switch PAIR_PRIMARY to the lagging asset per session, or keep static.

## Sources
- [tradingfinder — ICT SMT Divergence](https://tradingfinder.com/education/forex/ict-smt-divergence/)
- [innercircletrader.net — SMT Divergence](https://innercircletrader.net/tutorials/ict-smt-divergence-smart-money-technique/)
- [TradingView — SMT Divergence NQ vs ES (julioperez75955)](https://www.tradingview.com/script/QDq5dTaK-SMT-Divergence-NQ-vs-ES/)
- Internal: [`lanto-source-of-truth.md` §6](../../strategy/lanto-source-of-truth.md), memory `smt-leader-selection` (PR #134)

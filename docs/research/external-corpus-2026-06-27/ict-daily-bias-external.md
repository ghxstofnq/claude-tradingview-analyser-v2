# ICT daily bias — third-party corroboration (gap #1)

Distilled from City Traders Imperium + ChartingLens. **Supplementary** — Lanto's own
transcripts remain the authority for our spec. Useful because it independently describes
the same top-down bias method and the Asian-sweep trap.

## The method (CTI)
1. **Daily / 4H order flow** — confirm the direction of the higher-timeframe delivery.
2. **Map the current dealing range** — premium vs discount of the active range.
3. **Tag external liquidity** — last ~3-day highs/lows, equal highs/lows, the pools price
   is drawn to.
4. **Note the draw** — order blocks / FVGs price is magnetized toward.
5. **Asian-session sweep = the trap** — a grab of the **Asian low** then a sharp reversal
   flags a **bullish** day; a sweep of the **Asian high** tips a **bearish** agenda.
6. **Execute on 5m–1h** — wait for a **market-structure shift** + a **62–79% OTE
   pullback** into the POI; stop beyond the liquidity wick/block; target the next pool.

## Key reframing (matches Lanto)
> Daily bias is **where price will reach for liquidity inside today's candle — not how
> the candle closes.** Without it: overtrading, chasing reversals, getting stopped by
> liquidity hunts.

## Where it maps
- "Asian sweep → reversal" = our **overnight verdict** (`computeOvernightVerdict`) — which
  the audit flags as **inert in the grade** (gap #1). This external source treats the
  overnight sweep as a *primary* bias input, reinforcing that overnight should vote.
- "Dealing range premium/discount" + "draw toward OB/FVG" = our **primary_draw** selection
  (near-price draw is gap #4 — distance computed but not ranked).
- "MSS + 62–79% OTE into POI" = our entry confirmation + retrace logic. **MATCH.**

## Sources
[City Traders Imperium — Daily Bias](https://citytradersimperium.com/daily-bias-ict-concepts/) ·
[ChartingLens — ICT Trading Strategy Guide](https://chartinglens.com/blog/ict-trading-strategy-guide)

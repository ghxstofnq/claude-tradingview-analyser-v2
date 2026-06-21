# Faithful Lanto Rebuild — Confirmed Decisions

Running ledger of part-by-part definitions, each **confirmed by the user** with Lanto's
transcripts as the truth. The spec docs ([../strategy/](../strategy/README.md)) and the
oracle ([../strategy/lanto-oracle.md](../strategy/lanto-oracle.md)) get reconciled to this
ledger once the definition phase is done. Tags: BIAS · ENTRY · TRADE24 · PRICE · RISK.

---

## Part 1 — The grade  ·  CONFIRMED 2026-06-21

The grade is **nested**, not a flat 3-vote count.

- **No trade unless all three *pillars* are present/clear:** draw-bias, price-action,
  entry-model. *"without all three there are no takes."* (PRICE 04:05); *"we have three
  components… draw bias, price action, and an entry model… it gives us our grade."*
  (PRICE 02:13)
- **Draw-bias clarity = the count of {HTF analysis, overnight price, NY-open reaction}:**
  1/3 → no trade · 2/3 → caps at B · 3/3 → A+-eligible bias. (BIAS 22:25; bridged at 21:29:
  the NY-open is *"green light for one of your three trading components… your draw bias is
  completely confirmed once you have these three settled."*)
- **A+ = all three pillars A+** (bias 3/3 **and** price-action good **and** entry-model
  clean). Any pillar weaker → B. **Price-action is a grading pillar, not just a gate.**
  (PRICE 03:09 — "all three components A+ → A+ sizing")
- **Conflict** (NY open reverses the established bias): **hands off / wait** — *"that simply
  means our timing is not there yet… we simply are hands off."* (BIAS 18:42). Not a B
  retrace-trade.
- **Flip the bias only on:** HTF invalidation (price inverts the HTF gap) **or** an LTF
  sweep-reversal **with mass displacement**. (BIAS 25:44)
- Vocabulary note: Lanto says "B+"; the system enum is `A+ | B | no-trade`.

**Reconciliation TODO:** `daily-bias.md` §1, `README.md` grade table, and
`lanto-oracle.md` Part A currently state the *flat* count — update them to this nested
structure when reconciling.

---

## Part 2 — Price quality (Pillar 2)  ·  CONFIRMED 2026-06-22

- **Judged relative to the instrument's own normal / recent state of delivery** — not
  fixed numbers, not a body-ratio. *"identifying how price has been as opposed to normal
  state of delivery"* (PRICE 12:26); *"compare an average PDA… as opposed to price back in
  July… PDAs now are a lot smaller"* (PRICE 13:24).
- **Good gap = two factors:** displacive (bigger than recent-normal) **+** took liquidity in
  creation, and **near price**. (PRICE 14:20)
- **Benchmark floor = the typical stop:** a gap ≈ the typical stop (~20pt on NQ) is too
  small to be a magnet / won't get respected. (PRICE 10:34–11:30)
- **States → grade:** good (displacement/engulfing, minimal wicks, fluidity, clear PDAs) →
  A+-eligible · marginal / 50-50 / smaller-than-normal → downsize → B · consolidation /
  tight-vs-normal range / dojis → stand aside (no-trade). (PRICE 15:16, 30:12–31:07)
- **Fractal:** judge on HTF (4H/daily/hourly) **and** LTF (1m/5m delivery + the confirmation
  candle).
- Implementation note: "normal delivery" = a rolling baseline of recent gap/range size (ATR
  is the mechanical proxy) + the typical stop as the floor. Not hardcoded points.

---

*(Part 3 — entry models: pending confirmation.)*

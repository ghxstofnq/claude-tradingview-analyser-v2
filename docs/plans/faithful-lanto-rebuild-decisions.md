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

*(Part 2 — price quality: pending confirmation.)*

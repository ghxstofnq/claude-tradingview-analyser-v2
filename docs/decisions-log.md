# Decisions log

Date-stamped, one entry per decision. Per the strategy-full-spec mandate
(2026-06-13): when the strategy documents are silent or ambiguous, the
decision is resolved by re-reading the docs, then by web research into
ICT/SMC source conventions, and logged here with the evidence that drove it.
The user is unavailable for rulings during the campaign; the only thing never
decided unilaterally is overwriting an existing hand grade.

Doc shorthand: **TS** = `docs/strategy/trading-strategy-2026.md`,
**EM** = `docs/strategy/entry-models.md`.

---

## 2026-06-13 — Immutability baseline frozen

**Decision.** The hand-graded refold outputs are frozen as the regression
baseline in `docs/audits/refold-baseline.json`, enforced by
`scripts/refold-gate.mjs`:

| Session | total R | trades | status |
|---|---|---|---|
| June 9 AM | +10.01R | 5 (4W/1L) | FROZEN |
| June 10 AM | +1.35R | 6 (2W/4L) | FROZEN |
| June 11 AM | −1.00R | 1 closed (0W/1L) + 1 open | FROZEN |
| June 11 PM | 0.00R | 0 closed | OPEN (13:30 stop question) |

**Why.** The user hand-graded June 9 / June 10 / June 11 AM trade-by-trade;
those rulings are data, not questions. No rule change ships if it moves a
frozen session's entries, stops, TPs, outcomes, or total R. June 11 PM is
explicitly the open question (its 13:30 ET / 17:30 UTC trade carries a
pathological 333-pt failed-leg stop) and is tracked-but-not-gated until
resolved.

**Evidence.** `node scripts/refold-gate.mjs` reproduces all four from the
recorded tapes through the live truth fn; baseline frozen 2026-06-13.

---

## 2026-06-13 — TP1 books the full position (no TP2/runner accounting)

**Decision (frozen, no code change).** The deterministic engine books the
entire position at TP1 and reports realized R as the TP1 multiple
(`|exit−entry|/|entry−stop|`); TP2/runner is reported on the packet but not
separately accounted.

**Why.** Every frozen baseline R total (+10.01R, +1.35R, −1R) was computed
under TP1-books-all. TS §6 / §7 Step 7 describe two-stage profit-taking
(intraday liquidity first, HTF draw second), so a runner leg is strategy-
faithful — but switching the accounting would move every frozen R total.
Revisit only with explicit user sign-off; until then this stays as-is and the
gap is documented, not silently approximated. (Audit gap G7.)

---

## 2026-06-13 — Confirmation discipline is 1m-close

**Decision (frozen, no code change).** Confirmation closes are evaluated on
the 1m candle close. TS §5 / §7 Step 6 and EM (all three models) permit
"1m **or** 5m" closes.

**Why.** The hand-graded days settled on 1m-close discipline and were graded
correct trade-by-trade under it. Admitting 5m closes as independent
confirmations would add entries on the frozen days. The 5m variant stays out
unless a recorded tape demonstrates a doc-valid setup the 1m discipline
misses. (Audit gap G8.)

---

## 2026-06-13 — Inversion entry is the aggressive (violating-close) variant

**Decision (frozen, no code change).** The Inversion model enters on the
candle that closes through the opposing FVG (EM Inversion §4 "Aggressive
approach … enter on the initial close that violated the FVG"). The
conservative retest variant (EM Inversion §4 "Conservative approach") is not
implemented.

**Why.** The user's June 9 / June 10 rulings graded the violating close as
THE entry. Implementing the retest variant as an alternative would change
graded entries. Intentionally out of scope. (Audit gap G9.)

---

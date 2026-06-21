# Risk, Sizing & Management

How Lanto sizes and manages trades. Source: *Understanding Risk: Prop Firms & Personal
Account* (10/2/2025, `sN83BHNBzJo`), plus the stop/target rules from the entry-model
classes.

---

## Accounts: prop vs personal

Two account types, different management:

- **Prop (capped firms):** protect the cap. Either trim 50% at TP1 and ride the rest to
  the ultimate target, or **size to the R** and bank 100% at TP1 (risk only what's
  needed to make the goal — a 2R-plan trade risks half to make 1R at TP1). Don't trim
  early before the planned target — that takes on risk for no purpose.
- **Personal / uncapped:** can let trades run. Lanto's own style is **no trim — play
  with the trail**, holding through targets until trailed out on a structure change.

> "For my cash account and uncapped firms I just play with the trail — enter, hold, hold,
> hold even through targets, until I get trailed out and we see a structure change."
> (RISK ~13:07–13:59)

---

## Targets: TP1 ≈ 1–1.5R, ultimate ≈ 2R+

- **TP1 (first target):** intraday liquidity — an internal swing or session high/low —
  typically **1–1.5R**.
- **Ultimate target:** the **HTF draw** (4H/daily/weekly high or low), typically
  **2R+**. This is the runner's destination.

> "Typical target one is about a 1 to 1.5R; our ultimate target is typically a 2R-plus —
> a 4-hour high, daily high, game-plan high." (RISK ~01:54–03:44)

Take profits **first** at intraday liquidity, **second** at or toward the HTF draw if
price/action supports continuation.

---

## Management styles

Three valid styles (pick one and be consistent):

1. **Trim 50% at TP1 + stop to break-even + ride to the ultimate target.** Guarantees
   profit, keeps upside. (Prop-lenient / personal "trader 1".)
2. **100% trim at TP1, sized to the R.** Risk is pre-set to the planned R so TP1 meets
   the goal; nothing left on. (Capped/aggressive prop "trader 2".)
3. **No trim — ride the trail.** Hold the full position through targets; move the stop up
   structurally; exit on a market-structure change. (Lanto's personal style.)

> "Trader one trims half at target one, stops to break-even, rides the ultimate target.
> Trader two takes 100% at target one, adjusting dollar risk to the R. I'd rather let the
> trade pan out and ride the trail." (RISK ~04:40–13:59)

On a TP1 hit (style 1 or 3): **move the stop to break-even**, then manage the runner.

---

## R-based sizing (size to the planned R)

Predetermine the trade's R, then set dollar risk against it — don't take full risk and
cut short before the target.

> "If you have a 2R-plan trade and your goal is the 1R take-profit, put on $250 of risk
> to make that 1R, not $500. Scale into what the R is — don't take unnecessary risk and
> trim early." (RISK ~05:36–09:24)

---

## Day-of-week sizing

> "Mondays and Fridays half risk ($250); Tuesday, Wednesday, Thursday full risk ($500)."
> (RISK ~00:56–01:54)

<a id="sizing-table"></a>

### Sizing table

Canonical sizing is a **lookup** by `day_of_week × grade` (cited as
`strategy.sizing-table`):

| Day      | A+   | B    |
|----------|------|------|
| Mon      | 0.5R | 0.5R |
| Tue      | 1.0R | 0.5R |
| Wed      | 1.0R | 0.5R |
| Thu      | 1.0R | 0.5R |
| Fri      | 0.5R | 0.5R |
| no-trade | 0    | 0    |

Reasoning: Mon/Fri are reduced regardless of grade (news, weekend risk, lower
liquidity). On core days (Tue–Thu) the grade gates size — A+ alignment gets full R, B
gets half. Tue–Thu B and Mon/Fri (any grade) all land at 0.5R; that's intentional, not a
multiplication.

Memory overrides live in `state/memory/USER.md`. If USER.md contains a matching `skip`
rule (e.g. "skip PCE Wednesdays"), the sizing helper returns `r_size: 0` with
`override_reason` set.

---

## Stops (structural)

Stop at **structural invalidation** — the point that, if reached, unwinds the setup:

- **MSS:** a few ticks below the MSS low (or below the FVG low).
- **Trend:** below the swing low that touches the FVG (deepest pullback point), or below
  the FVG low.
- **Inversion:** below the candle that closed through the FVG, or below the inversion
  FVG low / failed-leg extreme.

> "Always place a stop at the invalidation point — slightly under the fair value gap, or
> under the relative low." (TRADE24 ~09:02)

---

### Implementation status

Day-of-week sizing (the table above), the no-trim runner/trail with stop-to-BE on TP1,
ultimate-target = HTF draw, and structural stops are **faithful**. The bot codes only
the no-trim style (the trim variants are intentionally omitted), and applies a **hard
1.5R floor** on TP1 (the high end of Lanto's 1–1.5R). Details + `file:line`:
[`lanto-source-of-truth.md`](lanto-source-of-truth.md) §4.

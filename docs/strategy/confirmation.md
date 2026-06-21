# Confirmation

Confirmation is the final gate before entry — it chooses the **exact moment** to step in
once bias (Pillar 1) and an entry model (Pillar 3) are set. Source: *How I Trade The
Stock Market 2024* (`TGIUjVBBemo`), which is largely about confirmation, plus the
entry-model class.

> "Confirmation is always just a candle close in the direction you want to see price
> favored." (TRADE24 ~23:57)

---

## The rule: a 1-minute candle close

Confirmation is a **1-minute candle close** in the trade direction. Lanto uses 1m
confirmation on every gap (1m or 5m), every model.

> "Confirmation is one-minute confirmation on every single gap. I don't use 5-minute
> confirmation on a 5-minute gap — one-minute confirmation on every gap." (ENTRY ~04:43)
> "If I post a 30-minute or 5-minute trade idea, I'm looking for a 1m or 5m close. We're
> short-term traders, we leverage hard — a 1-minute close is good enough." (TRADE24
> ~24:58)

The close must be **deliberate**: a strong body, sharp displacement, **minimal wicks**.
A sloppy wick-through or a weak close is not confirmation.

> "When it comes to confirmation it always has to be deliberate. If I see a wick, if I
> see sloppy delivery, I do not take. I'm always looking for deliberate execution
> through the respect of the gap." (TRADE24 ~09:02)

What the close does per model:

- **MSS / Trend (FVG entry):** price taps the FVG, then a candle closes back **above**
  (long) / **below** (short) the zone, respecting it — that respect is the confirmation.
- **Inversion:** a candle closes **through** the opposing FVG (invalidating it). The
  violating close itself is the confirmation; an optional retest of the inversion zone
  can add a second close.

---

## Speed and the in-the-money tell

A good confirmation enters **into speed** — price is already accelerating, so the trade
goes in the money almost immediately. That is the signature of correct timing.

> "As soon as you enter you had zero drawdown — the trade hit in the money instantly.
> These are the best. It's always based off speed; when you time speed and price
> correctly, the trade goes in the money instantly or hits stop instantly." (TRADE24
> ~15:59, ~21:57)

This is why a confirmation that lingers is suspect — see the 10–15-minute rule.

---

## Never enter on a tap alone

A liquidity grab + a single gap inversion is **not** an entry. Many ICT traders take the
first tap; Lanto waits for the close.

> "They see a fair value gap get tapped, or a gap inverted, and they never use
> confirmation — and they get run. That's what separates us: I wait for the close, the
> respect, the displacement." (ENTRY ~15:53–16:49)

## The 10–15-minute rule

If price taps the zone and then **fights** inside it for more than ~10–15 minutes without
a clean confirming close, the trade is dead — that is bad price, not a setup.

> "If you ever see a one-minute entry fight for longer than 10–15 minutes, that's not an
> entry you should be taking." (PRICE ~25:34)

---

## Good vs bad confirmation

- **Good:** liquidity taken → sharp reversal → tap the gap → a strong, full-body 1m
  close back through the zone with little wick, into speed. Trade goes green fast.
- **Bad:** no significant liquidity taken; weak/retrace displacement; price chops or
  wicks in the gap; the "close" is a doji or barely clears the zone. Skip it.

> "We never got deliberate, sharp, convincing displacement here — so I completely
> invalidated it." (TRADE24 ~09:02, ~17:58)

---

### Implementation status

The 1m-close confirmation (`confirm_close` + CE-held + 15m-chop guard) and the
15-minute fight-timeout are **faithful**. The explicit **candle-body / engulfing**
discipline is only enforced on the Trend wick-tap path (body ≥ 0.6); the main path
trusts the engine's confirmation flags. Details + `file:line`:
[`lanto-source-of-truth.md`](lanto-source-of-truth.md) §3.4.

# Price-Action Quality (Pillar 2)

How Lanto judges whether the environment is tradable. Once bias is formed (Pillar 1),
this pillar filters it: good price → trade; bad price → stand aside or heavily downsize.
Source: *How To Identify Price Action* (`nEAGVMAJypE`).

> "You can never outrade bad price. That's what's key." (~27:25)

Price is **fractal** — these checks apply on every timeframe (Daily/4H/1H for the
environment, 15m/5m/1m for the entry). Quality is judged **relative to the instrument's
own recent/normal delivery** — compare current gaps/range to the recent average, and
benchmark gap size against the typical stop — **not** fixed point values. *(PRICE 12:26–14:20)*

---

## Displacement is the core tell

Good price **displaces**: wide, flush, engulfing candles with **minimal wicks**, leaving
clean inefficiencies. Bad price **consolidates**: mass wicks, dojis, back-and-forth.

> "Ideally you see price create displaces all the time, you don't see many wicks, you
> see fluidity. When price is more consolidative… it's content and demotivated to move."
> (~15:16–16:12)

- **Engulfing / flush** candles, one side clearly in control → directional, tradable.
- **Doji / heavy-wick** candles, buyers and sellers batting back and forth → 50/50, do
  not put on size.

> "A bull wick tells you price looked to draw higher then sellers stepped back in. When
> that happens consistently on the 5m, buyers and sellers are battling — don't put
> massive risk on during that delivery." (~30:12–31:07)

---

## Gap size = inefficiency = draw magnetism

A PD array's **size is its pulling power**. A big gap holds far more resting orders, so
price is motivated to fill it; a small gap does not move the market.

> "A 130-point 4H gap means a lot more orders than a 20-point gap. A 20-point 4H gap is
> the size of a normal stop — that doesn't give the market motive to move to that zone."
> (~09:37–11:30)

- Prefer **large, displacive** gaps as draws and targets.
- A tiny gap is a weak destination even if it is otherwise valid — weight size when
  choosing what price is actually drawn to.

---

## Stand aside on tight consolidation

If the recent range is tight relative to normal, the market has no identity — don't
trade it.

> "Heavy wicks on each candle, zero continuation, a 28-point range in three hours on NQ.
> That is unacceptable." (~29:17–30:12)

A multi-hour micro-range with no PD-array creation = no-trade, regardless of bias. Hold
shift-drag the range to gauge it; if it's a small chop band, stand aside.

---

## Candle anatomy

- **Engulfing / flush** (little wick) → directional move likely.
- **Doji / mass-wick** → indecision; lower probability.
- On the entry, you want the confirmation candle to engulf with a strong body and close
  away from the zone (see [`confirmation.md`](confirmation.md)).

---

## The 10–15-minute rule

Price quality also shows up in **how an entry behaves**: a 1m entry that fights inside a
gap for more than ~10–15 minutes is bad price — that is not the market telling you it
wants the move.

> "If you ever see a one-minute entry fight for longer than 10–15 minutes, that's not an
> entry you should be taking." (~25:34)

---

### Implementation status

The engine emits displacement (clean/acceptable/weak) and candle quality
(doji_wick/engulfing/normal), and A+ requires clean/acceptable displacement — **MATCH**.
But **gap size does not gate target validity** (a tiny gap can still be a TP), and there
is **no hard stand-aside** on tight consolidation (only a soft retrace-day cap). The
15-minute fight-timeout is implemented. Details + `file:line`:
[`lanto-source-of-truth.md`](lanto-source-of-truth.md) §2.

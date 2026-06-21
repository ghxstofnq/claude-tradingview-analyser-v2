# Daily Bias (Pillar 1 — Draw & Bias)

How Lanto decides where price is drawn and which way the day leans. Source: *How I
Develop Daily Bias* (12/12/2025, `kix1SDRSCiU`), plus the bias material in *How To
Identify Price Action* and the entry-model classes.

> "It's very simple… four simple slides. Higher-time-frame analysis, overnight price,
> opening range move — and then combine all three." (~00:00, ~21:29)

---

## §1. Three components and the grade

Bias is built from **three components**, read in order:

1. **HTF analysis** — Daily / 4H / 1H draw (§2).
2. **Overnight price** — Asia / London behavior (§3).
3. **NY-open reaction** — the opening-range move (§4).

The day's grade is **a count of how many align**:

| Aligned | Grade | Action |
|---|---|---|
| 1 of 3 | — | No trade |
| 2 of 3 | B | Trade, lower conviction |
| 3 of 3 | A+ | Trade, full conviction |

> "One out of three — you do not take a trade. Two out of three — it's not A+, but you
> can trade. Three out of three — it is A+. … This week nothing's been A+ because we've
> only had overnight price and the opening range move — no higher-time-frame look."
> (~21:29–22:25)

A 2/3 day is **tradable with no HTF read** (overnight + open reaction alone). Do not
require an HTF draw to trade — require two of the three components.

---

## §2. HTF analysis (Daily → 4H → 1H)

Keep HTF simple: **fair value gaps / inversion FVGs** and **buy-side / sell-side
liquidity**. Work top-down: Daily, then 4H, then 1H.

**Marking a draw — two requirements** (the same two used for entries, §
[entry-models.md](entry-models.md)):

- **Displacive** — a large gap created by a wide, clean body (not wickage).
- **Took liquidity in creation** — swept a prior high/low as it displaced.

> "How do you know which gaps to mark out? Displacement, and a gap that also takes
> liquidity." (~04:42)

**Near price.** Prefer the array **nearest current price** — a realistic destination
for *today*, not a far map.

> "It's always areas of interest where it's near price… near price ideally is where I
> look to go for — a realistic area where price could come in today." (~04:42)

**Pick one primary draw** (prefer a clean 4H PD array) and read the **reaction** off it
to set bias: e.g. price fills a 4H BPR and rejects sharply → bearish toward the lower
sell-side. You only need a near-term draw zone to align with 1m/5m scalps.

---

## §3. Overnight (Asia / London), recency-weighted

Second component: how Asia and London handle liquidity before New York. One session
**creates** liquidity, another **delivers** into it (e.g. London raids Asia's high/low).

- Mark **Asia High/Low** and **London High/Low**; note which side is left **untaken**
  (a draw into NY).
- Read **overnight direction** and weight it by recency:

> "If overnight price is bearish, momentum is in sync with HTF — that sways my bias even
> more bearish. If overnight is strictly consolidation, I won't have a dedicated bias
> yet. I like utilizing recency bias." (~12:11–16:50)

- Overnight **bearish** → lean bearish; **bullish** → lean bullish; **chop** → stay
  neutral (no dedicated bias yet).

This is a directional vote, not just a set of levels.

---

## §4. NY-open reaction (reject vs invert)

Third component, and the one that confirms or denies the bias: the **opening-range
move** in the first **15–30 minutes** after 9:30 ET. It is **the reaction**, not the
initial liquidity grab, that matters.

> "It's not the initial liquidity we take — it's the reaction. Reaction gives lower-
> time-frame outlook; also confirms or doesn't confirm higher-time-frame bias." (~20:33)

At the key HTF gap / overnight level there are **two outcomes**:

- **Reject** — price taps and closes back through the level (sharp rejection,
  displacement away) → trade in that direction (continuation of the bias).
- **Invert** — price closes **through** the gap → **flip** the bias.

> "Whatever we do off this hourly — reject or invert — will dictate my narrative. Reject
> aggressively and trade below the low again → much lower is valid. Invert the hourly
> gap → flip bias." (~11:14, ~25:44)

Read it as **extension vs retrace**: break + rejection toward the HTF draw → today
extends (A+ potential, aligned). Break + continuation **against** the draw → treat today
as a retrace day, adapt intraday, but keep the HTF draw for later. **Never marry the
bias** — let the open confirm or challenge it. (Timing: the reaction is usually clear by
~9:45.)

---

## §5. Flexibility & flipping bias

- **A+ alignment** — HTF, overnight, and the NY reaction all point the same way.
- **Conviction-but-not-A+ (B)** — HTF one way while the LTF plays a short-term retrace
  first; still tradable at lower conviction, more emphasis on local liquidity.
- LTF may **override HTF intraday** for scalps, but the HTF idea is not abandoned — if
  price keeps respecting HTF PD arrays without reaching the draw today, the draw stays
  valid for later.

**Do not flip the day off a single event.** A lone gap-inversion or one liquidity grab
is not enough — especially against a strongly directional overnight. Require **more
displacement / multiple arrays invalidated** before reversing.

> "Just because one gap inverts doesn't mean we'll disrespect the next and seek higher
> and higher. I need more displacement, multiple arrays invalidated, before I long a
> reversal — especially with overnight bearish." (~30:39–32:21)

---

## §6. SMT / leading asset (ES ↔ NQ)

Lanto trades NQ (MNQ) and ES (MES) together and constantly reads one as the **leader**:

> "ES is a bit more leading… NQ was the weaker asset… as soon as ES showcased that sell,
> that told me price most likely were to drive lower — so I flipped on ES and looked to
> ride NQ." (~36:32–37:28)

- Watch for **divergence**: when one index makes a new high/low and the other does not,
  the **stronger/leading** asset signals direction; the weaker one is the trade vehicle.
- Use the leader's displacement to **confirm or flip** the open-reaction read.

---

## §7. Sessions & timing

| Session | Window (ET) |
|---|---|
| Asia | 18:00 – 03:00 |
| London | 03:00 – 09:30 |
| New York | 09:30 – 16:00 (open-reaction window = first 15–30 min) |

- **New York** is one continuous block; the open-reaction read resolves by ~9:45.
- **Asia** is traded differently: only when it first shows a good directional move —
  *"I never trade Asia unless price first shows a good move; if it's slow, don't trade"*
  (~40:23). Wait for the initial move rather than an opening-range read off a prior
  session.
- **London** is traded like New York (open-reaction logic applies).

---

### Implementation status

The bot derives HTF bias and the open reaction faithfully (§2 selection, §4
reject/continuation, exact 15/30-min window), but **diverges** from this doc on: the
grade (it grades by alignment and cannot trade a no-HTF 2/3 day — §1), overnight as a
vote (computed but inert — §3), near-price selection (§2), the single-event bias flip
(§5), and SMT/leading-asset (absent — §6). London is truncated to 03:00–06:00 and Asia
is not tradable (§7). Details + `file:line`: [`lanto-source-of-truth.md`](lanto-source-of-truth.md) §1, §7.

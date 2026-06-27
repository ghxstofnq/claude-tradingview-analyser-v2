# Daily Bias (Pillar 1 — Draw & Bias)

How Lanto decides where price is drawn and which way the day leans. Source: *How I
Develop Daily Bias* (12/12/2025, `kix1SDRSCiU`), plus the bias material in *How To
Identify Price Action* and the entry-model classes.

> "It's very simple… four simple slides. Higher-time-frame analysis, overnight price,
> opening range move — and then combine all three." (~00:00, ~21:29)

---

## §1. Three components and the (nested) grade

Bias is built from **three components**, read in order:

1. **HTF analysis** — Daily / 4H / 1H draw (§2).
2. **Overnight price** — Asia / London behavior (§3).
3. **NY-open reaction** — the opening-range move (§4).

**These three score the draw-bias pillar** — count how many align:

| Bias components aligned | Draw-bias pillar |
|---|---|
| 1 of 3 | unclear → no trade |
| 2 of 3 | clear, **capped at B** |
| 3 of 3 | fully confirmed → **A+-eligible** |

> "One out of three — you do not take a trade. Two out of three — not A+ but you can
> trade. Three out of three — A+. … your draw bias is completely confirmed once you have
> these three settled." (~21:29–22:25)

Draw-bias is **one of three pillars** (with price-action and entry-model); the overall
A+/B grade is **nested** — but it is **not a hard cap on the bias count**. A 3/3 bias is
**one path to A+**; the **entry model is another**. On **2026-02-09** Lanto graded a *2/3*
bias day A+ because the ENTRY was a **multi-alignment** (a 5m FVG rebalance *and* a 1m
bearish-FVG-to-bullish inversion, confirming one long): *"I feel like this entry model with
today's trade was [an] A plus because we ended up utilizing a five-minute gap rebalance…
and also an inversion fair value gap entry… in one"* (ENTRY 27:05). So:

- **A+** = the three pillars **align (no conflict) with high conviction** — via *either* a
  3/3 bias *or* a **multi-alignment entry** on an otherwise-aligned 2/3 day. Multi-alignment is
  Lanto's *"two-and-one"*: **two imbalances confirming one move** (e.g. a 5m FVG rebalance **and**
  a 1m inversion *in one*, ENTRY 27:05 / 31:25). A **single** entry — even a clean, strongly-
  displaced one — is a *good* entry but **NOT** an A+ elevator.
- **B** = aligned but **one element is marginal** — a single/ordinary entry (even a clean one) at a
  2/3 bias; or a sloppy entry *even at 3/3*. Strong displacement + a good candle close is the bar to
  *trade* it (BIAS 31:25), not the bar to make it A+.
- **No-trade** = a real **conflict** among the bias inputs (the open-reaction **reverses**
  the bias → **hands off**, §4), or a **missing/weak pillar**, or no clean entry.

A **neutral** input (chop overnight, no clear HTF) is a **non-vote, not a conflict** — it
lowers conviction but does not cap A+. A 2/3 day is **tradable with no HTF read**
(overnight + open-reaction alone). The entry can only **elevate an already-aligned day**;
multi-alignment inside a conflicted or choppy tape is still no-trade/B.

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

If the open **rejects toward the HTF draw** → bias confirmed, today extends (A+
potential). If the open **wants to reverse the bias** (continuation against it) →
**hands off — "timing is not there yet"** *(BIAS 18:42)*; wait, do **not** trade the
reverse. Only **flip** the bias on a true signal: the HTF gap inverts, or an LTF
sweep-reversal with **mass displacement** *(BIAS 25:44)*. **Never marry the bias** — let
the open confirm or challenge it. (Timing: the reaction is usually clear by ~9:45.)

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

Lanto trades NQ (MNQ) and ES (MES) together and constantly reads one as the **leader**,
comparing their relative strength at the open to pick the day's vehicle and direction:

> "ES is a bit more leading… look at the zone at the time of entry on ES compared to NQ…
> a lot more aggressive in terms of the sell." (~33:16–36:32)

He traded **ES** in both worked cases — picking, per day, whichever index the divergence
made the right vehicle:

- **Short day (12-12):** ES led the sell. *"As soon as **ES showcased that sell**… that told
  me price most likely were to drive lower."* (~28:38) ES was the weaker into the high (it
  broke first) → **short ES**.
- **Long day:** NQ swept its London low and was the weaker; ES held. *"We recognized that **NQ
  was the weaker asset**… which caused me to flip interest **on ES and… ride up higher**."*
  (~37:28) → **long ES** (the stronger).

So the rule is **short the weaker, long the stronger** — trade the index the divergence
favours, not always the same one. (Correction 2026-06-23: an earlier draft of this section
mis-stitched two passages into "I flipped on ES and looked to ride NQ"; the transcript says
he *longed ES* — "ride up higher" — and the 12-12 sell is a separate day. The deterministic
`cli/lib/smt-leader.js` follows the transcript, not the old quote.)

- Watch for **divergence**: when one index makes a new high/low and the other does not, the
  one that **fails to confirm** is weaker; the divergence sets direction.
- Use the leader's displacement to **confirm or flip** the open-reaction read — the part
  Lanto leans on most (the D4 10-02 loss: *"the issue was ES had interest in drawing lower."*
  RISK ~30:39 — ES led down; the NQ long should have flipped).

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

This doc is **confirmed** (decisions ledger, 2026-06-22) and is the rebuild target. The
old/current bot diverges on: the grade (graded by alignment; can't trade a no-HTF 2/3 day
— §1), overnight as a vote (computed but inert — §3), near-price selection (§2), the
single-event bias flip (§5), SMT/leading-asset (absent — §6), and sessions (London
truncated, Asia not tradable — §7). These are rebuild items, not folded against the old
(retired) baseline. Gap detail + `file:line`: [`lanto-source-of-truth.md`](lanto-source-of-truth.md).

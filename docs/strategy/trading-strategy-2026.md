# Trading Strategy 2026

Status: Final
Favorite: Yes
Archive: No
Created time: April 11, 2026 1:20 PM
Last edited time: April 30, 2026 5:18 PM
Notebook: Trading System (https://www.notion.so/Trading-System-3467d36c8e7980c38af9ee67c46f04ed?pvs=21)

### 1. Framework overview

Lanto’s system has **three pillars** that must all align before a trade is taken.

- **Pillar 1 – Draw & Bias:** HTF + LTF + Overnight; where price is drawn (buy‑side/sell‑side + PD arrays).
- **Pillar 2 – Price Action Quality:** Good vs bad environment (range, displacement, candle quality).
- **Pillar 3 – Entry Model + Confirmation:** MSS, Trend, or Inversion, always triggered via candle‑close confirmation.

You trade **only** when all three are acceptable; otherwise, there is **no trade**.

---

### 2. Pillar 1 – Draw & bias (HTF, LTF, overnight)

Lanto’s bias is **multi‑timeframe and session‑based**: Daily/4H/1H + Overnight (Asia/London) + NY Open reaction.

### 2.1 HTF component – Daily / 4H / 1H

He keeps HTF simple: **Fair Value Gaps + Buy‑Side/Sell‑Side Liquidity.**

- Primary charts:
    - **Daily** and **4H** (sometimes 1H); only rarely Weekly if there is literally nothing clear.
- Core tools:
    - **Fair Value Gaps (FVGs)** and **BPRs/inversion FVGs**.
    - **Buy‑side / Sell‑side liquidity** (obvious highs/lows, equal highs/lows).

HTF process:

1. **Scan Daily/4H/1H** for the *best* imbalances:
    - Priority to imbalances that:
        - Are **extensive** (large gaps, strong displacement).
        - **Took liquidity in their creation** (e.g., swept a prior high/low before displacing).
2. **Pick one primary HTF PD array as the main draw**:
    - E.g., a large 4H FVG/BPR above or below, or a clear area of external sell‑side/buy‑side.
    - He prefers **4H** PD arrays when possible because they tend to be cleaner and more tradable intraday.
3. **Use reactions off those HTF PD arrays to set bias**:
    - Example: Market trades into a 4H BPR, fills it, and then **rejects sharply** with a strong 4H close → HTF narrative becomes **bearish** toward a lower sell‑side pool.
    - He does **not** forecast a full weekly map; he only needs a **near‑term draw zone** to align with intraday setups, because he is effectively scalping 1m/5m.

Result:

HTF bias is something like: “We mitigated a 4H BPR; downside draw into X sell‑side level (e.g., 5797). Today, I expect price ultimately wants that area.”

### 2.2 Session correlation & overnight data

Second bias component: how **Asia and London** handle liquidity before New York.

Typical pattern:

- One session **creates** liquidity (e.g., Asia sets highs/lows).
- Another **delivers** into that liquidity (e.g., London raids Asia’s high/low).

Overnight rules:

- Identify **Asia High/Low** and **London High/Low**.
- See which side is left **“wide open”** (untaken but obvious).
- Note whether:
    - Asia sells, London sells, but a key low (e.g., 678 or 5797) is *not yet taken* → that sell‑side remains a **draw** into NY.

This becomes part of the bias:

“If HTF wants 5797 sell‑side and overnight drove down but *left* that level untaken, my default expectation is still to target that level, unless NY open proves otherwise.”

### 2.3 LTF bias – NY open flexibility

Third component: **LTF bias from NY open reaction to overnight H/L.**

Key principles:

- Lanto **never marries a bias**. HTF gives a macro direction, but **immediate trades are decided by how NY reacts to overnight levels.**
- He waits the **first 15–30 minutes of NY** to see:
    - Do we **break out** above overnight/ London high or below low?
    - More importantly: **What is the reaction** after that break?

Examples:

- If NY breaks London high and **fails** (sharp rejection back under, displacement down), and HTF suggests downside draw:
    - Short‑term bias **aligns with HTF short**; he will look for shorts.
- If NY breaks London low and strongly **holds** above (bullish rejection, displacement up) against a still‑untapped HTF sell‑side:
    - He may **temporarily trade long** intraday (scalping into nearer upside objectives), while still believing HTF might later take the HTF sell‑side objective.

LTF bias logic:

- HTF draw = “destination over coming days.”
- LTF NY open reaction = “today’s path to or away from that destination.”
- He actively uses NY reaction to determine **whether today is an extension day or a retrace day** relative to HTF structure.

### 2.3.1 Pair relative strength (SMT) – which asset to trade

When trading the **MNQ/MES pair**, the same NY open-reaction read also decides *which* of the two correlated futures to take.

- At the overnight/open reference high (or low) being reacted to, compare the two instruments against **their own** reference (the price scales differ — never compare raw MNQ vs MES prices).
- The instrument that **fails to confirm** the other's new extreme is the weaker (lagging) one. By ICT SMT, the **lagging market is the cleaner trade**: **short the laggard, long the leader.**
- This is a **selection** layer, **not** an entry trigger. SMT picks the instrument + the bias direction; the actual entry still requires that instrument's own entry model (MSS / Trend / Inversion) + structure-shift confirmation per §3 / §5.
- **No clear divergence** (both confirm, or both fail — they are *measurably* similar) → no relative-strength edge → default to the primary instrument (MNQ).
- **Divergence unreadable** (a symbol's data is missing / no confirmed pivot by the end of the window) → **stand aside**; never default-and-trade.

The strength comparison is computed in code (constraint #7), graded by an ATR-normalized gap so "measurably similar" is a real reading, not a guess.

### 2.4 Multi‑timeframe alignment vs flexibility

He classifies trades by **alignment quality**:

- **A+ trade = Multi‑Timeframe Alignment**
    - HTF bias and NY LTF bias point the **same way**.
    - Example:
        - 4H BPR rejected → downside draw to 5797.
        - Overnight leaves that sell‑side untaken.
        - NY breaks London high, rejects hard, and starts displacing down.
        - Now HTF, LTF, and session behavior all scream **short**.
- **Conviction trade but not A+**
    - HTF points one way, but LTF bias may be playing a **short‑term retrace** first.
    - He will still trade, but with slightly lower conviction/size and more emphasis on local liquidity.

Flexibility rule:

- He **allows LTF to override HTF intraday** for scalps, but does not abandon HTF idea entirely.
- If price keeps respecting HTF PD arrays and failing to reach the higher‑timeframe draw *today*, he assumes the draw is still valid **later**, but accepts that today’s intraday path can be different.

---

### 3. Pillar 2 – Price action quality

This section from the earlier guide remains the same, but now understood as **filtering the environment once HTF/LTF bias is formed.**

- 3‑hour range check (avoid tiny, choppy ranges).
- HTF displacement & PD array size (prefer large, clean gaps).
- Candle anatomy (engulfing vs doji/wicks).

If Draw & Bias are good but Price Quality is “bad,” he will often stand aside or heavily downsize.

---

### 4. Pillar 3 – Entry models (MSS, Trend, Inversion) with confirmation

The three models and the confirmation rules stay structurally the same.

Only nuance added from HTF guide:

- The **same logic** used on 1m/5m (best gap, took liquidity, extensive) is how he picks **4H/Daily gaps** for bias.
- He treats HTF deliveries as **fractal**:
    - A 4H move filling and rejecting a big FVG is mentally the same as a 1m MSS + Trend model zoomed out.

So:

- MSS: used when LTF bias indicates reversal inside broader HTF context.
- Trend: used when HTF & LTF are clearly aligned and price is continuing the move.
- Inversion: used when strong HTF bias + LTF speed cause PD arrays in the opposite direction to fail.

---

### 5. Confirmation rules (no changes, just context)

Confirmation via **1m/5m candle close**, 10–15 minute rule, and delivery quality are unchanged, but now explicitly **layered on top of HTF/LTF bias**.

- HTF sets destination.
- LTF NY reaction sets day’s direction.
- Confirmation chooses **the exact moment** to step in.

---

### 6. Risk, sizing, management

No structural changes:

- Stops at structural invalidation (low/high of PD array or swing).
- Sizing scaled by:
    - Day of week (Mon/Fri reduced).
    - Trade grade (A+ = HTF+LTF alignment; lower grades if only LTF or only HTF is clean).
- Targets:
    - Intraday: local liquidity (internal swings, session highs/lows).
    - Swing for the day: the next HTF draw if price/action supports it.

---

### 7. Trading checklist (with full HTF/LTF logic)

### Step 1 – HTF Bias (Daily / 4H / 1H)

- [ ]  Mark **best** imbalances (large FVGs/BPRs that took liquidity).
- [ ]  Define main HTF draw:
    - Next major buy‑side/sell‑side pool (e.g., 5797 sell‑side).
- [ ]  Note recent reaction off HTF PD array:
    - Strong rejection → directional HTF bias.

### Step 2 – Overnight & Session Correlation

- [ ]  Mark Asia / London highs and lows.
- [ ]  Identify which liquidity remains **untaken**.
- [ ]  Decide if overnight is:
    - Extending HTF move, or
    - Consolidating (“equilibrium”) ahead of NY.

### Step 3 – Price Quality Filter

- [ ]  3‑hour range acceptable (not tiny/choppy).
- [ ]  4H/1H candles show real displacement and decent‑sized PD arrays.
- [ ]  15m/5m candles mainly engulfing; not dominated by dojis/wicks.

### Step 4 – NY Open LTF Bias (Flexibility)

- [ ]  Wait for first 15–30 minutes.
- [ ]  Watch reaction to **overnight high/low**:
    - Break + rejection in direction of HTF draw → LTF aligns with HTF (A+ potential).
    - Break + continuation **against** HTF draw → consider today a retrace day and adapt intraday bias accordingly, but keep HTF draw in mind for later.
- [ ]  Do **not** marry the original bias; let NY open reaction confirm or challenge it.

### Step 5 – Choose Entry Model (MSS / Trend / Inversion)

- [ ]  MSS when LTF is turning after a sweep in line with broader narrative.
- [ ]  Trend when HTF + LTF are clearly in continuation.
- [ ]  Inversion when opposing PD arrays fail in direction of your bias.

### Step 6 – Confirmation & Execution

- [ ]  Price taps your chosen PD array.
- [ ]  Within 10–15 minutes, you get a **strong 1m/5m close** in your direction.
- [ ]  Delivery is clean (no immediate messy chop).
- [ ]  Enter with stop at structural invalidation.

### Step 7 – Sizing & Management

- [ ]  Grade:
    - A+ = HTF + Overnight + NY + Price Quality + Model all aligned.
    - B = One element weaker (smaller gap, neutral overnight, etc.).
- [ ]  Adjust size for Mon/Fri vs Tue–Thu.
- [ ]  Take profits first at intraday liquidity, second at or toward HTF draw if price supports continuation.

---

If this full sequence is followed mechanically—HTF (Daily/4H/1H) → Overnight → NY Open reaction → Price Quality → Model → Confirmation—you will be trading as close as reasonably possible to how Lanto actually constructs and flexes his bias intraday.
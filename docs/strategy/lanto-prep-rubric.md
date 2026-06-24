# Lanto PREP grade rubric — faithful (Phase 0)

**Status: DRAFT for sign-off. No code until approved.**

Grounded in Lanto's own words, per the standing rule (transcripts + Discord,
never the derived specs). Sources, with timestamps used as citations below:
- **DB** = *How I Develop Daily Bias* (12/12/2025) — `docs/strategy/transcripts/How-I-Develop-Daily-Bias-...md`
- **EM** = *How I Enter The Market (Entry Models)* (2/9/2026) — `...How-I-Enter-The-Market-Entry-Models-...md`
- **Discord** = *Lantos Alerted Trades - Organized.pdf* (spot-checked 2025-09-26, 2026-01-06)

This rubric governs the PREP **draw-bias grade** only (Pillar 1). Price action
(Pillar 2) and entry model (Pillar 3) are separate components.

---

## 1. The bias is a 3-component COUNT

The pre-session draw bias is built from **three components**, each voting
`bull` / `bear` / `none` toward **one** chosen direction (DB 21:29, 30:30):

1. **HTF analysis** — daily → 4H → 1H (DB 00:56)
2. **Overnight price** — Asia 18:00–03:00 ET, London 03:00–09:30 ET (DB 12:11)
3. **NY opening-range reaction** — the move after 09:30 into opposing/overnight
   liquidity, then **the reaction** (DB 17:46). **Resolves LIVE** — not available
   pre-open.

**Grade = count of components confirming the same direction** (DB 22:25):
- **1/3 → no-trade** ("if you only have one out of three… you do not take a trade")
- **2/3 → B** ("it's not [an A+] but you can trade")
- **3/3 → A+**

Pick the direction with the most confirming votes. If **no direction** has ≥2
confirming components → **no-trade** (conflict/unclear).

**Pre-session is an UNCONFIRMED LEAN, not a grade** (corrected 2026-06-24 — the
shared engine `cli/lib/pillar1-bias.js` `combineBias` already encodes this, and
it is more faithful than the earlier "2/2 → B" draft). Component 3 (the NY-open
reaction) is what *confirms or doesn't confirm* the bias (Daily Bias 17:46), so a
trade grade is not earned until the open. Pre-open, using HTF + overnight only:
- **0 components / conflict → no-trade** (no read).
- **1–2 agreeing components → an unconfirmed LEAN**, shown with its *potential*
  (1 component → B-capable, 2 components → A+-capable). NOT a tradeable B/A+. The
  grade resolves live when the open confirms (then 2/3 → B, 3/3 → A+) or reverses
  ("timing not there yet → hands off", 18:42).

This is why Lanto starts live ~09:45 — pre-open he has a lean, not a trade.

**Second A+ path — multi-alignment "two-and-one"** (EM 25:13–27:05, 31:25): an
entry that stacks **two imbalances** in one (e.g. a 5m FVG rebalance + a 1m
opposing FVG inverting) with draw + price + entry-model all aligned is A+ at the
**entry** level, even on a 2/3 day. A single clean entry caps at **B**. This is a
LIVE (Pillar 3) elevation, not a pre-session grade.

---

## 2. Component 1 — HTF (how it votes)

- Mark **significant, near-price** arrays only: FVG / iFVG / buyside / sellside
  liquidity (DB 00:56, 02:48). Those four, nothing else.
- A gap is valid **only if displacive AND it took liquidity** — both (DB 00:56,
  01:52; EM 05:38).
- **Near price** — the array must sit near where price trades now; far zones are
  not significant (DB 04:42, 08:26: "these are not where price is currently
  trading").
- **Significance** = an aggressive high/low, a large wick, clear-cut — **not a
  tiny zone** (DB 06:33–07:30: "wicks wicks wicks… aggressive high/low").
- **Marking arrays is NOT a vote.** "We haven't even had a bias yet" (DB 09:21).
  HTF votes a direction only from **either**:
  - (a) **clearly directional HTF momentum** — consecutive directional daily/4H/1H
    candles (DB 35:34), **or**
  - (b) an **observed reaction** to a near-price array — *reject* → continuation
    in the HTF direction; *invert* → flip (DB 10:18–11:14).
- **Conflicting momentum across daily/4H/1H + no clear reaction → vote `none`**
  (DB 22:25: "we didn't have a clear ultra HTF look… price hasn't been great").
- **Price overrides a single small array.** A lone small/`tiny` array against a
  strong HTF direction does **not** set the vote — "price just trades through it"
  (DB 35:34).

## 3. Component 2 — Overnight (how it votes)

- Clearly bearish (or bullish) overnight → votes that direction (DB 16:50).
- **Consolidation / chop → vote `none`** (DB 15:54: "I typically won't have a
  dedicated bias… it's more so just chop").
- In sync with HTF → strengthens; against → can skew/flip the lean (DB 14:02).

## 4. Component 3 — NY open reaction (LIVE; resolves the grade)

- It is the **reaction**, not the initial grab (DB 20:33: "It's not the initial
  liquidity… it's the reaction").
- Confirms with **displacement** → green light, 3rd component (DB 19:37–21:29).
- Reverses against the bias → "timing not there yet → hands off" (DB 18:42).
- For a **reversal**: requires **mass displacement** + **multiple arrays
  invalidated**, not one (DB 30:30–31:26: "one candle disrespect one array" is
  not enough).

---

## 5. The DRAW (distinct from the votes)

- The **draw** is the **liquidity target** — where price is being pulled to: a
  significant **untaken** liquidity pool / level (DB 03:45, 17:46).
- **Liquidity = the draw, not a vote.** An array **+ its reaction** = a vote. Do
  not conflate (this is the engine over-read we keep hitting).
- The draw must be **significant + near-price** (same bar as §2).

---

## 6. The significance gate (DISPLACEMENT-based, not size)

An array may anchor a vote only if **all**:
- **displacive** — clean/strong displacement in the gap body, minimal wickage
  (EM 05:38), **and**
- **took liquidity** — swept an internal/external high/low while forming
  (EM 06:35), **and**
- **near price**.

**Significance is DISPLACEMENT-based, NOT a size veto** (CORRECTED 2026-06-24 —
the earlier "exclude tiny" draft was wrong). EM 05:38: *"you want to see price
off the body be extremely large — **it doesn't have to be entirely large**."* A
tiny-but-cleanly-displaced gap counts. The engine's existing `SIG_DISP_MIN`
(disp ≥ 0.5) gate is faithful — calibrated so 06-16's **traded** tiny disp-0.74
array still votes. **Do NOT exclude `tiny`** (it breaks the 06-16 oracle).

**Override of a lone array — only on a CONSECUTIVELY-DIRECTIONAL HTF.** A lone
small array against the trend is "traded through" ONLY when daily + 4H + 1H are
consecutively directional the same way: DB 35:38 *"if we see consecutive hourly
4hour daily candles be directional and you have one small … imbalance … we don't
override that, price just trades through it."* On a **conflicting / non-trending
HTF** (e.g. 2026-06-24 MES: daily bull, 4H/1H bear) the override does **not**
fire — the significant array still votes. (This rule is real but narrow; the
engine does not implement it yet — a separate, oracle-sensitive refinement.)

## 7. Cite-or-reject (project constraint #6)

Every anchor (draw, vote, grade) must cite a real JSON path that **resolves**.
No cite → it cannot anchor the grade → **fail down with a reason**. (The MES B
anchored on `primary_draw.cite: null` is the violation this closes.)

---

## 8. PREP outputs

Per symbol, pre-open:
- `pre_session_grade` = the engine's `grade_cap` (no-trade pre-open — the grade
  resolves live at the open).
- the **lean** (direction) + its **potential** (B-capable / A+-capable) when a
  lean exists, or "no read" (0 components / conflict).
- the **component votes** (HTF, overnight, each direction) + count.
- the cited **significant draw** (or `no_trade_reason` if none qualifies).
- `no_trade_reason`: `no_bias` (0) / `components_conflict` / `open_unconfirmed`
  (a lean pending the open) / significance / cite failures.

---

## 9. Current bot → faithful (the deltas to build)

| Item | Status |
|---|---|
| **The grade** (`direct-session-brief.js:382`) | **FIXED (#1, `dee89f0`)** — default-B replaced by the engine's `combineBias` count; pre-open = unconfirmed lean. |
| **The lean display** | **FIXED (#1, `7cf4400`)** — "leaning {dir} · {potential}-capable · pending open". |
| **Significance** (disp-based gate) | **already faithful** — EM 05:38 "doesn't have to be entirely large"; do NOT add a size veto. |
| **Draw vs vote** | **already faithful** — `pickPrimaryDraw` = draw, `arrayVote` = vote. |
| **Single bias engine** | **already faithful** — `combineBias` is the one source the brief + live resolver both call (seam ❸ closed). |
| **cite-or-reject on the draw** (§7) | **FIXED (`cc67016`)** — `annotateEngineByTfCites` stamps every engine zone at the gate chokepoint; the MES draw now cites `engine_by_tf.h1.fvgs[23]`. |
| **Field-contract test** (seam ❶) | **FIXED (`760ef87`)** — drives each reader with its writer's exact field set. |

**Worked check — 2026-06-24 NY-PM MES (corrected):** HTF momentum conflicts
(daily bull, 4H/1H bear) so there is no clean *trend*, but the tiny-but-displaced
(disp 0.67) inverted FVG **legitimately votes** (EM 05:38) → HTF vote bull;
overnight chop → `none` → a **1-component lean, B-capable, pending open**. The
bot's B was wrong only because the OLD grade defaulted to a **confirmed** B — the
faithful read is a *pre-open lean*, not a confirmed B, and **not** "no read" (the
array does vote). Fixed by the grade change (#1), not by a significance veto.

---

## 10. Validation (Phase 4, after the build)

Re-grade the oracle sessions and spot-check against Discord bias labels
(`Long/Short/Mixed/Unclear`): mixed/unclear = low count → no-trade/cautious. No
regressions on the locked oracle.

---

## Sign-off decisions (confirm before any code)

1. **Pre-session is an unconfirmed lean, not a B** (corrected) — grade resolves
   live at the open; PREP shows the lean + its potential. ☑ (approved 2026-06-24)
2. ~~HTF votes `none` on conflicting daily/4H/1H momentum~~ **REVERSED 2026-06-24.**
   Conflicting momentum means no clean *trend*, but a **significant near-price
   array still votes** (EM 05:38). The lone-array override fires only on a
   **consecutively-directional** HTF (DB 35:38), which MES PM is not — so MES is a
   1-component **lean**, not a no-trade. ☑ (corrected + agreed)
3. ~~Significance gate excludes `tiny` zones~~ **REVERSED 2026-06-24.** Significance
   is **displacement-based, not a size veto** (EM 05:38 "doesn't have to be
   entirely large"); the existing disp gate is faithful. Do NOT exclude `tiny`
   (breaks the 06-16 oracle). ☑ (corrected + agreed)
4. **Draw vs vote split** — liquidity = draw, array + reaction = vote. ☑ (already
   faithful in the engine)
5. **Multi-alignment "two-and-one" → A+ at the entry** (live, Pillar 3), separate
   from the 3-component day grade. ☑ (approved 2026-06-24)

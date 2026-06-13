# Re-grade: June 8–12 week (2026-06-13)

Re-grading the week under the **current adopted rules** so the frozen baseline
reflects the system as it actually trades now (the old baseline predated three
of these rules):

- From-scratch deterministic brief (no recorded-context reuse)
- TP1 weekly-draw exclusion (#60)
- 4:00 PM ET close + AM→PM carry (#60)
- 15:32 ET late-entry cutoff (#61)
- Break-even scale-in adds (#58)
- **A+ → TP2 with BE at TP1** (user ruling 2026-06-13; B trades still bank at
  TP1). Full position to TP2, stop → entry once TP1 tags. TP2 = packet's TP2,
  fallback to the session HTF draw.
- **Grade-tiered AM cutoff** (user ruling 2026-06-13): in the AM session, B
  setups may only surface until **11:40 ET**; A+ setups may surface until 12:00.
  (Conviction-tiered latitude — same philosophy as A+→TP2: higher grade gets
  more rope in both time and target. PM 15:32 cutoff is a candidate for the
  same treatment later.)
- **3-losses-in-a-row session halt** (user ruling 2026-06-13): stop taking new
  entries for the rest of a session after 3 consecutive losing trades (any win
  resets the streak). Stricter than the existing −3R cumulative halt; patches
  the concurrent-adds leak that let June 11 AM slip to −4. +1R over the 4 weeks
  (all from June 11 AM, −4→−3); cuts no winning session.

### Rules tested and REJECTED (kept honest for the record)
- *Late-B reward filter (TP1 > 2.0/2.5/2.75/3.0R)* — curve-fit; non-monotonic
  across thresholds, R-multiple doesn't predict late-B outcomes. Used the hard
  11:40 cutoff instead.
- *Stand-aside on unclear-open + marginal/poor quality* — catastrophic (−52R):
  that signature describes most WINNING sessions too (June 9, June 10), so the
  gate blocks the winners. June 11 AM (−4, lost) is ex-ante identical to June 10
  AM (+5.74, won) — the chop is only visible after the fact.

These re-grade rules are **not yet in production code** — these values are the
signed-off targets; the engine changes + gate re-freeze happen in one pass once
the whole week is reviewed.

**4-week effect (out-of-sample, honest):** current +59.1R → A+→TP2 +64.1R →
+ AM cutoff **+67.9R**.

## Sign-offs

| Day | Session | Re-graded result | Status |
|-----|---------|------------------|--------|
| Jun 8 | AM | no-trade (0 walkers spawned, no LTF bias) | ✅ locked + frozen in gate |
| Jun 8 | PM | no-trade | ✅ locked + frozen in gate |
| Jun 9 | AM | **+14.85R** (5 A+ shorts; 09:52 & 10:05 ran to TP2) | ✅ locked (pending code + re-freeze) |
| Jun 9 | PM | no-trade | ✅ locked |
| Jun 10 | AM | **+5.74R** (all B; 11:56 B add cut by AM cutoff) | ✅ locked |
| Jun 10 | PM | no-trade | ✅ locked |
| Jun 11 | AM | **−3R** (4 A+ shorts, all stopped; chop day, 3-loss halt caps the 4th) | ✅ locked |
| Jun 11 | PM | **+9.39R** (B anchor +2.15 TP1; A+ add +7.25 runner to 4:00 close) | ✅ locked |
| Jun 11 | day | **+6.39R** | ✅ locked |
| Jun 12 | AM | no-trade (only candidate was 11:52 B long, cut by AM cutoff; was −1R) | ✅ locked |
| Jun 12 | PM | no-trade | ✅ locked |

**Re-graded week total: +26.98R** — Jun 8 (0) · Jun 9 (+14.85) · Jun 10 (+5.74) · Jun 11 (+6.39) · Jun 12 (0).
(Old frozen graded-days baseline was June 9 +10.01 / June 10 +1.35 / June 11 AM −3 = +8.36 for those days.)

### Jun 9 AM detail (+14.85R)

| Time ET | Model | Side | Entry | Stop | TP1 | TP2 | Grade | Outcome | R |
|---------|-------|------|-------|------|-----|-----|-------|---------|---|
| 09:52 | Inversion | short | 29792 | 29847 | 29659.25 | 29566 | A+ | TP2 | +4.11 |
| 10:05 | Inversion | short | 29664 | 29713.75 | 29458.5 | 29302.5 | A+ | TP2 | +7.27 |
| 10:27 | Inversion | short | 29467.25 | 29526 | 29302.5 | 29302.5 | A+ | TP1 (TP2=TP1) | +2.80 |
| 11:05 | Trend | short | 29184 | 29226.5 | 29083.75 | 29083.75 | A+ | stop | −1.00 |
| 11:53 | Trend | short | 28911.75 | 28971.75 | 28811.5 | 28811.5 | A+ | TP1 (TP2=TP1) | +1.67 |

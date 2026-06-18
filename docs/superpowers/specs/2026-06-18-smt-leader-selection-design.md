# SMT relative-strength leader selection — design spec

**Date:** 2026-06-18
**Status:** draft — awaiting user review before implementation
**Source intent:** confirmed via `interview-me` (2026-06-18 session). Triggered by a live loss: NY-AM defaulted to MNQ on missing MES data and took 3 losing MNQ shorts while MES was the clean short.

> Repo convention: feature specs live in `docs/superpowers/specs/` (not a root `SPEC.md`). This follows the existing ~20 specs in the decision log.

---

## 1. Objective

Replace the direction-agnostic "highest displacement score" leader picker with an **SMT (Smart Money Technique) relative-strength** picker grounded in strategy §2.3. During the NY open-reaction window the system reads **both** MNQ and MES, and from one conclusive read emits two outputs:

1. **LTF bias** — align vs retrace (what §2.3 already asks the window to decide).
2. **SMT leader** — short the asset that *failed to confirm* its overnight/open reference high; long the asset that *led*. The laggard is the cleaner trade (ICT SMT).

The leader is locked once for the session, with a written reason. The picker must **never silently default to MNQ** — MNQ is only the result of a *measured* near-tie, never of missing data.

## 2. Strategy grounding (constraint #11)

Before code ships, add a subsection to `docs/strategy/trading-strategy-2026.md` §2.3 (and mirror the rule reference in `CLAUDE.md` strategy basis). Draft text:

> **§2.3.1 Pair relative strength (SMT) — which asset to trade.** When trading the MNQ/MES pair, the NY open-reaction read also decides *which* instrument to take. At the overnight/open reference high (low), compare the two correlated futures: the one that **fails to confirm** the other's new extreme is the weaker. Short the laggard; long the leader (ICT SMT — the lagging market is the cleaner trade). SMT selects the instrument; it is **not** the entry trigger — the entry still requires the chosen instrument's own entry-model + structure-shift confirmation. If both confirm or both fail (no divergence), there is no relative-strength edge: default to MNQ. If the divergence cannot be read (a symbol's data is missing), stand aside.

Authority for the rule: ICT SMT divergence (lagging asset = higher-probability trade) — researched 2026-06-18; sources captured in the PR description.

## 3. Algorithm

### 3.1 Window & timing
- The open-reaction read runs the **full 15→30 min window**, re-evaluated each bar, instead of a single ~min-14 snapshot.
- From **min 15 onward**, the "done" criteria are checked each bar. First bar all criteria hold → **lock early**.
- **Hard stop at min 30** — lock with whatever the read resolves to (see fallbacks).
- Pre-min-15 bars do not lock (mirrors today's pre-window behavior).

### 3.2 Reference level (per symbol)
The SMT reference is the **overnight extreme NY is reacting to**, per §2.3 — operationally each symbol's own overnight session high/low from `gates.engine.pillar1.session_levels` (Asia `AS_H/AS_L`, London `LO_H/LO_L`; the relevant extreme being tested in the window). Each symbol is compared to **its own** reference (price scales differ — never compare raw MNQ vs MES prices).

### 3.3 "Done" criteria (all must hold, checked each bar ≥ min 15)
1. **Both symbols' window data present** — each has a parsed engine bundle for the window (the capture gap that broke today must be closed; see §6).
2. **Confirmed pivot on both** — each symbol printed a confirmed swing-high (or swing-low) pivot in reaction to its reference, from `gates.engine.pillar3.swings` (a pivot that is in place, not the still-forming current bar). `leg_high/leg_low` may seed the running extreme; the pivot confirms it.
3. **Clear divergence (categorical, not a magic margin)** — at the reacted extreme, exactly **one** symbol took/held beyond its reference while the **other** made a lower high (failed) / higher low. Both-took or both-failed = no divergence.

### 3.4 Outputs on a clear divergence
- **Bearish SMT** (at the highs: one took its overnight high, the other made a lower high) → bias short, **leader = the failer** (short the laggard).
- **Bullish SMT** (at the lows: one took its overnight low, the other made a higher low) → bias long, **leader = the leader** (long the stronger).
- Write the leader + a human-readable reason (e.g., `"MNQ took LO.H 30615; MES made a lower high 7560 vs LO.H 7565 → short MES"`).

### 3.5 Fallbacks at min 30
- **Measured near-tie / in-sync** (both took, or both failed; criteria 1–2 met, 3 not) → lock **MNQ**, reason `no_divergence_measured`.
- **Missing / unreadable data** (criterion 1 fails) → **stand aside + flag** (no leader lock, no setups walked, native notification), reason `smt_unreadable_data`. Never lock MNQ here.

## 4. Data sources (no LLM arithmetic — constraint #7)
All comparisons computed in code from the parsed engine bundle:
- `gates.engine.pillar1.session_levels.{AS_H,AS_L,LO_H,LO_L,...}` (`.taken` / `.untaken`) — per-symbol reference levels.
- `gates.engine.pillar3.swings.{swing,internal}[]` (`is_high`, price, tier) — confirmed pivots.
- `engine_by_tf` per symbol from the paired bundle — both symbols' window data.

## 5. Files to change
- **New:** `cli/lib/smt-leader.js` — pure `computeSmtLeader({ primary, secondary, primaryEngine, secondaryEngine, windowStartMs, windowEndMs, nowMs })` returning `{ leader, bias_dir, divergence, reason, evidence:{primary_ref, primary_high, secondary_ref, secondary_high, ...}, done }`. Pure + unit-tested (cite-or-reject paths in the evidence).
- **Replace caller logic in** `cli/lib/compute-leader.js` — keep the file or fold into `smt-leader.js`; the disp-score heuristic is retired as the selector (may remain as a tiebreak only if needed).
- **`app/main/live-open-reaction-finalizer.js`** — drive the re-evaluate-each-bar loop from min 15 to 30; lock on `done`; on `smt_unreadable_data` stand aside + notify instead of defaulting to `PAIR_PRIMARY`.
- **`cli/lib/pair-decision.js`** — schema bump: add `method: "smt"`, `bias_dir`, `divergence`, `evidence`, and a `standaside: bool` / richer `reason`. Keep atomic write.
- **`app/main/bar-close.js`** — the `leader ?? PAIR_PRIMARY` fallback (line ~1394/1487) must respect `standaside` (no walk) rather than blindly defaulting.
- **`docs/strategy/trading-strategy-2026.md`** — add §2.3.1 (above).
- **Capture (§6)** — ensure both symbols' window engine data is present across min 15–30.

## 6. Capture reliability (prerequisite)
Today's root cause was `secondary_engine_missing` — MES engine data absent at decision time, so no comparison was possible. The SMT picker is worthless without both symbols. The finalizer must capture/poll **both** symbols across the window (the dual-symbol bundle the brief already builds), verified per the existing `capture_health` machinery. If the secondary genuinely can't be captured by min 30 → `smt_unreadable_data` stand-aside (§3.5), not an MNQ default. (Reuse the verified multi-TF capture / `tf-capture.js` retry pattern.)

## 7. Testing strategy
- **Unit (`tests/smt-leader.test.js`):** bearish SMT (MNQ took high / MES lower high → short MES); bullish SMT mirror; both-took → MNQ near-tie; both-failed → MNQ near-tie; secondary missing → standaside (never MNQ); not-done before pivots confirm; early-lock the bar criteria first hold; hard-stop at min 30.
- **Pair-decision schema round-trip:** new fields persist + read back.
- **Replay/tape:** add/repurpose a paired tape for a divergence day to prove the finalizer locks the laggard end-to-end (deterministic, $0). Today's NY-AM is a candidate once MES capture is reconstructable.
- **Gates:** `npm run smoke:fixtures` 22/22, full unit suite green.

## 8. Boundaries
- **Always:** compute divergence in code (no LLM arithmetic); cite engine paths in the evidence; write the §2.3.1 rule before shipping; feature branch + PR; keep SMT as *selection only* (entries unchanged).
- **Ask first:** the exact reference-level selection (which overnight extreme) and the swing-pivot confirmation definition — flagged as open decisions in §10 for sign-off on review.
- **Never:** silently default to MNQ on missing data; let SMT bypass the entry-model/structure-shift confirmation; compare raw cross-symbol prices; change the entry models.

## 9. Out of scope
- Mid-session direction flip re-picking the leader (leader locks once).
- Surfacing setups on both symbols simultaneously after the lock.
- Any change to the entry models (MSS / Trend / Inversion) themselves.
- General capture-reliability work beyond guaranteeing both symbols in this window.

## 10. Open decisions (confirm on review)
1. **Reference extreme:** use the specific overnight level being reacted to (Asia vs London) — proposal: the nearest untaken overnight high above price for a short context (low below for long), from `session_levels`. Acceptable, or pin to London (`LO_H/LO_L`) only?
2. **Pivot confirmation:** use the engine's `swings` (swing-tier) pivot as "confirmed." Acceptable, or also require a displacement/close-through to count it confirmed?
3. **Near-tie definition:** categorical (both-took or both-failed) with **no** numeric margin — matches "actually similar, not guessing." Confirm you don't want a points/percentage band on top.

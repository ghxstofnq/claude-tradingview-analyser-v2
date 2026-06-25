# Faithful pair-leader selection (ES↔NQ) — design + corpus-first validation

**Status: DRAFT for sign-off. No live wiring change until the corpus gate passes.**

Branch: `feat/faithful-lanto-rebuild`. Standing rule: ground in Lanto's own words
(`docs/strategy/transcripts/` + Discord), never the derived `docs/strategy/*.md`
([[ground-in-lanto-transcripts-not-docs]]). Constraints carried verbatim: no LLM
arithmetic (#7), cite-or-reject (#6), CLI-only, never auto-arm trading, run
folds/tests in this worktree, **never let the leader pick gate the bias grade**.

---

## 1. Goal

Make "which of MNQ/MES do we trade today" faithful to how Lanto actually picks a
pair, and prove it earns its place against always-trading-MNQ **before** it ships.

One-line summary: Lanto picks the **leading / stronger** instrument by displacement
at the open reaction and trades it — that's **relative strength, not SMT divergence**.
The faithful method already exists in code (`compute-leader.js`) but is **dead**; the
**unfaithful** divergence math (`smt-leader.js`) is the one wired live, and it's inert
(defaults to MNQ almost every day). This is a wiring swap, gated on a corpus fold.

---

## 2. Problem

Three things are wrong today:

1. **The live leader is the divergence pick, and it's inert.** `cli/commands/analyze.js`
   computes `computeSmtLeader` (classic ICT SMT — opposite-sign swing non-confirmation
   vs an overnight reference) and writes it to `bundle.pair.leader_evidence`.
   `app/main/live-open-reaction-finalizer.js` reads `pair.leader_evidence.leader` to pin
   the session's symbol. On most days no opposite-sign divergence forms in the open
   window → `leader: null` → fallback to `PAIR_PRIMARY` (MNQ). It measured **neutral**
   on the June 8-12 paired week precisely because it never fires ([[smt-leader-selection]]).

2. **It isn't transcript-grounded.** Lanto never says "SMT" or "divergence" in any
   transcript. `smt-leader.js`'s only cited authority is the **derived** `daily-bias.md
   §6` — a banned authority. And its header says "the weaker is the trade vehicle" while
   its code longs the **stronger** — an internal contradiction; the code's behavior
   happens to match Lanto, the comment matches neither.

3. **The faithful method is dead code.** `cli/lib/compute-leader.js` already computes
   "leader = highest displacement-score fresh FVG in the open-reaction window" — which IS
   Lanto's "more leading / more aggressive displacement" read. Nothing imports it (a stale
   comment in the finalizer even claims it's in use).

---

## 3. Ground truth

### 3.1 Lanto's own words (How I Develop Daily Bias, 12/12/2025)
- "as soon as **ES showcased that sell signs**… that's what told me price most likely were
  to drive lower" (DB 28:38) — picks the instrument showing the move first.
- "Look at the zone at the time of entry **on ES compared to NQ**… a lot more **aggressive**
  in terms of the sell" (DB 33:16) — compares the two, picks the more aggressive.
- "we ended up **longing a five-minute gap on ES because ES is a bit more leading** at that
  point in time" (DB 36:32) — trades the **leader**.
- "we recognized **NQ was the weaker asset**… flip interest **on ES and ride up higher**"
  (DB 37:28) — on a long he traded the **stronger** (ES), and he **flips** between the two
  as the leader changes.

**Read:** at the open reaction, watch both, pick the one with the **more aggressive
displacement in the move's direction**, and **trade that (the leader/stronger)**. It's
discretionary and displacement-keyed — not a swing-high/low non-confirmation.

### 3.2 Public/ICT convention (web)
- **SMT divergence** — one index makes a new high/low while the correlated one *fails to
  confirm* → a **reversal-timing** signal at a HTF PD array; "the PD array marks the price,
  the SMT marks the timing… a confirmation tool, not a standalone signal."
- **Relative strength** — watch the NQ-vs-ES spread and **favor/trade the leader**;
  relative strength "can guide which index to favor."

### 3.3 Verdict
Lanto's method = **relative strength (trade the leader)**, not SMT divergence. The user's
proposal — "just the stronger / leading pair at the open reaction" — is therefore the
*more* faithful design, and it's already half-built (`compute-leader.js`).

---

## 4. Current architecture (what looks for the leader)

The leader is **symbol-selection only** — it picks the vehicle, never the grade.
`cli/lib/pillar1-bias.js` grades on **three votes** (HTF + overnight + open-reaction); the
pair pick is not one of them. This matches Lanto (pick the vehicle, then grade it).

| # | Component | Role today |
|---|---|---|
| 1 | `cli/commands/analyze.js` (`computeSmtLeader` → `smtLeaderEvidence`) | **Source.** Writes `bundle.pair.leader_evidence` in the `--pair` bundle. |
| 2 | `app/main/live-open-reaction-finalizer.js` | **Consumer.** Reads `pair.leader_evidence.leader` at the open-reaction window (minute ~14), pins the session leader, persists `pair-decision.json`, writes the leader's brief + ltf-bias. |
| 3 | `app/main/bar-close.js` (`inputs.leader`, `PAIR_PRIMARY`) | **Runtime.** Pins the chain to the leader symbol; gates `missing_pair_decision` (1078) + `symbol_mismatch` (1084); falls back to `PAIR_PRIMARY` = MNQ (1670). |
| — | `app/main/sdk.js:673` | Zod description of the `leader_evidence` surface field (no logic). |
| — | `cli/lib/compute-leader.js` | The faithful displacement pick — **not wired** (dead). |

`compute-leader.js` output shape (already cite-or-reject + no-LLM-arithmetic):
`{ leader, primary_disp_score, secondary_disp_score, margin, threshold, reason }`,
`DEFAULT_THRESHOLD = 0.10`, leader = the symbol with the higher max `disp_score` on a
**fresh FVG created inside the window**; `null` when margin < threshold or no window FVGs.

---

## 5. Design — the faithful leader

### 5.1 The pick
- **Leader = the instrument with the strongest displacement IN THE OPEN-REACTION BIAS
  DIRECTION**, measured over the open-reaction window. Trade the leader (the stronger),
  in the resolved open-reaction direction. (DB 37:28 — trade the stronger; DB 28:38/33:16
  — direction-relative aggression.)
- **Refinement over `compute-leader.js` as written:** filter the window FVGs to the bias
  direction before taking the max `disp_score`, so a big *counter*-direction gap on one
  symbol can't make it the "leader." The bias direction is the open-reaction resolver's
  output (already computed deterministically — `live-ltf-resolver.js` / the open-reaction
  finalizer).
- **Metric is a design knob to settle by the fold (§6):** default = max `disp_score` of a
  fresh, bias-direction FVG in the window. Alternative to A/B in the fold = open-range
  displacement magnitude ÷ ATR (`leg_high − leg_low` normalized), which is closer to "how
  aggressive was the open move." Pick whichever separates on the corpus; do not curve-fit.
- **Fallback:** `margin < threshold`, no window data, or unclear bias → `PAIR_PRIMARY`
  (MNQ). Lanto: when there's no clear leader, default to your main instrument.

### 5.2 Scope
- **Session-pinned** at the open-reaction window (matches the current architecture: the
  symbol is pinned for the session in `bar-close.js`). Lanto sometimes *flips* mid-session
  (DB 37:28) — a **per-entry re-pin** is a larger change (the chain would re-anchor the
  chart mid-session) and is **deferred** to a follow-up, flagged as a known gap, not built
  here.

### 5.3 SMT divergence — demoted, not deleted (decision for sign-off)
- Option A (recommended): keep `computeSmtLeader` available but **off the leader path**;
  expose its result as an **optional confirmation** of the open-reaction *direction* ("SMT
  marks the timing" — web), never as the symbol gate. Resolve the header/leader
  contradiction (trade the stronger, DB 37:28).
- Option B: delete `smt-leader.js` + `smt-leader-evidence.js` outright (it's unproven and
  not transcript-grounded). Lighter, but loses the optional confirmation overlay.

### 5.4 Safety / wiring
- **Flag-gated, default OFF** (`GOFNQ_FAITHFUL_LEADER=1`) until §6 passes — so `main`
  behavior is unchanged on merge and the fold compares cleanly.
- No bias-grade impact (leader is not a vote — keep it that way; assert in a test).
- Constraints #6/#7 preserved (all comparison in code; evidence carries JSON-path cites).

---

## 6. Corpus-first validation plan (the gate — nothing ships before this)

**Why a gate:** the divergence version measured neutral *because it never fired*. The
displacement leader fires far more often (it switches symbols whenever one leads by the
margin), so it can help **or** hurt. A one-week win is survivorship until folded across
more weeks ([[fold-before-trusting-a-separator]], [[filters-dont-separate]]).

### 6.1 Arms to compare (same corpus, old-vs-new fold)
1. **Baseline — always-MNQ** (`PAIR_PRIMARY`, leader pick disabled).
2. **Displacement leader** (§5.1 default metric).
3. **Displacement leader, alt metric** (open-range disp ÷ ATR).
4. (reference) **Current divergence-SMT** — expected ≈ baseline (inert).

### 6.2 Corpus
- **Have:** the June 8-12 paired week with **MES recorded** via the popover
  ([[smt-leader-selection]]) — the only paired data on disk.
- **Need:** more paired MNQ+MES sessions before trusting any verdict. **Record plan:** use
  the popover MNQ/MES paired sweep on each upcoming session (and re-record a few past
  recordable 2026 sessions per the Stage-G method) until ≥3-4 paired weeks exist. One week
  is directional only.

### 6.3 Method
- Fold each arm through the real chain with `scripts/fold-live-corpus.mjs` (faithful live
  sessions, old-vs-new) — the same harness the project uses for any chain change
  ([[fold-all-live-data-every-test]]). Per session the leader is resolved from that
  session's paired bundle; the chain then folds on the chosen symbol's tape.
- Metrics per arm: **net R, win%, count of −3R days, per-symbol R split (MNQ vs MES), and
  how often the leader ≠ MNQ** (the switch rate — if it's ~0 the method is inert like SMT).

### 6.4 Acceptance (report; user concludes)
- Ship the displacement leader **only if** it **beats always-MNQ** by a margin that
  **survives across the available paired weeks** (not one week), with no worse −3R-day
  profile. Report the table; the user makes the keep/shelve call.
- If it doesn't separate → **keep always-MNQ**, shelve `smt-leader.js`, and record the
  finding. "No edge" is a valid, faithful outcome (Lanto's pair-switching is discretionary
  and may not be mechanizable into an edge on this corpus).

### 6.5 Decision gate
- **CP — Leader verdict:** the fold table across the paired weeks → user picks
  displacement-leader (which metric) / keep-MNQ / shelve. No live wiring flip before this.

---

## 6b. Validation results (2026-06-25, 9 paired NY-AM sessions)

Corpus: 5 Stage-G MNQ-led days (06-16/09/17/18, 02-09) + 4 ES-led days from Lanto's Discord
(01-29 ES short won; 06-15 ES "slightly leading" long won; 04-06 ES long b/e; 06-22 "ES
confirmed 4 min before NQ — leading"). Each symbol recorded via `tv record-tape`, folded
through the same chain, packet forward-simmed to R. Harness: `scripts/fold-pair-leader.mjs`
(tapes local — gitignored).

**Leader-pick faithfulness (vs Lanto's actual instrument, 8 decision days):**
- **Displacement-leader: 5/8** — perfect on the 4 MNQ days + caught 01-29 (MES, clear lead).
  Missed all 3 MES-*long* days: 06-15 ("slight" lead), 04-06 (lead emerged 10:12, after the
  window), 06-22 (a *clear* in-window lead — "ES confirmed 4 min before NQ" — yet the metric
  read inconclusive). Never wrongly leaves MNQ.
- **Divergence-SMT: 4/8** — wrong on 06-16 (picked MES, the loser, −R); caught 04-06; missed
  01-29/06-15/06-22.

**R-totals:** always-MNQ **+7.72R** · displacement **+7.72R** · divergence-SMT **+2.13R**.

**Conclusions (report — user concludes):**
1. **Demote divergence-SMT — clear.** 4/8, R-negative (−5.59R drag, the 06-16 wrong pick).
   Reproduces the live 2026-06-24 "completely wrong" call.
2. **Displacement is the better, MNQ-safe default** (5/8, never picks a worse symbol than MNQ,
   R = baseline) — adopt it over divergence. BUT its current metric (max FVG disp_score, 0.10
   margin) is **not sensitive enough to reliably detect Lanto's leads** — it catches obvious
   ones (01-29) and misses subtle/late ones. 06-22 is the proof: a clear in-window ES lead read
   "inconclusive" while MES (chain) won +0.21R vs MNQ −1R. **Metric/threshold tuning is required,
   not optional**, before the switch is useful. A/B open-range disp ÷ ATR and a lower margin —
   only if it does not break the 4 MNQ days.
3. **Edge is double-gated.** Even when the leader is right, Pillar-3 mostly didn't convert the
   MES trade (no-trade 01-29; stops 06-15/04-06; only 06-22 MES eked +0.21R). The chain's MES
   setups ≠ Lanto's. The real edge work is **Pillar-3 MES coverage**, on top of the metric fix.

**Open (next):** (a) A/B the leader metric/threshold against this 9-session corpus; (b) the
Pillar-3 entry-models audit (the dominant edge limiter); (c) consider per-entry (not session-
pinned) leader re-evaluation for late leads like 04-06.

## 7. Component changes (only if §6 passes)

Minimal, flag-gated:
1. `cli/commands/analyze.js` — when `GOFNQ_FAITHFUL_LEADER`, compute the leader via the
   faithful displacement function (the §5.1 metric; reuse/extend `compute-leader.js`) and
   write it to `pair.leader_evidence`; else keep `computeSmtLeader`. Keep the
   `leader_evidence` shape stable (cite-bearing) so #2/#3 are untouched.
2. `app/main/live-open-reaction-finalizer.js` — fix the stale `computeLeader` comment; no
   logic change (it already reads `pair.leader_evidence.leader`).
3. `cli/lib/compute-leader.js` — add the bias-direction filter + (optional) the alt metric
   behind the same data shape; unit-test the pick + the MNQ fallback.
4. Tests: leader-pick unit tests (direction filter, threshold fallback, both metrics) +
   an assertion that the leader pick never alters the Pillar-1 grade.

---

## 8. Risks
- **One-week survivorship** — the dominant risk; mitigated by requiring multiple paired
  weeks before a verdict.
- **Metric choice curve-fit** — A/B two metrics on the corpus; don't tune a threshold to
  one session.
- **Mid-session flip not modeled** — session-pinned only; Lanto flips (DB 37:28). Deferred,
  flagged.
- **Correlation regime** — ES/NQ leadership rotates; a leader edge in one regime may not
  hold. The fold spans both directions of the available corpus.

## 9. Sign-off decisions (2026-06-25, user)
1. **SMT divergence → DEMOTE to an optional confirmation overlay** (Option A). Keep
   `computeSmtLeader` off the leader path; expose it as optional confirmation of the
   open-reaction *direction*. Do not delete.
2. **Leader metric → settled by the fold.** A/B fresh-FVG disp_score vs open-range disp ÷
   ATR on the corpus; pick whichever separates.
3. **Corpus → replay-record May + June 2026 paired weeks** (2-3 more weeks beyond June 8-12)
   via `tv record-tape` (single-TF, the reliable replay recorder — full-session anchor
   capture wedges), pair offline, fold all arms, get it right. **Then live-test** while the
   full system + bot are trading live. Recording must NOT run while a live session is active
   (replay poisons live capture — drive TV only when off-session).

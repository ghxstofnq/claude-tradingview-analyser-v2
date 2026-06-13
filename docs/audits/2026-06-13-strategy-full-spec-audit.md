# Full-spec audit — deterministic system vs strategy documents

Date: 2026-06-13. Mandate: bring the system to full spec against
`docs/strategy/trading-strategy-2026.md` (TS) and `docs/strategy/entry-models.md` (EM),
hand-graded days immutable (June 9 +10.01R/5, June 10 +1.35R/6, June 11 AM as settled).

Phase 1 deliverable: requirements inventory. Phase 2 deliverable: gap table.
Research pass (2026-06-13): external ICT/SMC conventions confirm the doc mechanics —
MSS valid only on full-body displacement close past the swing (wick = liquidity grab);
IFVG requires body close through the gap, re-invalidated on close back through;
FVG entries trigger on confirmation close, not touch; NY-open reversal window 15–30 min.

## Requirements inventory (every rule, with section refs)

### TS §1 — Framework
- R1.1 Three pillars must all align; otherwise no trade.

### TS §2.1 — HTF bias (Daily/4H/1H)
- R2.1.1 Scan D/4H/1H for best imbalances (FVG/BPR); priority: extensive + took liquidity in creation.
- R2.1.2 Pick ONE primary HTF PD array as main draw; prefer 4H.
- R2.1.3 Reactions off HTF PD arrays set bias (sharp rejection → directional bias).
- R2.1.4 Buy-side/sell-side liquidity pools (obvious + equal highs/lows) are the draw targets.

### TS §2.2 — Overnight
- R2.2.1 Mark Asia H/L, London H/L.
- R2.2.2 Identify which side is left untaken ("wide open").
- R2.2.3 Verdict: overnight extending HTF vs consolidating.
- R2.2.4 One session creates liquidity, another delivers (PM reads NYAM levels).

### TS §2.3 — NY-open LTF bias
- R2.3.1 Never marry a bias; NY reaction decides today's direction.
- R2.3.2 Wait first 15–30 minutes.
- R2.3.3 Break of overnight H/L + the REACTION after the break decides (rejection flips, continuation keeps).
- R2.3.4 Classify extension day vs retrace day.

### TS §2.4 — Alignment
- R2.4.1 A+ = HTF and LTF point the same way.
- R2.4.2 Divergent = still tradable at lower conviction/size, more emphasis on local liquidity.
- R2.4.3 LTF may override HTF intraday; HTF draw stays valid for later.

### TS §3 — Pillar 2
- R3.1 3-hour range check (avoid tiny/choppy).
- R3.2 HTF displacement + PD-array size (prefer large clean gaps).
- R3.3 15m/5m candle anatomy (engulfing vs doji/wick).
- R3.4 Bad quality → stand aside or heavily downsize.

### TS §5 / §7 Step 6 — Confirmation
- R5.1 Confirmation via 1m/5m candle close, full body, in trade direction.
- R5.2 Within 10–15 minutes of the tap; no trade if chop inside the zone > 10–15 min (also EM MSS §5).
- R5.3 Delivery clean (no immediate messy chop).

### TS §6 / §7 Step 7 — Risk, sizing, management
- R6.1 Stops at structural invalidation (low/high of PD array or swing).
- R6.2 Sizing by day of week (Mon/Fri reduced) + grade.
- R6.3 Targets: first intraday liquidity (internal swings, session H/L), second at/toward HTF draw.
- R6.4 Grade: A+ = all six elements aligned; B = one weaker; no-trade otherwise.

### EM — MSS model
- M1 Context: HTF draw near completion / price into HTF zone; expect reaction.
- M2 Liquidity grab below an obvious low: Asia/London/PD low **or a very clear intraday swing low**.
- M3 MSS with displacement: breaks most recent internal lower high, leaves an FVG.
- M4 Retrace into the displacement FVG (ideally CE) **without making a new low**.
- M5 Confirmation: 1m/5m full-body close holding the zone; no trade on weak close / >10–15 min chop.
- M6 Stop: below MSS low or FVG low. Targets: internal high → session high → HTF draw.

### EM — Trend model
- T1 Context: HTF clearly trending, FVGs respected, **MSS/BoS already done in trend direction** — continuation phase.
- T2 Strong impulse leg leaving fresh in-trend FVGs.
- T3 Pullback **respects structure** (still HH/HL for longs) into an internal FVG; **no trade if structure breaks against the trend**.
- T4 Confirmation closes above the FVG midpoint with displacement body.
- T5 Stop: below the swing low that touches the FVG, or the FVG low.
- T6 Targets: pullback-defining high → next HTF target.

### EM — Inversion model
- I1 Context: clear HTF bias; opposing FVG forms against it.
- I2 Violation: candle closes through the far edge (or past CE with strong displacement).
- I3 Entry: aggressive = the violating close itself (user-ruled canonical); conservative retest variant exists in doc.
- I4 Stop: beyond the inversion zone / the violating candle (user-ruled: failed-leg extreme first).
- I5 Targets: next liquidity (session H/L, PDH/PDL, HTF draw).

## Gap table (requirement → current behavior → gap → fix)

| # | Req | Current behavior | Gap | Fix (citation) | Risk to graded days |
|---|-----|------------------|-----|----------------|---------------------|
| G1 | R5.2 / M5 | Walkers linger in `tap_seen` indefinitely; `expired` stage exists but nothing transitions to it. Engine `chop_15m` flag covers engine-tracked entries only. | Tap→confirmation 10–15 min timeout unenforced; a stale tap can confirm 40+ min later. | Expire walkers 15 min after tap without confirmation (TS §7 Step 6 "within 10–15 minutes"; EM MSS §5 chop rule). | Must refold-verify; graded confirmations were all fast. |
| G2 | M4 | No invalidation when price takes out the grab extreme after MSS spawn. | "Without making a new low" unenforced — dead-premise MSS walkers stay alive. | Kill MSS walker if post-spawn price violates the anchoring sweep's extreme (EM MSS §4). | Must refold-verify. |
| G3 | T1/T3 | Trend spawns on any tradable in-trend zone + clean displacement; no structure requirement, no structure-break invalidation. | Continuation traded without an established trend; pullback that breaks structure not killed. | Spawn requires latest swing-tier structure in zone direction; kill on opposing swing-tier break (EM Trend §1, §3). | Must refold-verify (June 9 trade 7, June 10 Trends were with-structure). |
| G4 | M2 | MSS spawn requires a rejected SESSION-LEVEL sweep; doc also allows clear intraday swing-low grabs. Engine failure_swings (validation=sweep) partially covers. | Under-spawning on pure swing-liquidity grabs. | Accept engine swept-swing evidence as the M2 grab when no level sweep exists (EM MSS §2). | ADDING spawns risks new trades on graded days — gate behind refold parity; drop if it moves a graded day (user rulings already cover those days' MSS candidates). |
| G5 | I4 | Inversion failed-leg extreme = extreme of `bars.last_5_bars` (whatever the bundle carried). | "The leg that created the violated zone" is not bounded — June 11 PM 13:30 produced a 333-pt stop. | RESOLVED — no code. Four refold-gated fixes all moved a frozen day; June 11 PM 13:30 is structurally identical to the accepted June 11 AM 13:58 launchpad stop, separable only by magnitude (curve-fitting). Logged decision 2026-06-13. | Any fix drifts frozen days; left unchanged. |
| G6 | R6.2 | `computeSize` exists (brief sizing note) but packets carry no size. | Trader never sees per-trade size on the packet. | Attach size to packet for display (TS §6) — accounting stays R-based. Dashboard-phase item. | None (display only). |
| G7 | R6.3 | Backtest books the FULL position at TP1 (realized R = TP1 multiple); no TP2/runner accounting. | §6 two-stage profit-taking is collapsed to TP1-only. | DOCUMENTED DECISION, not a code change: graded baselines (+10.01R/+1.35R) are computed under TP1-books-all accounting and are immutable. TP2 remains reported on the packet. Revisit only with user sign-off. | Changing it would move every graded R total — frozen. |
| G8 | R5.1 | Confirmation discipline is 1m close only. | Doc allows 1m OR 5m closes. | DOCUMENTED DECISION: the hand-graded days settled on 1m-close discipline (chain output graded correct trade-by-trade). 5m variant stays out unless a tape proves a missed doc-valid setup. | Adding 5m confirms would add entries on graded days — frozen. |
| G9 | I3 | Aggressive entry only (violating close). | Conservative retest variant in doc unimplemented. | DOCUMENTED DECISION: user rulings graded the violating close as THE entry across June 9/10. Retest variant intentionally out. | Frozen by rulings. |

## Verification protocol for every fix
1. Red test citing the doc section; minimal green (TDD).
2. Full suite + smoke + tape gates.
3. Refold June 9 AM, June 10 AM, June 11 AM + PM — graded trades must be identical
   (same entries, stops, TPs, same trade count, same day R).
4. Any drift on a graded day = the change does not ship as-is.

## Status
- G5 → RESOLVED 2026-06-13, no code (decisions-log). The standing June 11 PM
  13:30 stop question has no deterministic fix that spares the frozen days;
  the violating-candle anchor it "should" use is the same rule the frozen
  June 11 AM 13:58 stop violates. Interpretive; a §6 max-stop risk gate is
  flagged for user sign-off / Phase-5 empirical justification.
- G1, G2, G3 → implementation wave, one rule-set per PR, refold-gated.
- G4 → attempted last; dropped if it perturbs graded days.
- G6 → dashboard phase. G7, G8, G9 → decisions logged, no code.

## Phase 4 — audit closure (2026-06-13)

All gaps are resolved: implemented-and-cited, resolved-interpretive, or
logged-decision. The deterministic system now matches the spec for every
mechanizable requirement. Final state on `origin/main` @ b76b49a:

| Gap | Requirement (citation) | Resolution | Verified-by |
|-----|------------------------|-----------|-------------|
| G1 | TS §7 Step 6 / EM MSS §5 — 10–15 min tap→confirm window | `expireStaleTaps` (#48) | 886/886, refold-clean |
| G2 | EM MSS §4 — "without making a new low" | `buildMssWalkerKillRequests` (#49) | 888/888, refold-clean |
| G3 | EM Trend §1/§3/§4 — established trend + structure-break | swing-structure spawn gate + kill (#50) | 890/890, refold-clean |
| G4 | EM MSS §2 — "a very clear intra-day swing low" | swept-swing grab fallback (#51) | 891/891, refold-clean |
| G5 | EM Inversion §5/§6 — inversion stop | interpretive, no code (#47) | decisions-log |
| G6 | TS §6 — per-trade size on packet | dashboard phase | Phase 6 |
| G7 | TS §6 / §7 Step 7 — TP2/runner accounting | frozen decision | decisions-log |
| G8 | TS §5 — 1m OR 5m confirmation | frozen decision (1m) | decisions-log |
| G9 | EM Inversion §4 — conservative retest entry | frozen decision (aggressive) | decisions-log |

**Fold audit — every booked trade traces to a prior user ruling** (the frozen
hand-graded baseline, reproduced byte-identically under all five fixes):

- June 9 AM +10.01R / 5 — 3 Inversion shorts (2.41/4.13/2.80R) + 2 Trend
  shorts (−1 / +1.67R). All hand-graded (decisions: Inversion stop = failed-leg
  extreme; Trend stop = tap candle).
- June 10 AM +1.35R / 6 — 5 Inversion shorts + 1 Trend short, hand-graded.
- June 11 AM −1R / 1 closed — Inversion short 28908.75 → stop, TP1 28651
  (the GXNQ "28651" ruling).
- June 11 PM 0 / 0 — the 13:30 wide-stop setup correctly un-booked (G5).

**New skip/kill behaviors trace to doc sections** (none removed a booked
frozen trade): tap-timeout expiry (TS §7-6), MSS dead-premise kill (EM MSS §4),
Trend structure gate + break-kill (EM Trend §1/3/4), MSS swing-grab spawn
(EM MSS §2). The audit is CLOSED for the mechanizable surface; G6 (size on the
packet) lands in the dashboard phase. Remaining LLM-interpretive territory:
the Inversion impulse-launchpad vs consolidation-edge stop distinction (G5).

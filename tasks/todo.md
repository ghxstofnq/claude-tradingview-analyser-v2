# Todo — Validate the faithful-Lanto chain → live on Tradovate demo

Branch: `feat/faithful-lanto-rebuild`. See `tasks/plan.md` / `~/.claude/plans/mellow-frolicking-chipmunk.md`.
Strict gate first: no live session until Stage G passes. Live = armed auto-fire on demo, autonomous, monitored.

## Phase 0 — Smoke the harness  ✅ DONE
- [x] 0.1 Inventory: NO salvageable inputs — only 06-09 had a tape; all oracle sessions need fresh schema-4 recordings
- [x] 0.2 Folded chain on real data (06-09); helper `scripts/fold-tape.mjs` added
- [x] 0.3 Folded 140-bar live 06-23 session clean (no crashes, sane block-reasons)

## ⚠️ Key finding (2026-06-23): old tapes are STALE (pre-Stage-A levels/prices). Re-record EVERY session on schema 4. The live chart confirms the oracle's levels (AS.L 29595.25, PDL 29113.75) — see [[stale-tape-verify-live-chart]].

## Phase 1 — Stage G: record + fold the oracle sessions (GATE)
- [~] 1.1 06-09 (A+ Inversion short) — RE-RECORDED on schema 4 (stale tape replaced). Chain produces Lanto's exact 10:27 short (entry 29760, TP1 AS.L 29595.25) BUT over-fires ~9 premature shorts first → blocked on Phase 2 fix, then promote+verify
- [~] 1.5 06-16 (B short, MSS) — label authored, RECORDING in progress (task buphh0aa6); then fold → compare → promote
- [ ] 1.2 02-09 (A+ multi-align long) — author label → record → fold → compare → promote+verify
- [x] 1.6 06-17 (no-trade) — recorded + folded (12 A+ inversions = smoking gun)
- [x] 1.2 02-09 (A+ multi-align long) — recorded + folded (chain nails A+ entry; over-fires)
- [~] 1.7 06-18 (marginal B long) — label authored, RECORDING (task b42pglv7x)
- [BLOCKED] 1.3 12-12 (MES) + 1.4 10-02 (MNQ) — 2025 dates are OUT of TV 1m-replay range ("date not available for playback"). Labels authored, NOT recordable via 1m replay. Stage-G corpus = the 5 recordable 2026 sessions. (12-12 = the only MES/SMT-instrument case — flag for a later path; not blocking.)
- Labels: tests/fixtures/real-sessions/<date>-*.label.json. Oracle truth: docs/strategy/lanto-oracle.md Part D.
- [ ] **✅ CHECKPOINT G** — all oracle sessions match Lanto; `npm run tapes` + `npm test` green — user reviews

## Divergence table (chain vs oracle, fresh schema-4 folds)
| Session | Oracle | Chain's correct packet | Premature fires | Gap |
|---|---|---|---|---|
| 06-09 | A+ Inv short, e29731, TP1 AS.L 29595 | 10:27 Inv short e29760, TP1 AS.L 29595 ✓ | 9 premature Inv (09:34→) | inversion over-fire |
| 06-16 | B Reversal short, e30864, TP1 LO.L 30783 | 09:57 **Trend** short e30864 ✓, TP1 ~AS.L 30750 | 3 premature Inv (09:30→) | over-fire + model named Trend not Reversal/MSS |
| 06-17 | **NO-TRADE** (price quality) | — | **12 fired, 11 A+, ALL Inversion** | catastrophic false-positive |
- ALL premature fires are model=Inversion; Trend/MSS entries are CORRECT → the over-fire is localized to the Inversion lifecycle (findOpposingPdArrays spawns on every opposing FVG).
- 06-17 (no-trade) is the smoking gun: 12 Inversion packets (11 A+) where Lanto stands aside. THREE compounding gaps:
  - **A. Inversion over-fire** — the Inversion lifecycle fires on every opposing-FVG violation (primary).
  - **B. Grade rubber-stamps A+** — deriveGrade returns A+ for 11/12 on a no-trade day; no real discrimination.
  - **C. Pillar-2 entry veto misses two-sided chop** — `pillar2PoorAtEntry` (bar-close.js) checks tight-range/doji/weak-disp, NOT the directional-COHERENCE signal Stage B added in `cli/lib/pillar2-verdict.js`. `pillar2EntryGate()` IS on by default (config.js:48) — but the dims don't trip on normal-range chop. Wire coherence (compute from tape's 5m bars; bundle's 1m current_tf has coherence=undefined) into the entry veto.
| 02-09 | A+ multi-align long, e25632, TP1 LO.H 25723 (oracle ~3.4R on a 27pt stop) | 10:40 Inv long A+ e25633 ✓ | 2 premature B Inv (10:36,10:38) | over-fire + STOP too wide (chain 25538 leg-extreme vs oracle 25605 reclaim-low) → cascades TP1 to AS.H |
- LEG SIGNAL (promising gate): at real 06-09 10:27 entry, leg_high=30139.75 (the grab) & price fell ~380pt from it; at premature 09:34, leg_high=30040.75 & only ~93pt below. "Reversal depth from leg_high" separates real vs premature (zone significance does NOT — it's backwards).

## ✅ DETERMINISTIC SOLUTION FOUND (2026-06-23, web+transcript+data) — the inversion gate
Web (ICT iFVG) + transcript (ENTRY 08:26 break-of-structure, "sweep THEN iFVG") + the 5-tape data converge:
- **depth-in-leg classifies the entry** (computed from leg_high/leg_low — ALREADY in the engine, NO Pine change):
  depth = short:(legHigh-entry)/(legHigh-legLow) / long:(entry-legLow)/range.
  REVERSAL (deep ≥50%): 06-09 78%, 02-09 84%. CONTINUATION (shallow <50%): 06-16 18%, 06-18 1%. Clean split.
- **REVERSAL → require a RECENT (≤~90m) session-tier (AS/NYAM/LO) opposing-side grab** (sweep→iFVG, ICT). Blocks 06-09's 09:34/09:39 losers (only stale overnight AS.H@391m); keeps 09:52+ (LO.H@9-74m).
- **CONTINUATION → require a swing-tier structure break in the trade dir** (established trend; ENTRY 11:15).
- Combined gate validated: 06-09 ✓ (losers blocked, real fires), 06-16 ✓ (2 fire), 02-09 ✓, 06-18 ✓; **06-17 no-trade 12→3**.
- **Final chop filter (zero 06-17's last 3):** directional COHERENCE — 1m quality fields (range_q/disp/candle/regime/rvn) do NOT separate chop from real continuation (06-17 even reads disp=clean). Coherence is in Pine SOURCE (line 1050) but NOT deployed → COMPUTE it from the m15 bars the multi-TF recorder now captures (no deploy needed).
- ANSWER to "add shallow/early to engine": NOT needed (leg_high/leg_low suffice). Only missing = coherence → compute from m15 bars.

### Build steps
- [ ] **G1 (plumbing):** thread sweep fields (target/side/swept_ms/significance) into context.pillar1.sweeps (normalizeEvidenceList strips them; mirror 2-S1). Unit test.
- [ ] **G2 (gate):** pure `inversionEntryValid({context,side,entryPrice,nowMs})` (depth→reversal-grab/continuation-swing) in inversion-lifecycle.js; gate the confirmation. Env knobs GOFNQ_INV_DEPTH(0.5)/GOFNQ_INV_GRAB_RECENCY(90). TDD.
- [ ] **G3 (coherence veto):** compute m15 coherence (net/gross over the m15 window) from bars_by_tf.m15; veto continuation in chop. Needs the 4 multi-TF re-records.
- [ ] **G4:** re-record 06-16/06-17/02-09/06-18 multi-TF; fold all 5; promote+verify; npm test green.

## Phase 2 — IMPLEMENTATION PLAN (concrete; all inputs verified available)
Corpus to validate against (fold each with `node scripts/fold-tape.mjs` / the inline fold):
  06-09 (A+ Inv short, real entry 10:27 e29760 TP1 AS.L 29595) · 06-16 (B Trend short, 09:57 e30864) ·
  06-17 (NO-TRADE — must drop to ~0 fires) · 02-09 (A+ long, 10:40 e25633) · 06-18 (B long, ~09:43 e30470 TP1 30615).
- [ ] **2-S1 (plumbing, additive):** thread `legHigh/legLow/legHighMs/legLowMs/coherence/rangeVsNormal` from the engine quality row into context.pillar2 (`app/main/strategy/context/build-strategy-context.js` buildPillar2 — parser already extracts them, ict-engine-parser.js:62). No behavior change. Unit test the mapping.
- [BLOCKED — user decision] **2-S2 (inversion gate):** leg-depth gate DISPROVEN. Measured reversal-depth-in-ATR for every packet across 5 tapes: real entries span 0.1×ATR (06-18) → 9.1×ATR (06-09) — model-dependent (continuation entries shallow, reversal-inversions deep), NO threshold separates real from premature. All three 1m/5m signals now ruled out (zone significance is backwards; grab predates premature fires; leg-depth model-dependent). The faithful gate (enter at the significant HTF DRAW ARRAY, ENTRY/[[engine-htf-overread]]) needs HTF FVGs, and the no-trade veto needs 15m coherence — but the day-tapes only capture m5+1m (`engine_by_tf:['m5']`), so neither faithful gate can be built/validated offline against them. → SURFACED to user (re-record multi-TF? / their signal? / demote inversions?).
- [x] **2-Sx (recorder multi-TF, bf84d56):** USER PICKED re-record multi-TF. record-tape now captures m5+m15 (additive merge) + h4/h1/daily anchor snapshot. +4 unit tests.
- [~] **2-Sy (re-record + validate):** re-recording 06-09 with multi-TF (task bzg4477p3) → verify bundle has engine_by_tf.{m5,m15,h4,h1,daily}; then re-record the other 4 (06-16/06-17/02-09/06-18).
- [BLOCKED again] **2-S2 (inversion gate):** the HTF-draw-containment gate is ALSO backwards (06-09: premature 09:34 is INSIDE active h4/m15 bear FVGs; real 10:27 is OUTSIDE, nearby HTF FVGs 'invalidated'). FOUR mechanical gates now disproven (zone-sig, grab, leg-depth, HTF-draw). The split = reversal-inversions fire DEEP near the draw / continuation fires SHALLOW early — not a single engine field. Multi-TF capture works (h4/h1/m15 distinct, daily failed=minor, coherence not deployed→use regime) but didn't unblock the gate. → SURFACED: architectural decision (demote inversion → FVG-retrace primary? / LLM judges inversions? / user's tell).
- [ ] **2-S3 (no-trade veto, gap C):** wire 15m `coherence` (now in tape engine_by_tf.m15) into pillar2PoorAtEntry. Re-fold 06-17 → no-trade.
- [ ] **2-S4:** re-fold ALL 5; promote+verify each tape (set expected from oracle, verified:true); npm test green; note in decisions ledger.
- (model-naming Inversion-vs-Trend/MSS is a separate D1 item — defer unless it blocks a pass-bar match.)

## Phase 2 — Chain fixes (grounded in the Entry Models transcript)
GATE INSIGHT (2026-06-23): simple separators DON'T work — zone size_quality is "tiny" for BOTH premature
and real 06-09 zones; and a significant buy-side grab (PDH @09:05) predates the 09:34 premature short, so
"a grab happened" doesn't gate it. The real discriminator (Entry Models 31:25): "price [bearish] all the
way into your entry" — the REVERSAL must be established (recent significant high in, displacement down) AND
the entry is the retrace into the SIGNIFICANT HTF draw array (C→D handoff). Need the full multi-session
pattern before encoding — calibrate across the oracle, don't curve-fit to 06-09.
- [ ] 2a Inversion entry gate: reversal-established + retrace into the primary HTF draw array (not any opposing FVG). Calibrate across sessions. Locus: `inversion-lifecycle.js` + the C→D draw handoff.
- [ ] 2b TP1 is likely NOT broken — the 06-09 10:27 packet already targets AS.L 29595.25; the internal-swing TP1s were an artifact of the premature entry. Re-check after 2a.
- [ ] 2c TDD + re-fold 06-09 → expect first packet ≈ 10:27 short, TP1 AS.L 29595.25; full suite green; note in decisions ledger

## Phase 3 — Stage F: re-point UI to validated outputs
- [ ] 3.1 PREP/LIVE/REVIEW render 3-vote grade, 2×2 models, overnight vote, SMT, near-price draw, no-trim mgmt; no scale-in
- [ ] 3.2 Fix any stale/old-strategy field; re-probe matches chain output

## Phase 4 — Readiness + Tradovate arming (GATE, no orders placed)
- [ ] 4.1 TV Desktop CDP 9225 answers
- [ ] 4.2 Capture health all-fresh for London (Asia + ETH + 30m), MES+MNQ
- [ ] 4.3 live-check --session london clean / known blockers
- [ ] 4.4 Supervisor auto-arms london 03:00 ET; detector heartbeat; deterministic resolver active
- [ ] 4.5 Tradovate demo connected + account confirmed
- [ ] 4.6 automationMode=auto + resume-auto tapped; guardrails $250/$600
- [ ] 4.7 Routing dry-verify (adapter own-host route) — NO order placed
- [ ] **✅ CHECKPOINT R** — readiness green + demo armed — user confirms London target

## Phase 5 — First live demo session (next London)
- [ ] 5.1 Pre-open green; symbol pinned; mode armed
- [ ] 5.2 Background Monitor on bar-close + tail setups/no-trades/fills/logs
- [ ] 5.3 Supervise 03:00–06:00 ET; hot-fix plumbing only (engine owns orders)
- [ ] 5.4 Recap per-trade + defects + fixes
- [ ] **✅ CHECKPOINT (session review)** — traded correctly? triage defects

## Phase 6 — Iterate to fully working
- [ ] Fix Phase-5 defects (TDD + re-fold + re-probe); re-guard the gate; more clean sessions
- [ ] (later, separate gate) real-money path — out of scope here

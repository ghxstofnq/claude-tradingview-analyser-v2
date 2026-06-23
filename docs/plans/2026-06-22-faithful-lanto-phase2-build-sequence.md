# Phase 2 — Faithful Lanto Rebuild: build sequence

Turns the confirmed spec (Parts 1–5) + the Phase-1 machinery verdicts into a
dependency-ordered build. Sources: [decisions ledger](faithful-lanto-rebuild-decisions.md),
[spec](../strategy/README.md), [intent](../intent/2026-06-21-faithful-lanto-rebuild.md).

## Principles

- **Build as one coherent whole.** The pieces only make sense together (the −23R lesson —
  half-levers fold worse). Don't ship a stage against the old baseline.
- **Ground truth = hand-grade vs Lanto** (the Phase-0 oracle). The old corpus baseline is
  **retired** — never a gate.
- **Keep the plumbing, rebuild the brain.** Per the machinery map: capture pipes, engine
  mechanism, walker shell, execution pipes, sizing table, and UI shell stay; bias / grade /
  entry rules / management-exit get rebuilt; overlays + scale-in are deleted.

## Stage G owner + Phase 0 oracle — ASSIGNED TO CLAUDE (2026-06-22)

Stage G (the oracle **and** the validation) is **Claude's**, confirmed via interview:
- **Order (corrected 2026-06-22):** **Stage A first (engine → capture)** — so the oracle
  grades on the *faithful* evidence the chain will use, with the new fields as the grading
  primitives — → **oracle** (user-approved) → build **B–F** toward it → **validation LAST**
  (fold the rebuilt chain vs the oracle). ("Oracle before the *decision* logic" still holds;
  the data layer just precedes the oracle.) The Feb-09 *qualitative* anchor is
  engine-independent (Lanto's stated call); its exact levels + the fresh grades wait for
  Stage A.
- **Ground truth = Lanto.** Documented sessions: truth = his stated call. Fresh sessions:
  truth = Claude applying the confirmed rules, **user-approved**. Grade only **post-cutoff /
  OOS** sessions (apply rules, don't recall outcomes); the user's approval of the oracle is
  the independence check.
- **Sessions (~6–8):** documented + post-cutoff anchors — **2026-02-09** (multi-alignment
  A+), **2026-06-09** (Reversal-Inversion) — plus fresh OOS covering **Reversal-MSS**,
  **Continuation**, a **no-trade/chop** day, and a **2/3-B** day. No fresh grading of
  pre-cutoff sessions.
- **Deliverables:** (1) oracle doc — per session: bias / grade / model / side / entry / stop
  / TP + reasoning, for approval; (2) a validation report at the end (chain-vs-oracle,
  pass/fail). The oracle is the gate, **never the retired corpus baseline**.

## Corrections folded in from Phase-0 (2026-06-23) — these OVERRIDE the stage text below where they conflict

The oracle + a final 5-transcript audit corrected several things this plan predates. Apply these:

- **HTF vote = a SIGNIFICANT near-price ARRAY (FVG/iFVG, displacive + took-liq) + the reaction off it.**
  Raw **liquidity (buy/sell side) is the DRAW/target, NOT a vote** (BIAS 09:21 — marking liquidity isn't
  a bias). "Significant" = Lanto's *massive* vs *nothing crazy* (BIAS 27:42); a small gap doesn't earn
  the HTF vote even if you trade off it. → C1/C2: don't let a liquidity draw cast an HTF vote.
- **Grade elevation = MULTI-ALIGNMENT ONLY.** A+ = 3/3 bias **OR** a multi-alignment (*"two-and-one"*)
  entry on an aligned 2/3 day; a **single clean/displaced entry caps at B** (ENTRY 27:05/31:25). → C6 +
  D5/D6: encode the grade *consequence*, not just multi-alignment detection.
- **Stop anchors on the ENTRY ARRAY (FVG edge / inversion level), tight — NOT the swing high**
  (12-12 MES: a 6.25-handle stop at the 1H gap). A tight stop **only works on clean/displacing price**;
  in chop it gets wicked (PRICE 26:29) → pair it with the Pillar-2 clean-price gate. → D6.
- **Carry FVGs alive across the whole session, incl. pre-open/London MSS-leg gaps.** The entry is the
  **retrace into a held array** (often formed an hour+ earlier) + 1m confirm — NOT the impulse break.
  When price is too strong to retrace, the **Inversion off the break** is the entry (TRADE24 19:57). →
  D1/D4 + the walker shell.
- **Instrument is per-day SMT.** Lanto trades **ES *or* NQ** by the leader (12-12 = MES, 10-02 = MNQ) —
  the chain must **select the traded vehicle**, not assume one. → C4: SMT picks the instrument, not just
  confirms bias.
- **Price quality is the master gate: *"you can never outrade bad price"* (PRICE 27:25).** Bad price into
  confirmation ⇒ entry model + draw unreliable. → reinforces Stage B's gating role over C and D.
- **Ground truth = Lanto's actual calls** (Discord: instrument + entry/SL/TP) + the oracle. Most oracle
  *levels* are engine reconstruction (only 12-12 is Discord-pinned) — validate against the anchors **and**
  live Discord calls. → Stage G.

## Dependency-ordered stages

### Stage A — Data layer (engine, then capture)  [Components 2, 1]
- **A1 Engine:** add the new emit fields (per-leg displacement+speed, sweep-significance
  class, large-wick significant levels, wick-tap flag, overnight directional read,
  opening-range H/L + swept level, consolidation-vs-displacement regime, range-vs-normal
  ratio); make internal/external range + equal H/L explicit; **strip the decision fields**.
  Update the parser. Deploy the Pine to the on-chart study (correct deploy procedure).
- **A2 Capture:** add **30m**; lock **Extended Hours**; reliable **MES+MNQ simultaneous**;
  **Asia as a session**.
- *Verify:* the bundle carries every spec field for **both** symbols across
  D/4H/1H/30m/15m/5m/1m on ETH; parser reads it clean.

### Stage B — Price quality (Pillar 2)  [Part 2]  ✅ DONE + VALIDATED (2026-06-23)
- Verdict in `cli/lib/pillar2-verdict.js` → **good / marginal / poor** (codebase enum is `poor`, not
  `bad`), single-sourced for `gates.engine.pillar2` + the brief.
- **PRIMARY signal = directional COHERENCE** (new engine field, efficiency ratio = net move / gross
  path over a 1.5h window; read off the 15m row). Calibration found the engine's clean-bar
  `displacement` count read price quality BACKWARDS (two-sided whipsaw scores as "clean"); coherence
  fixes it. Engine deployed (schema 4, additive); persists via `tv layout save` (saveChartToServer).
- *Validated* on 10 sessions (7 oracle + 3 user-confirmed June chop days, 2026-06-23): coherence
  correctly separates good price (06-16 0.82, 06-09 0.80) from chop (06-17 0.19, 06-12 0.17, 06-02 0.25,
  06-04 0.22); **NO tradeable A+/B day ever false-reads poor**.
- **DECISION (locked) — `poor` is a DOWNGRADE/CAP, not a hard veto.** Validation showed poor-coherence
  (choppy price) is COMMON, and a choppy session is still tradeable when a clean entry exists (06-18 =
  poor price + clean entry → downsized B) vs no-trade when none does (06-17/06-12/06-02/06-04 = poor +
  no clean entry). Per "stand aside **OR** heavily downsize" (price-action.md). → **Stage C/D must NOT
  let `pillar2_verdict==='poor'` hard-block; it caps the grade and demands a clean Pillar-3 entry.** The
  trade-vs-no-trade split lives in **Pillar 3 (clean entry?)**, not Pillar 2. (Resolves the 06-18
  question.)

### Stage C — Bias + grade (Pillar 1)  [Component 4, Part 1]
- **C1** primary-draw = near-price + displacive + took-liq.
- **C2** HTF bias = the reaction off that draw.
- **C3** overnight directional **vote** (engine overnight read).
- **C4** SMT/leader: ES↔NQ **divergence**; leader confirms/flips.
- **C5** NY-open reaction: reject/invert + **hands-off**; 15/30-min window; no-single-event flip.
- **C6** the **nested 3-component grade** (count HTF/overnight/NY-open → draw-bias pillar;
  nested with pillars 2 & 3).
- *Verify:* bias direction + grade tier match the hand-grade on the golden sessions.

### Stage D — Entry rules (Pillar 3) + execution-packet  [Component 3, Parts 3–4]
- **D1** walker rules = **2 models (Reversal/Continuation) × 2 entry mechanisms
  (FVG-retrace/inversion)** on the kept walker shell.
- **D2** best-gap = displacement-first / took-liq-fallback / near-price.
- **D3** MSS gate = significant liquidity + reversal-speed-match (new engine fields).
- **D4** confirmation = 1m close **respect (FVG) / violate (inversion)** + engulfing-with-
  speed from bars.
- **D5** multi-alignment (5m FVG + 1m iFVG); inversion aggressive/conservative.
- **D6** execution-packet = nested grade + structural stops + TP1 1–1.5R / ultimate 2R+;
  **overlays deleted**.
- *Verify:* model / side / entry / stop / TP match the hand-grade on the golden sessions.

### Stage E — Management + execution  [Component 5]
- **E1** exit = no-trim trail, BE at TP1, **trail-and-exit-on-structure-change**; remove scale-in.
- **E2** execution engine places the new packets; remove scale-in routing; guardrails kept.
- *Verify:* a golden session's trade manages/exits as Lanto would.

### Stage F — UI re-point  [Component 6]
- Nested grade, 2×2 models, new evidence (overnight vote, SMT, near-price draw), no-trim
  management; remove scale-in controls.
- *Verify:* UI shows the rebuilt outputs.

### Stage G — Validate as a unit
- Fold the **golden sessions** through the full rebuilt chain; confirm
  bias/grade/model/side/entry/stop/TP match Lanto (the oracle pass bar). Only then is the
  rebuild done.
- Re-record a **fresh corpus** as the new clean regression baseline (going forward, not to
  chase a number).

## Notes
- A1 Pine deploy: open → set → **Update on chart** → save → verify by **key presence**
  (per the deploy procedure).
- C4 SMT depends on the reliable two-symbol capture from A2.
- Each stage carries unit tests; **Stage G (oracle, end-to-end) is the real gate.**
- Sequencing within "build as a unit": stages are the build *order*; nothing is *validated
  as done* until G passes on the whole chain.

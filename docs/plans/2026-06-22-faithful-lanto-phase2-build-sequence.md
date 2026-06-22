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

## Prerequisite — Phase 0 oracle (do first or in parallel with Stage A)

Hand-grade the golden sessions ([lanto-oracle.md](../strategy/lanto-oracle.md) Part C) to
what Lanto would do: bias · grade · model · side · entry · stop · TP. This is the only thing
that validates the rebuild, so it must exist before Stage G (and ideally guides each stage).

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

### Stage B — Price quality (Pillar 2)  [Part 2]
- Consume engine regime + range-vs-normal + displacement/candle → **good / marginal / bad**.
- *Verify:* pillar-2 verdict matches the hand-grade quality calls on the golden sessions.

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

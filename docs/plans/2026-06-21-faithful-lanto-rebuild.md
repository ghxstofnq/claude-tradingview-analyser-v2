# Plan — Faithful Lanto Rebuild

Intent: [docs/intent/2026-06-21-faithful-lanto-rebuild.md](../intent/2026-06-21-faithful-lanto-rebuild.md).
Spec: [docs/strategy/](../strategy/README.md). Gap list: [lanto-source-of-truth.md](../strategy/lanto-source-of-truth.md).

**Shape:** this is a *reconsideration-first* plan. Phase 0 builds the oracle we judge
against; Phase 1 puts every component on trial (keep / rebuild / replace) against the spec;
Phase 2 rebuilds the faithful pieces as a coherent whole and validates against the oracle.
Per-component task breakdowns (acceptance criteria, dependency order) get written when
Phase 1 sets each verdict — we don't pre-write rebuild tasks for parts we haven't tried yet.

**Two rules over the whole plan:**
- **Build as a unit.** No shipping isolated faithful pieces against the dead baseline (the
  −23R lesson). Validation happens against the hand-grade oracle, not old-corpus R.
- **Guilty until proven faithful.** A component survives only if it already serves
  correct-Lanto or is strategy-neutral plumbing that works.

---

## Phase 0 — Build the ground-truth oracle (do FIRST)

We cannot rebuild against "correct" without a measurable definition of correct.

- [ ] **Extract Lanto's worked examples** from the five transcripts: the trades and
  sessions he hand-walks (the MSS long, the inversion takes, the ES-leads-NQ flip, the
  multi-alignment A+, the *bad* examples). Capture: setup, bias, grade, entry model, entry,
  stop, target, and *why*.
- [ ] **Write the hand-grade rubric** straight from the docs: the 3-component count, the
  reject-vs-invert read, displacement / "can't outrade bad price", best-gap, MSS
  significance, 1m confirmation. One checklist per pillar.
- [ ] **Pick the golden sessions** we can reconstruct on the chart (real data; post-cutoff
  / out-of-sample per constraint #10) and hand-grade each: what Lanto would do, start to
  finish. This set is the fidelity oracle.
- [ ] Decide the oracle's pass bar (e.g. bias + grade + model + side must match; entry /
  stop / target within tolerance).

**Done when:** a small set of hand-graded golden sessions exists that any rebuilt component
can be checked against.

---

## Phase 1 — Put every component on trial

For each component below, produce a one-page verdict: **keep / rebuild / replace**, the
rationale against the spec, and (if rebuild) the interface it must expose. Order roughly
data-in → decision → execution.

1. **Capture (CDP / multi-TF).** Does correct-Lanto's data fit? Daily/4H/1H + Asia/London/NY
   sessions, **ES + NQ together** (SMT), near-price zones. Keep if sufficient; extend if SMT
   / Asia / session bounds need more. (Asia is currently not a tradable session; London is
   truncated.)
2. **Pine engine.** Does it emit what the faithful strategy reads — displacement +
   took-liquidity gaps, full session levels (incl. Asia), structure, inversions (`inverted_ms`),
   leg extremes? Gaps: cross-asset SMT, near-price ranking inputs, multi-alignment (5m+1m).
3. **Walker mechanism.** Can it *represent* the three models faithfully + multi-alignment +
   reject/invert bias + 1m confirmation, or does the mechanism itself constrain the
   strategy? Keep vs rebuild the mechanism.
4. **Pillar 1 — bias.** Rebuild to the **3-component count** (HTF + overnight + NY-open),
   reject-vs-invert at the key gap, **near-price** draw, recency-weighted overnight, **SMT /
   leading asset**, and no single-event bias flip.
5. **Pillar 2 — price quality.** Displacement core, **gap-size = magnetism** (gate target
   validity, not just ranking), **consolidation stand-aside**.
6. **Pillar 3 — entry models.** MSS (significant liquidity + reversal-matches-down-move),
   Trend, Inversion; **best-gap selection**; **multi-alignment 5m FVG + 1m iFVG**; 1m-vs-5m.
7. **Confirmation.** 1m candle close, deliberate / engulfing body, the 10–15-min rule.
8. **Grade.** Replace the alignment-based six-element grade with the **3-component count**
   (1/3 no-trade · 2/3 B · 3/3 A+); a 2/3 day trades with no HTF read.
9. **Sizing & management.** Mon/Fri-half / Tue–Thu-full; TP1 ≈ 1–1.5R, ultimate ≈ 2R+; the
   management styles (esp. no-trim "play the trail"); structural stops.
10. **Overlays.** Strip the bot-only ones unless Lanto-justified: exhaustion cap,
    15:32 / 11:40 cutoffs, 1.5R TP1 floor, 95-pt wide-leg stop cap.
11. **Execution engine.** Does trail / BE / runner management match Lanto's style?
12. **UI.** Reflects the faithful pillars + the 3-component grade.

**Done when:** every component has a keep/rebuild/replace verdict and the rebuild ones have
a target interface. This is where the real architecture decisions get made.

---

## Phase 2+ — Rebuild as a coherent whole, validate against the oracle

- [ ] Sequence the rebuild by dependency (data/engine → bias → quality → models →
  confirmation → grade → sizing/management → execution → UI). Write per-component task
  breakdowns now that Phase 1 fixed the verdicts.
- [ ] Build the faithful pieces **together**, not lever-by-lever.
- [ ] Validate against the **Phase-0 oracle** (hand-grade match), not old-corpus R.
- [ ] Once faithful: assess salvageable backtest data, then **re-record** the parts we need
  (or the whole corpus) for a fresh clean regression baseline.

---

## Open questions to resolve during Phase 1

- Which golden sessions are reconstructable with real, in-bounds data (constraint #10)?
- Does SMT require a genuine two-symbol capture+engine path, or can the leader be derived
  from existing per-symbol bundles?
- Can the current walker mechanism express multi-alignment + reject/invert, or is a
  mechanism change unavoidable?
- How much of the recorded tape corpus survives as input data for the re-record (price/
  engine evidence is implementation-independent; the strategy decisions are not)?

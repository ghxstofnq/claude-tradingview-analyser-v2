# Intent — Faithful Lanto Rebuild

*Confirmed via interview (2026-06-21). This is the statement of intent the rebuild plan
consumes. Spec: [docs/strategy/](../strategy/README.md). Audit / gap list:
[docs/strategy/lanto-source-of-truth.md](../strategy/lanto-source-of-truth.md).*

## The intent

- **Outcome:** Rebuild the system so it trades what Lanto *actually describes*. The whole
  system is on trial — **guilty until proven faithful**.
- **User:** The trader (you). The bot should trade like Lanto, not the curve-fit version
  that drifted.
- **Why now:** We just wrote faithful, transcript-grounded strategy docs. The live system
  is the wrong strategy top to bottom — alignment-based grade, bot-only overlays, and
  missing SMT / multi-alignment / the 3-component count / near-price / MSS-significance /
  consolidation stand-aside.
- **Success:** The bot reproduces the trades Lanto describes and grades sessions his way —
  verified by **hand-grading specific sessions against Lanto**, never by R on the old
  corpus.
- **Constraint:** The old fold-baseline (+120R etc.) is **invalid and is not a gate** — it
  measured the wrong strategy, so a faithful change *should* fold "wrong" against it.
- **Out of scope:** Chasing the old number; ripping out working strategy-neutral plumbing
  (CDP capture, tape recording) for its own sake — they survive unless a faithful change
  forces a touch.

## How we work this

- **Everything is on trial.** Every component — capture, Pine engine, walker mechanism,
  bias, price quality, the three entry models, confirmation, grade, sizing, management,
  execution, UI — must justify itself against correct-Lanto + the hand-grade ground truth.
  Strategy-neutral pipes that already work likely survive; anything baking in the old
  alignment-grade, the overlays, or a mechanism that can't represent SMT / multi-alignment
  / the 3-component count gets rebuilt.
- **Build as a coherent whole.** The faithful pieces only make sense together — that's the
  −23R lesson (the half-built honest-bias lever folded worse because it flipped direction
  without near-price, SMT, MSS-significance, the real grade count, etc.). Do not ship
  isolated faithful pieces against the dead baseline.
- **Ground truth = Lanto.** Hand-grade specific sessions: does the bot pick the bias, the
  grade (1/3 no-trade · 2/3 B · 3/3 A+), the entries, stops, and targets Lanto would? Use
  the dated examples he walks in the classes.
- **Data:** After building, salvage what's still usable from the current backtest data
  (likely the recorded price/engine tapes), then re-record the parts we need — or the whole
  corpus from scratch — for a fresh clean baseline. The new corpus is for
  regression/consistency, never to chase a number. (Validate on post-cutoff / out-of-sample
  data per CLAUDE.md constraint #10.)

## Next

Part-by-part reconsideration plan: [docs/plans/2026-06-21-faithful-lanto-rebuild.md](../plans/2026-06-21-faithful-lanto-rebuild.md).

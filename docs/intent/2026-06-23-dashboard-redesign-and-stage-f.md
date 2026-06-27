# Intent — Dashboard redesign + Stage F (UI re-point)

Confirmed via interview-me, 2026-06-23. Branch: `feat/faithful-lanto-rebuild` (worktree `ctv-rebuild`).

- **Outcome:** Re-skin the whole dashboard into the `design.md` black + electric-yellow / Inter
  language (adapted to dashboard density), with the Stage F functional re-point woven in, and every
  control verified end-to-end to a real backend handler.
- **User:** The trader running this dashboard live every day.
- **Why now:** The brain rebuild (Stages A–E) emits new outputs the UI doesn't show yet; the look
  gets refreshed in the same pass so it ships as one coherent surface.
- **Success:** Every panel reads in the new design at working density; PREP/LIVE/etc. surface the
  rebuilt outputs (3-vote grade, 2×2 models, overnight/SMT/near-price evidence, no-trim trail);
  zero dead or half-wired controls; helper tests green; final visual sign-off at the Tradovate demo.
- **Constraint:** Re-skin only (keep layout/IA); yellow stays a scarce accent per `design.md`'s own
  do's/don'ts; no renderer UI test harness, so visual check = the user's eyes + the demo; one effort
  delivered panel-by-panel, suite-green per slice.
- **Out of scope:** No layout/navigation restructure; no literal marketing pieces (hero / pricing /
  footer / CTA bands) or 96px marketing spacing; no new backend features beyond wiring what already
  exists; the trail's live feed + broker mirror + backtest grader parity still wait for the demo pass.

## Design source

`design.md` (ClickHouse-style token system) — committed to the branch alongside this doc. It is a
*marketing-site* system; only its **language** transfers (palette, Inter + JetBrains Mono, dark-card
+ scarce-yellow-accent, radius/hairline, do's/don'ts). Marketing components and 96px rhythm do NOT.

## Delivery

Token/theme layer first (palette + type as CSS variables every panel inherits), then panel-by-panel:
each slice = re-skin + wire any Stage-F new outputs + verify backend wiring, committed suite-green,
eyeballed as it lands. Full visual pass at the demo.

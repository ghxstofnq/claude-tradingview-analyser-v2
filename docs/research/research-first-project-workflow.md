# Research-first project workflow

Date: 2026-06-04

GXNQ preference for this project:

- Before implementing a new feature, fix, architecture change, provider/runtime change, strategy-rule change, or similar project task, do explicit research first.
- Research should answer:
  - how this can be built;
  - what prerequisites/contracts are needed;
  - current best practices and common failure modes;
  - how the approach applies to this repo's deterministic MNQ/MES strategy engine.
- Save the research in the project before or alongside implementation.
- Prefer `docs/research/` for reusable technical/context research and `docs/plans/` or `docs/superpowers/plans/` for implementation plans that reference that research.
- Later related or similar work should search/read the saved research first and either reuse it or update it if it is stale.
- Implementation summaries should mention which research note was referenced or created.

Default artifact pattern:

1. Create or update `docs/research/<topic>.md` with findings, constraints, and open questions.
2. Build the implementation from that saved research, not from memory alone.
3. Add tests for the researched contracts/failure modes.
4. In the final status, report: research saved/referenced, files changed, tests run, blockers/caveats, next priorities.

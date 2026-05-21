# Fixtures

Regression baselines for `/analyze` and the project's analysis pipeline. Each fixture is a pair of files sharing a numeric prefix:

- `NNN-label.bundle.json` — captured output of `./bin/tv analyze` against a specific chart state.
- `NNN-label.expected.md` — hand-graded expected analysis: pillar1 / pillar2 / pillar3 verdicts + grade, with every cited price using the project's `<price> (<json.path>)` syntax.

## How to add a fixture

1. Set the chart on TradingView (CDP 9223) to the state you want to capture.
2. Run `npm run fixture:new -- <label>` — picks the next free `NNN`, captures the chart via `tv analyze --out` (the `--out` flag is required: the multi-TF Pine bundle exceeds the ~64KB stdout truncation limit), and scaffolds the `expected.md` template.
3. Hand-grade the bundle using the strategy's 7-step checklist (`docs/strategy/trading-strategy-2026.md §7`). Write to `tests/fixtures/NNN-label.expected.md`. Cite every price with `<price> (<json.path>)`.
4. `npm run smoke:fixtures` — verifies bundle schema and that every cited price resolves to a matching value in the paired bundle.

## What `npm run smoke:fixtures` checks

- **Bundle schema** — top-level keys (`timestamp`, `chart`, `quote`, `bars`, `bars_by_tf`, `engine`, `engine_by_tf`, `gates`) and the expected nested fields are present. Catches CLI drift (someone refactors `cli/commands/analyze.js` and accidentally breaks the schema).
- **Citation integrity** — every `<price> (<json.path>)` pair in the expected analysis resolves to a matching value at that path. Enforces CLAUDE.md hard constraint #6 (cite-or-reject).

## When to grow the corpus

Small-on-purpose. Add fixtures **as varied chart states actually occur**, not all at once. Target coverage over time:

- NY-open-window with an A+ setup (rare; capture when it happens).
- NY-open-window with a B setup.
- NY-open-window with no setup.
- Outside NY window (typical state).
- One A+ per entry model — MSS, Trend, Inversion.

Run `npm run fixture:coverage` to see which of these target cells are still empty.

Per [docs/research/ai-trading-analysis.md](../../docs/research/ai-trading-analysis.md) rec #7: full golden-set is ~50 fixtures eventually. The current corpus is intentionally small; build organically as interesting setups surface live.

## When to re-grade

If the strategy changes (new rules in `docs/strategy/`), or if you (the trader) disagree with a Claude-graded expected file, **edit the `.expected.md` directly**. The expected files are not write-once — they're the project's documented opinion of "the right read" for that chart state, and that opinion can be updated.

Re-run `npm run smoke:fixtures` after any edit to confirm citations still verify.

## Fixture 001-current

A NY AM entry-hunt snapshot of `CME_MINI:MNQ1!` from 2026-05-21, captured after the ICT Engine migration (new bundle shape — `engine` / `engine_by_tf` / `gates.engine`). Claude-graded as `no-trade`: a bullish Trend candidate is forming (price inside a high-displacement bullish FVG) but unconfirmed. Reviewer should amend if the read differs.

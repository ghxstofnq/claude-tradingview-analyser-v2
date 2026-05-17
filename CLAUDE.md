# claude-tradingview-analyser — project rules for Claude

This file extends the user's global working agreement at `~/.claude/CLAUDE.md`. The global agreement still applies in full. This file documents project-specific decisions, constraints, and context.

## Research basis

Behavioral rules in this project are grounded in two research passes, both saved in-repo:

- [docs/research/ai-consistency.md](docs/research/ai-consistency.md) — what produces consistent LLM behavior. Headline: "tool calling" is half-right; **grammar-constrained decoding against a schema** is the real mechanism. In a Claude Code session we approximate it via a tight slash-command schema, few-shot examples in `<example>` tags, self-check rules, and golden-set regression testing.
- [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — accuracy of LLM-driven chart analysis. Headline: literature is uniformly skeptical; LLMs underperform buy-and-hold in published benchmarks; **no peer-reviewed work on LLMs + ICT structures.** Hybrid (deterministic extraction → LLM synthesis) consistently beats LLM-only.

**Consult these before** designing a new analysis mode (tracker / scanner / backtester), changing `/analyze`, adding a new slash command that involves Claude reasoning over data, or modifying the hard constraints below. When proposing a behavioral change, cite the relevant research finding as authority.

## Strategy basis

This project implements the user's documented trading methodology — **Lanto's 3-pillar ICT framework**. The full specification lives in:

- [docs/strategy/trading-strategy-2026.md](docs/strategy/trading-strategy-2026.md) — the three pillars (Draw & Bias, Price Action Quality, Entry Model + Confirmation), the multi-timeframe framework (HTF Daily/4H/1H + Overnight Asia/London + NY open reaction), A+ vs B grading, and the 7-step trading checklist. **No trade unless all three pillars align.**
- [docs/strategy/entry-models.md](docs/strategy/entry-models.md) — the three entry models in detail: **MSS (reversal after liquidity grab)**, **Trend (continuation in direction of displacement)**, **Inversion (failed opposing PD array)**. Each with core components, A+ example, stop placement, and target logic.

**Consult these before** any strategy-related work: structuring analysis output, defining what counts as a setup, building the tracker / scanner / backtester, encoding grading logic, choosing what to read from the analyze JSON bundle, or proposing changes to `/analyze`. When proposing a strategy-related change, cite the relevant strategy file.

## Hard constraints

1. **CDP port 9223 only. Never 9222.** The vendored CLI under `cli/` has its core (`packages/core/connection.js`, `packages/core/tab.js`) hardcoded to 9223. Do not invoke upstream `~/tradingview-mcp-ict` from this project — that copy targets 9222 and is used by other projects on this machine.
2. **CLI only — no MCP tools.** Do not use any `mcp__tradingview__*` tool when working in this project. Every TradingView interaction goes through `./bin/tv` (or directly `node ./cli/index.js`).
3. **No edits to other projects.** Do not modify `~/Documents/ai-trading-agent` or `~/tradingview-mcp-ict`. This project is fully self-contained.
4. **Local state only.** Project state lives under `./state/`. Never read or write `~/.tradingview-mcp/`. The two upstream commands that wrote there (`brief` and `session`) have been stripped from the vendored CLI; the corresponding core modules (`morning.js`, `paths.js`) deleted.
5. **Screenshots are for verifications and tests only.** `./bin/tv screenshot` exists but its output never feeds analysis. Do not include screenshots in the `analyze` bundle. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — multimodal LLMs can answer correctly while barely using the image; screenshots risk visual hallucination.*
6. **Cite-or-reject.** Every numeric price in any analysis output MUST be cited with the exact syntax `<price> (<json.path>)`, where the path is a real JSON accessor into the `tv analyze` bundle that resolves to the exact value cited. Examples: `29172.75 (quote.last)`, `29302.75 (pine.labels.studies[0].labels[0].price)`, `29307.25 (pine.boxes.studies[0].zones[2].high)`. Approximations, rounded prices, and prose-style parentheticals like `29172.75 (close)` are forbidden. The harness (`npm run smoke:fixtures` → `scripts/verify-citations.js`) mechanically enforces this rule against every paired fixture in `tests/fixtures/`. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — top documented failure mode is hallucinated levels; verifiable post-hoc with a string check.*
7. **No LLM arithmetic.** Stop distance, R:R, ATR, bar counts, range size, displacement magnitude — all computed in code and emitted in the JSON. Claude reads numbers, never produces one. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — LLM arithmetic error rises ~+14 percentage points with numerical magnitude; the cure is tool-use, not better prompting.*
8. **Prose first, JSON last.** Analyses reason in prose; emit one structured JSON block at the end. Do not force JSON during the reasoning itself. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — forcing JSON output during reasoning degrades accuracy 10–15%.*
9. **Grade enum only.** Use `A+ | B | no-trade` exclusively in any structured analysis output. No "high-conviction" / "very likely" / "strong setup" — these vocabularies are systematically overconfident. Emit `A+` only when ALL six elements align (HTF bias + overnight context + NY reaction + price quality `good` + entry model identified + confirmation `confirmed`). `B` if one element is weaker. `no-trade` if multiple elements are weak/missing OR no entry model is in play. *Sources: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — LLMs in finance show Expected Calibration Error 0.12–0.40; [docs/strategy/trading-strategy-2026.md](docs/strategy/trading-strategy-2026.md) §7 step 7 — strategy grading definition.*
10. **No backtesting on data Claude has seen.** When validating analyses on historical sessions, use post-cutoff dates or out-of-sample symbols. Frontier LLMs memorize prices and outcomes on widely-discussed pre-cutoff dates. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md).*
11. **Strategy authority — `docs/strategy/*.md` is the spec.** When interpreting setups, frame analyses, or define what counts as a trade, follow the 3-pillar framework and the three entry models (MSS / Trend / Inversion) exactly. Do not invent ICT concepts outside that scope or substitute generic TA. If the strategy is silent on a question, surface that gap rather than improvising.

## Architecture decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-17 | CLI-only consumption, no MCP tools | Ship without MCP config requirement; CLI is the long-term canonical surface. |
| 2026-05-17 | Vendor the `tv` CLI inside this project | Enables first-class custom `tv <foo>` commands sharing in-process core access. Cost: maintained fork. |
| 2026-05-17 | Lock to CDP port 9223 | 9222 is the default for `ai-trading-agent` and upstream `tradingview-mcp-ict`. 9223 is this project's lane. |
| 2026-05-17 | ICT methodology | Analysis framed in ICT vocabulary (HTF bias, liquidity, FVGs, order blocks, killzones, mitigation, IPDA). |
| 2026-05-17 | Build order: live single-chart read first | Foundation primitive. Tracker, scanner, backtester build on top. |
| 2026-05-17 | Claude Code session only — no Anthropic API in scripts | Project is `tv` recipes + this CLAUDE.md teaching Claude how to use them. No API key required. |
| 2026-05-17 | Stripped `brief`, `session`, `morning.js`, `paths.js` | Removes footguns that would write to shared `~/.tradingview-mcp/`. |
| 2026-05-17 | Screenshots out of analysis input | Source: research; multimodal hallucination risk on chart images. |
| 2026-05-17 | Cite-or-reject rule (constraint #6) | Source: research; top documented failure mode is hallucinated levels. |
| 2026-05-17 | No LLM arithmetic (constraint #7) | Source: research; arithmetic error grows with magnitude. |
| 2026-05-17 | Prose-first, JSON-last output (constraint #8) | Source: research; JSON-during-reasoning costs ~10–15% accuracy. |
| 2026-05-17 | Grade enum `A+ | B | no-trade` (constraint #9) | Sources: research (LLM verbal confidence is unreliable) + strategy §7 (the user's actual grading vocabulary). |
| 2026-05-17 | ICT vocabulary moved out of CLAUDE.md into the slash command body | Source: research rec #6; keeps CLAUDE.md under instruction ceiling, re-loads vocab per `/analyze` call. |
| 2026-05-17 | Trading strategy: Lanto's 3-pillar ICT framework | User's documented system; saved verbatim in `docs/strategy/` as the authoritative reference. Three pillars (Draw & Bias, Price Action Quality, Entry Model + Confirmation) and three entry models (MSS, Trend, Inversion). |

## Repo

- Private GitHub repo: https://github.com/ghxstofnq/claude-tradingview-analyser
- Workflow: feature branches + PR. Never push directly to `main` after the bootstrap commit.
- Commits: Conventional Commits (`feat: / fix: / chore: / docs: / refactor: / test:`).
- Hooks: never bypass (`--no-verify` / `--no-gpg-sign` / `--force` / `--amend` forbidden unless explicitly asked).
- Co-author tag on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Workflow rules for Claude

- **Re-read before each step.** Before starting any step in the "Pending implementation" sequence below (or any non-trivial behavioral / strategy change to `/analyze`, `tv analyze`, or the gates), re-read all four files: `docs/research/ai-consistency.md`, `docs/research/ai-trading-analysis.md`, `docs/strategy/trading-strategy-2026.md`, `docs/strategy/entry-models.md`. Confirm the planned approach against the documents and call out any tensions before writing code. *User-imposed standing rule, 2026-05-17.*
- **Run the harness before claiming a step is done.** `npm run smoke:fixtures` must pass before committing any change to `cli/commands/analyze.js`, `.claude/commands/analyze.md`, or `scripts/verify-citations.js`. If a change invalidates an existing fixture (e.g. by adding a required field), update the fixture and the schema check together — do not weaken the schema.
- **Cite every research / strategy claim.** When proposing a behavioral change, point at the exact section (file + heading) that supports it. "The research says…" without a citation is not acceptable.

## Layout

```
.claude/
  commands/
    analyze.md            /analyze slash command — includes ICT vocab and behavioral rules
bin/
  tv                      shell wrapper around ./cli/index.js
cli/
  index.js                vendored entrypoint; registers all commands
  router.js               vendored router
  commands/
    (vendored upstream commands)
    analyze.js            project-local: bundles JSON for /analyze
docs/
  research/
    ai-consistency.md            evidence base for consistency rules
    ai-trading-analysis.md       evidence base for accuracy rules
  strategy/
    trading-strategy-2026.md     Lanto 3-pillar framework + 7-step checklist (authoritative)
    entry-models.md              MSS / Trend / Inversion entry models in detail (authoritative)
packages/
  core/                   vendored @tvmcp/core; CDP_PORT = 9223
package.json              workspaces, scripts (tv / smoke / smoke:fixtures), sole runtime dep
scripts/
  verify-citations.js     enforces constraint #6 on a paired (analysis, bundle)
  smoke-fixtures.js       schema + citation regression across all fixtures
state/                    gitignored; created on demand
  screenshots/            verification / tests only — NOT analysis input
tests/
  fixtures/               regression baselines (NNN-label.bundle.json + .expected.md)
    README.md             how to add and grade fixtures
```

## The `analyze` recipe (what `/analyze` does)

`./bin/tv analyze` returns one JSON object:

```
{
  timestamp:     ISO-8601 string
  chart:         { symbol, resolution, chartType, indicators[] }
  visible_range: { from, to } (unix seconds)
  quote:         { last, ohlc, volume, ... }
  bars:          OHLCV summary at the chart's current TF
  bars_by_tf:    { daily, h4, h1, m15, m5, m1 }   per-TF OHLCV summaries (D / 240 / 60 / 15 / 5 / 1)
                                                  captured by switching chart through each TF and restoring
  pine_by_tf:    { daily, h4, h1, m15, m5, m1 }   per-TF Pine boxes + labels (verbose), trimmed to
                                                  tracked studies (FVG/iFVG, Anchored Structures,
                                                  Killzones, BPR) with ~30 most-recent entries per study.
                                                  This is where HTF FVGs and HTF structure points live.
  indicators:    [{ name, values: {...} }]  (current values of every visible indicator)
  pine: {
    lines:       [{ price, label, ... }]    horizontal levels (PDH, PDL, swing levels, equal highs/lows)
    labels:      [{ price, text, ... }]     text annotations (bias readouts, level names)
    tables:      [{ rows... }]              table data (session stats, analytics dashboards)
    boxes:       [{ high, low, label }]     price zones (FVGs, order blocks, ranges)
  }
  gates: {
    session:        { label, timestamp_et, is_weekend, in_ny_open_window, in_killzone, in_killzone_detail }
    price_context:  { last, inside_boxes[] }
    pillar1: {
      session_levels: { PWH, PWL, PDH, PDL, AS_H, AS_L, LO_H, LO_L, NYAM_H, NYAM_L, NYPM_H, NYPM_L }
                                                 each { label, price, position_vs_price, taken }
      untaken_sell_side_below: [{ key, label, price, ... }]   sorted by nearest first
      untaken_buy_side_above:  [{ key, label, price, ... }]   sorted by nearest first
      bias_labels: [{ text, price, study, x }]   labels matching /bias/i; empty if no indicator publishes them
    }
    pillar2: {
      range_value, range_per_bar, range_acceptable,
      avg_body_ratio_last_5, candle_quality_heuristic,    current-TF body-ratio summary (backwards-compat)
      current_tf, m5, m15                                 each { body_ratios_last_5, avg_body_ratio_last_5,
                                                                  candle_quality_heuristic, engulfing_count_last_5,
                                                                  doji_count_last_5 }
                                                          m5 + m15 are the strategy-aligned TFs per §7 step 3
    }
    pillar3: {
      most_recent_structure: { ST_HH, ST_HL, ST_LH, ST_LL, IT_HH, IT_HL, IT_LH, IT_LL, LT_HH, LT_HL, LT_LH, LT_LL }
                                                 each { label, price, x }   higher x = more recent
      fvg_by_type:       { bullish_fvg, bullish_ifvg, bearish_fvg, bearish_ifvg, unknown }
      fvg_by_type_above: same shape, FVGs above current price
      fvg_by_type_below: same shape, FVGs below current price
      last_bar: { time, open, high, low, close, body_ratio, direction, range, close_position_in_range }
                                                 single most-recent bar facts for confirmation discipline
      last_bar_age_seconds: quote.time - last_bar.time   staleness check
    }
  }
}
```

Gates are pre-computed in `cli/commands/analyze.js`. The LLM consumes them directly and does not recompute. See "Workflow rules for Claude" above for the discipline.

**Key-naming note.** Session and structure-point keys use underscore form (`AS_H`, `ST_LH`) so they're citation-safe under the verifier's path syntax. The original chart label text (`AS.H`, `ST-LH`) is preserved in each entry's `label` field for human readability.

**File output.** Pass `--out <path>` to `tv analyze` to write the bundle to a file instead of stdout (mandatory for `/analyze` invocations because the multi-TF bundle exceeds Bash output truncation limits). The slash command runs `./bin/tv analyze --out state/last-analyze.json` and then `Read`s the file.

The slash command body (`.claude/commands/analyze.md`) contains the ICT vocabulary, the behavioral rules (cite-or-reject, no arithmetic, prose-first, confidence enum), and the trailing JSON template. Read that file when invoked, not this one.

## Status

- **Scaffolding pushed.** README + .gitignore on `main`. CLI vendored, port locked, `analyze` command in place, slash command in place, research and strategy saved.
- **Research bound.** Hard constraints 5–10 cite the research files as authority. Future design changes must do the same.
- **Strategy bound.** Hard constraint #11 makes `docs/strategy/*.md` the authoritative spec for trade framing. `/analyze` mirrors the 7-step checklist. A+ examples for all three entry models are embedded.
- **Harness operational.** `npm run smoke:fixtures` runs schema + citation checks across every fixture. Verifier mechanically enforces constraint #6.
- **Gates emitting (richer).** `tv analyze` now returns a `gates` object covering: clock-based session, price-in-box checks, **full session liquidity map (PDH/PDL/AS_H/AS_L/LO_H/LO_L/NYAM_H/NYAM_L with taken/untaken)**, **most-recent ICT swing structure points (ST/IT/LT × HH/HL/LH/LL) ordered by Pine x-index**, **FVG counts classified by direction (bullish_fvg / bullish_ifvg / bearish_fvg / bearish_ifvg) via bgColor**, **bias-label scan** (auto-populates if any indicator publishes /bias/i text), **single-bar last_bar confirmation facts**, plus the original range / candle-quality stats. LLM no longer has to compute any of these.
- **Multi-TF bundle.** `bars_by_tf` and `pine_by_tf` provide Daily/4H/1H/15m/5m/1m bar summaries and trimmed Pine surfaces (boxes + labels for tracked studies). Captured via chart-switching with original-TF restore.
- **File output.** `./bin/tv analyze --out <path>` for bundles too large to pipe via stdout.

## Pending implementation

### Done so far

- Restructure `/analyze` around the 3-pillar framework, mirroring `trading-strategy-2026.md §7`.
- Three A+ canonical examples (MSS / Trend / Inversion) embedded as `<example>` blocks in the slash command. *Source: [docs/research/ai-consistency.md](docs/research/ai-consistency.md) — 72%→90% accuracy lift from Tool Use Examples.*
- Citation verifier (`scripts/verify-citations.js`) enforces constraint #6 mechanically against any paired `(analysis, bundle)` input.
- Minimal verification harness (`scripts/smoke-fixtures.js`, `npm run smoke:fixtures`) — schema + citation regression across every fixture in `tests/fixtures/`.
- Seed fixture (`tests/fixtures/001-current.*`) with hand-graded expected analysis from a 2026-05-15 NY-PM MNQ snapshot.
- **Deterministic gates in `tv analyze` (extended).** Top-level `gates` object emitted by `cli/commands/analyze.js`. Coverage:
  - `gates.session.*` — clock-based session label + booleans (NY open window, killzone status, weekend).
  - `gates.price_context.*` — which Pine boxes contain current price.
  - `gates.pillar1.session_levels.*` — full session liquidity (PDH/PDL/AS_H/AS_L/LO_H/LO_L/NYAM_H/NYAM_L plus PWH/PWL/NYPM_H/NYPM_L when set) with `taken / untaken` derived from bars.high/low.
  - `gates.pillar1.untaken_sell_side_below[]` + `untaken_buy_side_above[]` — sorted draw targets.
  - `gates.pillar1.bias_labels[]` — any Pine label matching /bias/i across all studies; empty when no indicator publishes them.
  - `gates.pillar2.*` — range + candle-quality stats. Includes nested `current_tf`, `m5`, `m15` objects each with body_ratios array, avg body ratio, candle-quality heuristic, engulfing count, and doji count over the last 5 bars at that TF. **Strategy §7 step 3 asks for 5m/15m anatomy specifically**, so `m5` and `m15` are the authoritative gate values; the chart's current TF stats are a live LTF gauge.
  - `gates.pillar3.most_recent_structure.*` — ST/IT/LT × HH/HL/LH/LL latest by Pine x-index.
  - `gates.pillar3.fvg_by_type{,_above,_below}` — FVG counts by direction (bullish_fvg / bullish_ifvg / bearish_fvg / bearish_ifvg) decoded from Nephew_Sam_'s bgColor.
  - `gates.pillar3.last_bar` — single most-recent bar facts (body_ratio, direction, close_position_in_range, etc.) for the strategy's confirmation discipline.
  - `gates.pillar3.last_bar_age_seconds` — staleness check.
  - The slash command is wired to consume all of these directly, not recompute them.

### Next (do in order)

- **Grow the fixture corpus organically.** The current corpus has one fixture, captured post-NY-close (Inter-session). The gate logic that doesn't get exercised by this fixture — `in_ny_open_window = true`, `in_killzone = true`, weekend handling, different `candle_quality_heuristic` verdicts — is **untested**. Add fixtures over the coming weeks as varied chart states surface: NY-open A+, NY-open B, NY-open no-trade, London-open, A+ per entry model. Target ~10 by month-end. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) rec #7.*
- **Decide on heuristic thresholds per symbol/timeframe.** Current Pillar 2 thresholds (range ≥ 40, body-ratio ≥ 0.6 = good) are calibrated for MNQ 1-minute, from the seed fixture. If we add NQ / ES / other instruments or different timeframes, these need to become symbol-aware. Until then, the heuristic verdict is a hint, not a verdict — slash-command rule 5 already lets Claude override.
- **LLM-as-judge for semantic regression.** Once the corpus exceeds ~10 fixtures, manual eyeball-grading becomes the bottleneck. Spawn a second Claude session that scores agreement between a captured `/analyze` output and the paired `.expected.md`. Until then, manual review is enough.

### Known gaps (deferred, by design)

Remaining LLM-interpretive territory:

- `pillar3.entry_model_candidate` — *which* of MSS / Trend / Inversion is in play remains interpretive. Mechanical detection would need an ICT-detector Pine script (smart-money-concepts on GitHub is the closest reference). Out of scope right now.
- `pillar3.confirmation_status` (the verdict, not the underlying facts) — `gates.pillar3.last_bar.*` provides single-bar discipline (body_ratio, direction, close_position_in_range); judging "confirmed vs candidate vs invalidated" still requires the LLM to combine those facts with setup context.

**No longer deferred (resolved in earlier commits):**
- ~~Overnight liquidity~~ — `gates.pillar1.session_levels.*` (mechanical from ICT Killzones labels).
- ~~Structure points~~ — `gates.pillar3.most_recent_structure.*` (mechanical from Anchored Structures verbose labels).
- ~~FVG direction~~ — `gates.pillar3.fvg_by_type_*` (mechanical from Nephew_Sam_'s bgColor mapping).
- ~~Multi-timeframe bar data~~ — `bars_by_tf.{daily,h4,h1,m15,m5,m1}` (chart switches through each TF, restores original).
- ~~HTF Pine surfaces~~ — `pine_by_tf.{daily,h4,h1,m15,m5,m1}.{boxes,labels}` (verbose, trimmed to tracked studies, ~30 most-recent entries per study per TF). HTF FVGs and HTF structure points now in-bundle.
- ~~Explicit Bias label scan~~ — `gates.pillar1.bias_labels[]` (auto-populates if any indicator publishes a label matching /bias/i).
- ~~Last-bar confirmation facts~~ — `gates.pillar3.last_bar.{body_ratio, direction, close_position_in_range, ...}` + `gates.pillar3.last_bar_age_seconds`.

## Open questions for the user

(To be answered after the scaffold PR is reviewed.)

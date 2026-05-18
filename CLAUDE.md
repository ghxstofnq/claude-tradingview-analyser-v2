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
| 2026-05-18 | Watchman is a candidate-flagger, not a grader | `tv watch` emits `bar_close_in_fvg` events when bar+FVG+body conditions align; it does NOT decide MSS/Trend/Inversion or A+/B/no-trade. Source: strategy §5 (confirmation is interpretive) + CLAUDE.md "Known gaps" (entry_model_candidate and confirmation_status are explicitly deferred). The watchman is the *trigger*; `/analyze` is the *grader*. |
| 2026-05-18 | Watchman uses subprocess calls to `tv analyze` | `cli/commands/watch.js` spawns `node ./cli/index.js analyze ...` instead of importing the analyze handler in-process. ~100ms node-startup overhead per tick is negligible against ~0.2s scan / ~13s baseline runtimes, and we get fault isolation: a bad tick can't crash the watcher loop. |
| 2026-05-18 | Watchman context-gating defaults ON, opt-out via flags | Filter alerts by killzone presence, market-open state, and m5/m15 candle quality. Strategy §2.2/§2.3 (liquidity moves during sessions) + §3 (stand aside when price quality is bad). Opt-out (rather than opt-in) means the conservative default matches the strategy. Direction-aware filtering (bullish-bar-into-bullish-FVG etc.) remains deferred — that's the entry-model classification step. |
| 2026-05-18 | Watchman state machine keyed by FVG coordinates, not zone index | Watch key = `(study, zone_high, zone_low)`. Zone indices shift as FVGs are added/removed; coordinates are stable. This makes watches reliable across the rolling scan snapshots and across restart. |
| 2026-05-18 | Context gates apply to new taps only, not to existing watches | Once a setup is armed, the strategy's 10–15 min timer runs intrinsic to the setup, not the session clock. A tap that fires during NY AM still gets its confirmation/invalidation evaluated even if the window straddles into inter-session. Source: strategy §6 step 6 (the timer is a property of the tap, not the session). |

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
    watch.js              project-local: long-running watchman for live bar-close polling
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
  watch/                  watchman runtime state (baseline.json, last-scan.json,
                          snapshots/<bar_time>.bundle.json, watches.json, alerts.jsonl)
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
    session: {
      label, timestamp_et, is_weekend, is_market_closed,
      in_ny_open_window, in_killzone, in_killzone_detail,
      replay: { active, autoplay, current_date }      replay state at the moment of capture; non-active when chart shows live data
    }
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
                                                                  doji_count_last_5, last_bar }
                                                          last_bar shape is identical to gates.pillar3.last_bar but
                                                          for the most-recent bar at that specific TF — used to
                                                          evaluate confirmation closes on 1m / 5m / 15m per §5.
                                                          m5 + m15 are the strategy-aligned TFs per §7 step 3.
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

**Polling mode (`--pillar3-only`).** Lightweight bundle for live bar-close polling (the strategy's confirmation discipline at §5: "1m/5m candle close"). Skips the multi-TF chart-switching loop, pine.lines, pine.tables, and indicator data-window values; keeps pine.boxes (verbose for FVG direction), pine.labels (verbose for structure-point x-index), bars, quote, and ALL gates that are computable from current-TF data. Returns in ~0.2s (vs ~13s for full `tv analyze`); bundle ~25KB compact. `gates.pillar2.m5` and `gates.pillar2.m15` are `null` in this mode because they require `bars_by_tf`; the watchman / polling consumer should rely on `gates.pillar3.*`, `gates.pillar1.session_levels.*`, `gates.session.*`, and current-TF Pine data.

**Baseline reuse (`--baseline <path>`).** Loads a previously-captured full bundle and uses its `bars_by_tf` + `pine_by_tf` instead of re-running the multi-TF chart sweep. Strategy §2.4 explicitly allows reusing HTF context intraday ("HTF gives a macro direction, but immediate trades are decided by how NY reacts to overnight levels"); HTF bias doesn't change minute-to-minute. Pairs with `--pillar3-only` for the watchman pattern:

```
# Slow cadence (every 5–15 min, or session boundary):
./bin/tv analyze --out state/baseline.json                # ~13s, full multi-TF capture

# Fast cadence (every 1m / 5m bar close):
./bin/tv analyze --pillar3-only \
                 --baseline state/baseline.json \
                 --out state/last-scan.json               # ~0.2s, fresh LTF + cached HTF

# Candidate escalation (when watchman detects something):
./bin/tv analyze --baseline state/baseline.json \
                 --out state/last-analyze.json            # ~0.2s, full bundle shape for LLM
```

The merged bundle has the same shape as a full `tv analyze` plus an additional `baseline_meta` field: `{path, captured_at, age_seconds}`. The slash command and harness work unchanged. Consumers should refresh the baseline when `baseline_meta.age_seconds > 900` (15 min) — HTF context older than that becomes stale.

The slash command body (`.claude/commands/analyze.md`) contains the ICT vocabulary, the behavioral rules (cite-or-reject, no arithmetic, prose-first, confidence enum), and the trailing JSON template. Read that file when invoked, not this one.

## The `watch` recipe (live bar-close polling)

`./bin/tv watch` is a long-running watchman that implements the strategy's confirmation cadence (`trading-strategy-2026.md §5`, §6 step 6; `entry-models.md` "Entry Confirmation (1m/5m)"). It captures an initial baseline, then on each tick runs `tv analyze --pillar3-only --baseline` (~0.2s) and runs a **tap/confirmation/invalidation state machine** per FVG zone.

**State machine.** Strategy §6 step 6 is a timer rule: *"Price taps your chosen PD array. Within 10–15 minutes, you get a strong 1m/5m close in your direction."* The watchman encodes that as three alert kinds:

1. **`fvg_tap`** — first bar with `body_ratio >= --min-body-ratio` (default 0.5) that closes inside an FVG zone, while context gates pass. Opens a new watch keyed by `(study, zone_high, zone_low)`; arms a `--window-seconds` timer (default 900 = 15 min).
2. **`fvg_confirmation`** — within the window, a subsequent bar with `body_ratio >= --confirmation-body-ratio` (default 0.6) closes. The watch is closed. The alert payload includes the original tap (with its own frozen snapshot path) so the LLM has full context for grading.
3. **`fvg_invalidation`** — `--window-seconds` elapse with no confirmation. The watch is closed. Citations resolve into the tap snapshot, not the current scan.

The state machine intentionally does NOT classify MSS vs Trend vs Inversion or check confirmation direction against FVG direction — those decisions are in "Known gaps" (interpretive, deferred to the LLM via `/analyze`). The watchman fires *candidate events*; `/analyze` grades them.

**Flags.**
- `--poll <sec>` — tick interval (default 10).
- `--baseline-ttl <sec>` — refresh baseline when older than N seconds (default 900). Strategy §2.4 lets HTF context be reused intraday.
- `--min-body-ratio <0..1>` — minimum body ratio for a new TAP (default 0.5).
- `--confirmation-body-ratio <0..1>` — minimum body ratio for a CONFIRMATION close (default 0.6; stricter than tap because confirmation should show displacement).
- `--window-seconds <sec>` — watch window length (default 900 = 15 min; strategy §6 upper bound).

**Context gates (all default ON, opt-out flags).** Strategy §2.2/§2.3 + §3 + §7 step 3: scan during sessions, with clean price quality, with the market actually open. The gates filter *which bars trigger alerts*; the loop keeps polling either way.
- `--allow-outside-killzone` — turn off the killzone filter. Default off: alerts only emit when `gates.session.in_killzone` is `true` (London Open, NY AM, NY PM).
- `--allow-poor-quality` — turn off the price-quality filter. Default off: alerts suppressed when `gates.pillar2.m5.candle_quality_heuristic` or `m15.candle_quality_heuristic` is `"poor"`.
- `--allow-market-closed` — turn off the market-closed filter. Default off: alerts suppressed when `gates.session.is_market_closed` is `true` (CME futures schedule).

Skips are logged to stderr (`[watch] tick N bar=... skipped: <reason>`) but never written to `alerts.jsonl`.

**Context gates apply to NEW TAPS only.** Once a watch is armed, the timer keeps running through session boundaries — `--allow-outside-killzone` etc. don't affect existing-watch evaluation. This matches strategy §6: confirmation timing is intrinsic to the setup, not the session clock.

**State files.** All under `state/watch/` (gitignored):
- `baseline.json` — most recent full `tv analyze` bundle.
- `last-scan.json` — most recent `--pillar3-only --baseline` scan. **Rolling** — NOT a valid citation target.
- `snapshots/<bar_time>.bundle.json` — frozen per-alert bundle. Each emitted alert pins to one of these via its `bundle_path`; cite paths resolve into the snapshot, not the rolling scan.
- `watches.json` — open watches (schema_version 1). Reloaded on start so the watchman survives restart with armed watches intact.
- `alerts.jsonl` — append-only JSON-line log of every emitted alert.

**Citation discipline.** Every emitted alert carries:
- `bundle_path` — absolute path to the frozen snapshot bundle for that bar.
- `cites.<field>` — JSON path inside that snapshot. Each path must resolve to the exact emitted numeric value.

Hard constraint #6 applies to watchman output the same way it applies to `/analyze` output. The per-alert snapshot pattern is required because the rolling `last-scan.json` rotates every tick — citing into it directly would mean cite paths drift to newer values within seconds of emission.

## Status

- **Scaffolding pushed.** README + .gitignore on `main`. CLI vendored, port locked, `analyze` command in place, slash command in place, research and strategy saved.
- **Research bound.** Hard constraints 5–10 cite the research files as authority. Future design changes must do the same.
- **Strategy bound.** Hard constraint #11 makes `docs/strategy/*.md` the authoritative spec for trade framing. `/analyze` mirrors the 7-step checklist. A+ examples for all three entry models are embedded.
- **Harness operational.** `npm run smoke:fixtures` runs schema + citation checks across every fixture. Verifier mechanically enforces constraint #6.
- **Gates emitting (richer).** `tv analyze` now returns a `gates` object covering: clock-based session, price-in-box checks, **full session liquidity map (PDH/PDL/AS_H/AS_L/LO_H/LO_L/NYAM_H/NYAM_L with taken/untaken)**, **most-recent ICT swing structure points (ST/IT/LT × HH/HL/LH/LL) ordered by Pine x-index**, **FVG counts classified by direction (bullish_fvg / bullish_ifvg / bearish_fvg / bearish_ifvg) via bgColor**, **bias-label scan** (auto-populates if any indicator publishes /bias/i text), **single-bar last_bar confirmation facts**, plus the original range / candle-quality stats. LLM no longer has to compute any of these.
- **Multi-TF bundle.** `bars_by_tf` and `pine_by_tf` provide Daily/4H/1H/15m/5m/1m bar summaries and trimmed Pine surfaces (boxes + labels for tracked studies). Captured via chart-switching with original-TF restore.
- **File output.** `./bin/tv analyze --out <path>` for bundles too large to pipe via stdout.
- **Watchman shipped.** `./bin/tv watch` runs the strategy's live polling cadence: full baseline every 15min, `--pillar3-only --baseline` scan per tick (~0.2s), JSON-line alert emitted when a bar closes inside an FVG with a clear body. Deliberately direction-agnostic (model classification stays in the LLM, per the "Known gaps" list).
- **Context-gated watchman.** Alerts now suppressed unless `gates.session.in_killzone` is true, `gates.session.is_market_closed` is false, and neither `gates.pillar2.m5/m15.candle_quality_heuristic` is `"poor"`. Each gate is opt-out via a flag (`--allow-outside-killzone`, `--allow-poor-quality`, `--allow-market-closed`). Strategy basis: §2.2/§2.3 (sessions create liquidity), §3 + §7 step 3 (stand aside when price quality is bad).
- **Watchman state machine.** Replaces the single `bar_close_in_fvg` event with a tap/confirmation/invalidation lifecycle per FVG zone. Implements strategy §6 step 6's 10–15 min timer rule. Each zone is keyed by `(study, high, low)` so the identifier is stable across snapshots even when zone indices shift. Watches persist to `state/watch/watches.json` and survive restart. Context gates apply to TAP creation only; existing watches keep ticking through session boundaries.

## Pending implementation

### Done so far

- Restructure `/analyze` around the 3-pillar framework, mirroring `trading-strategy-2026.md §7`.
- Three A+ canonical examples (MSS / Trend / Inversion) embedded as `<example>` blocks in the slash command. *Source: [docs/research/ai-consistency.md](docs/research/ai-consistency.md) — 72%→90% accuracy lift from Tool Use Examples.*
- Citation verifier (`scripts/verify-citations.js`) enforces constraint #6 mechanically against any paired `(analysis, bundle)` input.
- Minimal verification harness (`scripts/smoke-fixtures.js`, `npm run smoke:fixtures`) — schema + citation regression across every fixture in `tests/fixtures/`.
- Seed fixture (`tests/fixtures/001-current.*`) with hand-graded expected analysis from a 2026-05-15 NY-PM MNQ snapshot.
- **Live watchman (`tv watch`)** — `cli/commands/watch.js`. Loops forever: refreshes baseline every `--baseline-ttl` seconds, runs `tv analyze --pillar3-only --baseline` per tick, emits a `bar_close_in_fvg` JSON-line alert when a new bar closes inside an FVG with body_ratio >= `--min-body-ratio`. Citation paths included on every emitted number. Direction- and model-agnostic by design (the "Known gaps" list keeps model identification in the LLM). *Source: [docs/strategy/trading-strategy-2026.md](docs/strategy/trading-strategy-2026.md) §5 + §7 step 6 + [docs/strategy/entry-models.md](docs/strategy/entry-models.md) "Entry Confirmation (1m/5m)".*
- **Context gates on watchman.** `shouldSkipByContext` in `cli/commands/watch.js` suppresses alert emission unless: (a) `gates.session.is_market_closed === false`, (b) `gates.session.in_killzone === true`, (c) neither `gates.pillar2.m5.candle_quality_heuristic` nor `m15.candle_quality_heuristic` is `"poor"`. All three gates opt-out via flags (`--allow-market-closed`, `--allow-outside-killzone`, `--allow-poor-quality`). Skips logged to stderr; never written to `alerts.jsonl`. *Source: [docs/strategy/trading-strategy-2026.md](docs/strategy/trading-strategy-2026.md) §2.2/§2.3 (sessions create liquidity) + §3 + §7 step 3 (stand aside when price quality is bad).*
- **Watchman state machine.** `cli/commands/watch.js` now runs a tap/confirmation/invalidation lifecycle per FVG zone, keyed by `(study, zone_high, zone_low)`. Three alert kinds: `fvg_tap` (new watch armed; body >= `--min-body-ratio`, default 0.5), `fvg_confirmation` (strong-bodied close within `--window-seconds`, default 900; body >= `--confirmation-body-ratio`, default 0.6), `fvg_invalidation` (window expired without confirmation). State persists to `state/watch/watches.json` and survives restart. Direction match and entry-model classification stay in the LLM (per "Known gaps"). *Source: [docs/strategy/trading-strategy-2026.md](docs/strategy/trading-strategy-2026.md) §5 + §6 step 6 (the 10–15 min timer rule); [docs/strategy/entry-models.md](docs/strategy/entry-models.md) confirmation discipline across all three models.*
- **Deterministic gates in `tv analyze` (extended).** Top-level `gates` object emitted by `cli/commands/analyze.js`. Coverage:
  - `gates.session.*` — clock-based session label + booleans (NY open window, killzone status, weekend, market-closed including the Fri 17:00 ET → Sun 18:00 ET CME pause and the daily 17:00–18:00 ET settlement break) + replay state at the moment of capture.
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

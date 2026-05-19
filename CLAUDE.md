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
| 2026-05-18 | Confirmation requires proximity to FVG zone, not just body strength | Initial state-machine implementation fired `fvg_confirmation` on any strong-bodied close within the window — even bars 100+ ticks from the zone. Strategy text anchors confirmation TO the zone ("holds above/within the FVG and pushes away" / "closes back up from that zone"). Default proximity is 1.0× zone height (inside or one zone-width outside); tunable via `--confirmation-proximity`. |
| 2026-05-18 | Loop evaluates confirmation BEFORE invalidation | A bar arriving at the exact window boundary (e.g. 906s elapsed against a 900s window) should get its chance to confirm before the timer kills the watch. Original loop ran invalidation first and missed a valid confirmation candidate during live testing on PR #6's session. |
| 2026-05-18 | FVG direction tagged on inside_boxes and propagated through alerts | `gates.price_context.inside_boxes[].fvg_direction` (bullish_fvg / bullish_ifvg / bearish_fvg / bearish_ifvg / unknown) for FVG-study entries; classified from Nephew_Sam_'s bgColor. Each watch + alert carries `fvg.direction` so `/analyze` grading can distinguish a Trend retest (same-direction confirmation) from an Inversion candidate (opposite-direction confirmation through the zone). The watchman still does NOT filter on direction — that's the LLM's call — but the data is now there. |
| 2026-05-18 | Tap detection switched from close-inside to wick-overlap | Strategy's "tap" is wick-based: a bar that touches the FVG zone with its high or low, regardless of where the close lands. Verified live 2026-05-18 09:35 ET: a strong bearish bar wicked through 4 FVG zones cleanly but the close landed in the gap, so the watchman missed it entirely. The fix adds `gates.price_context.wick_tapped_boxes[]` (analyze.js) and switches `tv watch` tap detection to consume it. `inside_boxes` is kept for price-vs-zone discipline that uses `quote.last`. |
| 2026-05-18 | Watchman multi-TF: chart home = 1m, briefly flips to 5m every 5m | Strategy §5 says confirmation can come on either 1m OR 5m close. Single-TF watchman missed 1m setups when chart drifted to 5m (verified live). New design: chart enforced to 1m (home TF); every 5m boundary, `tv analyze --scan-tf 5` flips chart for ~2-3s, captures, restores. Cross-TF confirmation: any open watch evaluates against every new bar (1m or 5m). Watch keys gain TF prefix (`schema_version: 2`). Subprocess overhead: ~0.3s per tick + ~3s per 5m boundary. |
| 2026-05-18 | Drop time-based baseline refresh; use session-boundary auto-refresh + manual | Strategy §2.4: HTF context can be reused intraday. The original 15-min auto-refresh was wasteful (~15s chart flash every 15 min) and not strategy-justified. New policy: refresh at startup + 03:00 / 09:00 / 13:00 ET (user-specified, 30 min pre-killzone lead-in) + on-demand sentinel `touch state/watch/refresh-now`. Reduces chart disruption from ~4× per hour to ~3× per day. |
| 2026-05-18 | Tap detection covers FVG + iFVG + BPR (PD-array class) | Strategy §2.1: "Core tools: FVGs and BPRs/inversion FVGs". Earlier watchman filtered tap candidates to `/FVG/i` only, missing BPR taps. New filter `/FVG\|BPR\|Balanced Price Range/i`. iFVGs already covered (same FVG indicator). Alert kinds renamed `fvg_*` → `pd_array_*` to reflect the broader scope. Alert field renamed `fvg` → `pd_array` (still includes `direction` tag for FVG-family entries; BPR direction = unknown until we add a BPR bgColor map). |
| 2026-05-18 | Chart TF ownership: watchman snaps back to 1m if user changes it | Verified live during the 2026-05-18 NY AM session that the chart was on 5m for almost the entire session, causing 1m setups to be invisible to the watchman. Watchman now reads chart resolution every tick; if it's not 1m, calls `tv timeframe 1` and logs. Strategy doesn't have an opinion on this — pragmatic choice to make the watchman behave predictably. If user wants a different visual TF, use a separate chart tab. |
| 2026-05-18 | Multi-zone alert dedup | A bar that wicks N PD-array zones used to fire N separate `pd_array_tap` alerts. Verified live 2026-05-18 10:30 ET: a single bullish bar tapped both a bullish_fvg and a bullish_ifvg → 2 alerts on the same bar. Now ONE alert per (bar_time, tf, kind), with a `zones[]` array. Top-level cites cover bar fields; each zone carries its own zone-specific cites. Watch-level state is unchanged (still one watch per zone with its own 15-min timer). |
| 2026-05-18 | Snapshot retention 7 days | `state/watch/snapshots/` accumulates one file per tap; over weeks the dir would grow indefinitely. Cleanup runs at startup and at each session-boundary refresh; default 7 days, tunable via `--snapshot-retention-days`. Trade-off: alerts older than retention have dangling `bundle_path` (still readable text, just not re-citable). 7 days is plenty for "review last week's session". |
| 2026-05-18 | Watches.json schema migration in place | When `schema_version` bumps, old state used to be discarded — losing armed watches across a deploy. Now `loadWatches()` chains migration functions. First implemented: v1 → v2 (adds `tf: "1m"` to each watch, prefixes keys with `1m:`). Keeps in-flight 15-min setups alive across upgrades. |

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
    price_context:  { last, inside_boxes[], wick_tapped_boxes[] }
                                                 inside_boxes: close-inside (uses quote.last)
                                                 wick_tapped_boxes: bar.high/low overlap (used by tv watch tap detection)
                                                 each FVG-study entry tagged with fvg_direction (bullish_fvg/bullish_ifvg/bearish_fvg/bearish_ifvg)
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

`./bin/tv watch` is a long-running watchman that implements the strategy's confirmation cadence (`trading-strategy-2026.md §5`, §6 step 6; `entry-models.md` "Entry Confirmation (1m/5m)"). It runs a **tap/confirmation/invalidation state machine** per PD-array zone (FVG + iFVG + BPR — strategy §2.1 lists these as the same class of HTF tools).

**Chart ownership.** Chart is LOCKED to 1m. If you change it manually, the watchman snaps it back to 1m on the next tick and logs. Run a separate chart tab if you need a different visual TF.

**Multi-TF cadence.**
- **Every tick (default 10s):** capture pillar3-style scan at 1m (chart stays on 1m, ~0.5s).
- **Every 5m boundary** (when `bar.time % 300 == 0`): briefly switch chart to 5m via `tv analyze --scan-tf 5`, capture, switch back to 1m. ~2-3s of flashing per 5m boundary.

**HTF baseline refresh.** Strategy §2.4 explicitly allows HTF reuse intraday — no periodic auto-refresh. Baseline refreshes:
- At watchman startup (full 6-TF capture, ~15s once).
- At session boundaries — **03:00 / 09:00 / 13:00 ET** (London Open / NY AM prep / NY PM prep). Fires within 30s of each boundary, once per day.
- On demand via the sentinel `touch state/watch/refresh-now` (cleared by the watchman after refresh).

**State machine — three alert kinds:**

1. **`pd_array_tap`** — wick overlap with PD-array zone (`gates.price_context.wick_tapped_boxes[]` filtered to FVG / iFVG / BPR studies) + `body_ratio >= --min-body-ratio` (default 0.5), while context gates pass. Opens a watch keyed by `${tf}:${study}:${high}:${low}` (TF prefix separates 1m taps from 5m taps even when zone coords collide). Arms a `--window-seconds` timer (default 900 = 15 min).
2. **`pd_array_confirmation`** — within the window, ANY new bar (1m or 5m) with (a) `body_ratio >= --confirmation-body-ratio` (default 0.6), AND (b) close within `--confirmation-proximity` × zone-height (default 1.0). Cross-TF: a 1m close can confirm a 5m watch (matches entry-models.md MSS A+ example) and vice versa. Alert payload includes `watch_tf`, `confirm_tf`, `close_distance_from_zone`, plus the original tap (with its own frozen snapshot path).
3. **`pd_array_invalidation`** — `--window-seconds` elapse with no confirmation. Cites resolve in the tap snapshot, not the current scan.

The watchman does NOT classify MSS vs Trend vs Inversion or filter confirmations by direction-match — those stay in the LLM via `/analyze`. The `pd_array.direction` field (bullish_fvg / bullish_ifvg / bearish_fvg / bearish_ifvg / unknown for BPRs) is included on every alert so `/analyze` has the info without re-reading the bundle.

**Flags.**
- `--poll <sec>` — tick interval (default 10).
- `--min-body-ratio <0..1>` — minimum body ratio for a new TAP (default 0.5; strategy: "clear body, not a doji").
- `--confirmation-body-ratio <0..1>` — minimum body ratio for a CONFIRMATION close (default 0.6; stricter than tap to encode "shows displacement").
- `--window-seconds <sec>` — watch window length (default 900 = 15 min; strategy §6 upper bound).
- `--confirmation-proximity <mult>` — close-to-zone tolerance in multiples of zone height (default 1.0).

**Context gates (all default ON, opt-out flags). Apply to new TAPS only — armed watches keep ticking.**
- `--allow-outside-killzone` — turn off the killzone filter. Strategy §2.2/§2.3.
- `--allow-poor-quality` — turn off the m5/m15 candle-quality filter. Strategy §3 + §7 step 3.
- `--allow-market-closed` — turn off the CME-schedule filter.

Skips are logged to stderr but never written to `alerts.jsonl`.

**State files.** All under `state/watch/` (gitignored):
- `baseline.json` — full `tv analyze` bundle from startup / last session boundary.
- `last-scan.json` — most recent 1m scan. **Rolling** — NOT a valid citation target.
- `last-scan-5m.json` — most recent 5m scan (refreshed every 5m boundary). Also rolling.
- `snapshots/<bar_time>_<tf>.bundle.json` — frozen per-alert bundle. Each emitted alert pins to one via `bundle_path`; cite paths resolve into the snapshot.
- `watches.json` — open watches (`schema_version: 2`; keys include TF prefix). Reloaded on start so armed watches survive restart.
- `alerts.jsonl` — append-only JSON-line history.

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
- **Confirmation zone proximity.** A confirmation candle must close within `--confirmation-proximity` × zone-height of the FVG (default 1.0 — inside or up to one zone-width above/below). Without this, any strong bar within the 15-min window would fire `fvg_confirmation` even if it closed 100+ ticks away from the FVG. Strategy text anchors confirmation to the zone: "holds above/within the FVG and pushes away" (MSS) / "closes back up from that zone" (Inversion) / "closes above the FVG midpoint" (Trend). The signed `close_distance_from_zone` is emitted in the alert payload for downstream grading.
- **Multi-TF watchman + PD-array taps.** Watchman now polls 1m every tick and switches briefly to 5m at every 5m boundary (`--scan-tf 5` on `tv analyze`). Cross-TF confirmation: a 1m close can confirm a 5m watch and vice versa, per entry-models.md (e.g. MSS A+ uses a 5m FVG with a 1m confirmation candle). Tap detection covers FVG + iFVG + BPR (strategy §2.1: PD-array class). Alert kinds renamed `fvg_*` → `pd_array_*`. Chart is enforced to home TF (1m); if changed manually it snaps back next tick. Time-based baseline refresh dropped — HTF refreshes at startup + 03:00 / 09:00 / 13:00 ET + on-demand sentinel `touch state/watch/refresh-now`.
- **Operational hygiene.** (a) Multi-zone dedup: when a bar wicks N PD-array zones, ONE `pd_array_tap` alert fires carrying a `zones[]` array of N entries (was N separate alerts). Same for `pd_array_confirmation` when multiple watches confirm on the same bar. Top-level cites cover bar fields; each `zones[i]` carries its own zone-specific cites. (b) Snapshot retention: `state/watch/snapshots/` cleaned at startup + at each session-boundary refresh; default 7 days, tunable via `--snapshot-retention-days` (set to 0 to disable). (c) Schema migration: `watches.json` v1 → v2 now migrated in place (1m TF assumed for v1 keys) instead of discarded — armed watches survive deploys.
- **Briefing-first workflow.** Strategy §7 is sequential. The watchman now REQUIRES `state/watch/briefing.json` with `verdict=ready` before it fires alerts. `/analyze` writes the briefing (HTF bias, Pillar 2 verdict, NY reaction, side, priority_zones). User cadence: NY AM grades at 09:30 (stage 1, pre-reaction → `verdict=pending`) and 09:45 (stage 2 → `ready` / `stand_aside`); same at 13:00 / 13:45 for NY PM. Tap detection filters `wick_tapped_boxes` to only the briefing's priority_zones.
- **Preflight mode.** When briefing is missing or `verdict != ready`, watchman enters preflight: keeps running and scanning, suppresses all alert emission, nudges every `--preflight-nudge-seconds` (default 900 = 15min) via stderr + sentinel `state/watch/regrade-now`. When the briefing flips to ready, watchman transitions to full mode without restart (and vice versa).

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
- **Confirmation proximity check.** `classifyCloseProximity` in `cli/commands/watch.js` requires the confirmation candle's close to be within `--confirmation-proximity` × zone-height of the FVG (default 1.0 — inside zone or one zone-width above/below). Default value catches both "closed inside" and "pushed away just outside"; 0 forces strictly-inside; larger values widen the tolerance. The signed `close_distance_from_zone` is included in the alert payload (negative = inside, positive = outside-but-near). *Source: [docs/strategy/entry-models.md](docs/strategy/entry-models.md) — all three entry models anchor the confirmation candle to the FVG zone.*
- **Multi-TF watchman + PD-array taps.** Watchman locks chart to 1m as home TF; switches briefly to 5m via `tv analyze --scan-tf 5` at every 5m boundary (~2-3s flash). Cross-TF confirmation: any open watch evaluates against every new bar (1m or 5m). Tap detection covers FVG + iFVG + BPR (matches strategy §2.1 PD-array class). Alert kinds renamed `pd_array_tap` / `pd_array_confirmation` / `pd_array_invalidation`. Watch keys gain TF prefix (`schema_version: 2`). Chart TF enforcement: if user changes it manually, watchman snaps back next tick and logs. *Source: [docs/strategy/trading-strategy-2026.md](docs/strategy/trading-strategy-2026.md) §2.1 (PD-array class) + §5 (confirmation on 1m OR 5m); [docs/strategy/entry-models.md](docs/strategy/entry-models.md) MSS A+ (5m FVG + 1m confirmation candle).*
- **Baseline refresh policy.** Time-based 15-min auto-refresh dropped (strategy §2.4 allows HTF reuse intraday). New policy: refresh at startup + session boundaries 03:00 / 09:00 / 13:00 ET + on-demand sentinel `touch state/watch/refresh-now`. Reduces chart disruption from ~4× per hour to ~3× per day. `tv analyze --scan-tf <tf>` adds a one-shot TF switch+restore for the watchman's 5m cadence.*Source: [docs/strategy/trading-strategy-2026.md](docs/strategy/trading-strategy-2026.md) §2.4: "HTF gives a macro direction... HTF bias doesn't change minute-to-minute".*
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

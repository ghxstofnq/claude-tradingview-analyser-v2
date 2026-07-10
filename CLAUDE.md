# claude-tradingview-analyser — project rules for Claude

This file extends the user's global working agreement at `~/.claude/CLAUDE.md`. The global agreement still applies in full. This file documents project-specific decisions, constraints, and context.

## Design context

UI/design work follows two committed references at the repo root:
- [DESIGN.md](DESIGN.md) — the **Raycast** visual system (near-black surface ladder #07080a→#0d0d0d→#101111→#121212, hairline #242728 borders, no shadows, white CTA pill, saturated hues are status-only/never chrome, Inter + ss03). The active design language.
- [PRODUCT.md](PRODUCT.md) — strategic context (register = product, the solo ICT-trader user, purpose, personality, anti-references, 5 design principles).

**Before any UI / design / CSS / component / layout / typography work, read both, and use the Impeccable design skill** (installed globally; `Skill(skill="impeccable", args="<command> <target>")`, or run its detector directly: `node ~/.claude/skills/impeccable/scripts/detect.mjs --json <files>`). Verify rendered output with the headless harness in `design-harness/` (`node shoot.mjs` → PNG + computed-style probe) — not computer-use.

## Research basis

Behavioral rules in this project are grounded in two research passes, both saved in-repo:

- [docs/research/ai-consistency.md](docs/research/ai-consistency.md) — what produces consistent LLM behavior. Headline: "tool calling" is half-right; **grammar-constrained decoding against a schema** is the real mechanism. In a Claude Code session we approximate it via a tight slash-command schema, few-shot examples in `<example>` tags, self-check rules, and golden-set regression testing.
- [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — accuracy of LLM-driven chart analysis. Headline: literature is uniformly skeptical; LLMs underperform buy-and-hold in published benchmarks; **no peer-reviewed work on LLMs + ICT structures.** Hybrid (deterministic extraction → LLM synthesis) consistently beats LLM-only.

**Consult these before** designing a new analysis mode (tracker / scanner / backtester), changing `/analyze`, adding a new slash command that involves Claude reasoning over data, or modifying the hard constraints below. When proposing a behavioral change, cite the relevant research finding as authority.

## Strategy basis

This project implements the user's documented trading methodology — **Lanto's 3-pillar ICT framework**. The full specification lives in:

- [docs/strategy/README.md](docs/strategy/README.md) — spec index: the three pillars (Draw & Bias, Price Action Quality, Entry Model + Confirmation), the multi-timeframe framework (HTF Daily/4H/1H + Overnight Asia/London + NY open reaction), the **3-component bias grade** (1/3 no-trade · 2/3 B · 3/3 A+), and the 7-step checklist. Pillar detail: [daily-bias.md](docs/strategy/daily-bias.md), [price-action.md](docs/strategy/price-action.md), [confirmation.md](docs/strategy/confirmation.md), [risk-and-management.md](docs/strategy/risk-and-management.md). Bot-vs-spec gaps: [lanto-source-of-truth.md](docs/strategy/lanto-source-of-truth.md). **No trade unless all three pillars align.**
- [docs/strategy/entry-models.md](docs/strategy/entry-models.md) — the three entry models in detail: **MSS (reversal after liquidity grab)**, **Trend (continuation in direction of displacement)**, **Inversion (failed opposing PD array)**. Each with core components, A+ example, stop placement, and target logic.

**Consult these before** any strategy-related work: structuring analysis output, defining what counts as a setup, building the tracker / scanner / backtester, encoding grading logic, choosing what to read from the analyze JSON bundle, or proposing changes to `/analyze`. When proposing a strategy-related change, cite the relevant strategy file.

## Hard constraints

1. **Default backend is TradingView Desktop on CDP port 9225.** Since the 2026-06-11 desktop switch, TV Desktop (launched with `--remote-debugging-port=9225`) is the analysis target for everything — analysis, replay, Pine deploys, tape recording. Its CDP type is `'page'`; `packages/core/tab.js` + `connection.js` accept `'page'` or `'webview'`. The in-app TradingView `<webview>` (Electron debug port 9223, `app/renderer/src/TvChart.jsx`) is the user's personal display surface — the system must not drive it for analysis/replay/Pine. **Exception (2026-06-15, execution engine):** the execution engine drives the 9223 webview to place/modify/close orders — TradingView Paper, or Tradovate demo/live via its REST API — behind the confirmed-account gate; see constraint #2 and [docs/superpowers/specs/2026-06-15-execution-engine-design.md](docs/superpowers/specs/2026-06-15-execution-engine-design.md). Analysis/replay/Pine still run only against TV Desktop (9225). **Operational requirement: TV Desktop must be running with the debug flag**; if CDP 9225 doesn't answer, relaunch it: `osascript -e 'quit app "TradingView"'`, then `open -a TradingView --args --remote-debugging-port=9225`. Never invoke upstream `~/tradingview-mcp-ict` from this project — that copy targets 9222 and is used by other projects on this machine.
2. **CLI only — no MCP tools.** Do not use any `mcp__tradingview__*` tool when working in this project. Every TradingView interaction goes through `./bin/tv` (or directly `node ./cli/index.js`). **Exception (2026-06-15 execution engine; Tradovate added 2026-06-16):** order placement/modify/close runs from the Electron main process via a dedicated raw-CDP webview client (`app/main/execution/cdp-webview.js` → CDP 9223), NOT the CLI or MCP. Two broker adapters share that client: **TradingView Paper** (`tv-adapter.js` — POSTs to TV's trading endpoint from the page context; cookies ride along, the `alerts.js` REST pattern) and **Tradovate** (`tradovate-adapter.js` — REST with the sniffed Bearer token; demo and LIVE, i.e. the real-money path). Routing is fail-closed via `account-gate.js`: orders route only to the CONFIRMED account (matched on id + type + broker; any switch forces a deliberate confirm), live auto-fire stays boot-paused until a per-session resume, live is unroutable until a `liveHost` is configured, and always-on guardrails apply (valid stop · size within ±$50 · max-$/trade · daily-loss halt · chart/instrument-root mismatch block). Authority: [docs/superpowers/specs/2026-06-15-execution-engine-design.md](docs/superpowers/specs/2026-06-15-execution-engine-design.md). Everything else still goes through `./bin/tv`.
3. **No edits to other projects.** Do not modify `~/Documents/ai-trading-agent` or `~/tradingview-mcp-ict`. This project is fully self-contained.
4. **Local state only.** Project state lives under `./state/`. Never read or write `~/.tradingview-mcp/`. The two upstream commands that wrote there (`brief` and `session`) have been stripped from the vendored CLI; the corresponding core modules (`morning.js`, `paths.js`) deleted.
5. **Screenshots are for verifications and tests only.** `./bin/tv screenshot` exists but its output never feeds analysis. Do not include screenshots in the `analyze` bundle. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — multimodal LLMs can answer correctly while barely using the image; screenshots risk visual hallucination.*
6. **Cite-or-reject.** Every numeric price in any analysis output MUST be cited with the exact syntax `<price> (<json.path>)`, where the path is a real JSON accessor into the `tv analyze` bundle that resolves to the exact value cited. Examples: `29172.75 (quote.last)`, `29302.75 (pine.labels.studies[0].labels[0].price)`, `29307.25 (pine.boxes.studies[0].zones[2].high)`. Approximations, rounded prices, and prose-style parentheticals like `29172.75 (close)` are forbidden. The harness (`npm run smoke:fixtures` → `scripts/verify-citations.js`) mechanically enforces this rule against every paired fixture in `tests/fixtures/`. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — top documented failure mode is hallucinated levels; verifiable post-hoc with a string check.*
7. **No LLM arithmetic.** Stop distance, R:R, ATR, bar counts, range size, displacement magnitude — all computed in code and emitted in the JSON. Claude reads numbers, never produces one. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — LLM arithmetic error rises ~+14 percentage points with numerical magnitude; the cure is tool-use, not better prompting.*
8. **Prose first, JSON last.** Analyses reason in prose; emit one structured JSON block at the end. Do not force JSON during the reasoning itself. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — forcing JSON output during reasoning degrades accuracy 10–15%.*
9. **Grade enum only.** Use `A+ | B | no-trade` exclusively in any structured analysis output. No "high-conviction" / "very likely" / "strong setup" — these vocabularies are systematically overconfident. Emit `A+` only when ALL six elements align (HTF bias + overnight context + NY reaction + price quality `good` + entry model identified + confirmation `confirmed`). `B` if one element is weaker. `no-trade` if multiple elements are weak/missing OR no entry model is in play. *Sources: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md) — LLMs in finance show Expected Calibration Error 0.12–0.40; [docs/strategy/daily-bias.md](docs/strategy/daily-bias.md) §1 — strategy grading definition.*
10. **No backtesting on data Claude has seen.** When validating analyses on historical sessions, use post-cutoff dates or out-of-sample symbols. Frontier LLMs memorize prices and outcomes on widely-discussed pre-cutoff dates. *Source: [docs/research/ai-trading-analysis.md](docs/research/ai-trading-analysis.md).*
11. **Strategy authority — `docs/strategy/*.md` is the spec.** When interpreting setups, frame analyses, or define what counts as a trade, follow the 3-pillar framework and the three entry models (MSS / Trend / Inversion) exactly. Do not invent ICT concepts outside that scope or substitute generic TA. If the strategy is silent on a question, surface that gap rather than improvising.

## Architecture decisions

The dated decision changelog (50 entries, 2026-05-17 → 2026-07-03) moved to [docs/decisions-log.md](docs/decisions-log.md) (section "Architecture-decisions changelog migrated from CLAUDE.md"). New decisions go there directly — this file keeps only still-active operating rules:

- **Single setup brain (2026-06-12; guarded 2026-06-29).** The walker chain (`buildDeterministicPacketTruthFromInputs` in [app/main/bar-close.js](app/main/bar-close.js)) is the ONLY setup producer for live trading and production backtests; the per-bar LLM narrates its verdict. `cli/lib/setup-detector.js` (+ siblings) is offline/diagnostic only; `tests/single-setup-brain.test.js` fails if any `app/main/**` file imports it.
- **Pine deploy — the correct procedure (2026-06-21).** (1) `tv pine open "<script>"` and it must SUCCEED (retries 3×; proceeding past a failed open leaves the editor unlinked and spawns a duplicate saved script). (2) `tv pine set --file`. (3) Apply via the split-button dropdown's **"Update on chart"** (updates the study in place; plain Ctrl+Enter no-ops or duplicates). (4) `tv pine save`. (5) Verify by KEY presence, not value (new fields read `NaN` on pre-existing zones — grep the key, e.g. `c1o=`) and `getAllStudies()` count stays 1. Fallback: "Add to chart" then `tv indicator remove <old-id>`.
- **Deploy-drift guard.** Bump `CODE_REV` in [pine/ict-engine.pine](pine/ict-engine.pine) on EVERY change to that file; the parser pins `EXPECTED_CODE_REV` and live-check blocks with `pine_code_rev_mismatch` when the deployed copy drifts from the repo.
- **Same-candle confirmation is canonical (2026-07-03).** The `confirm_strict` emit (prior-bar tap + engulfing close) is parser-typed but DORMANT — it folded negative on the corpus and must not gate the chain without a fresh full-corpus fold.

## Repo

- Private GitHub repo: https://github.com/ghxstofnq/claude-tradingview-analyser
- Workflow: feature branches + PR. Never push directly to `main` after the bootstrap commit.
- Commits: Conventional Commits (`feat: / fix: / chore: / docs: / refactor: / test:`).
- Hooks: never bypass (`--no-verify` / `--no-gpg-sign` / `--force` / `--amend` forbidden unless explicitly asked).
- Co-author tag on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Workflow rules for Claude

- **Re-read before strategy/behavior changes.** Before any non-trivial behavioral or strategy change to `/analyze`, `tv analyze`, the live walker chain, or the gates, re-read: `docs/research/ai-consistency.md`, `docs/research/ai-trading-analysis.md`, and the strategy spec under `docs/strategy/` (start at `README.md`; entry detail in `entry-models.md`). Confirm the planned approach against the documents and call out any tensions before writing code. *User-imposed standing rule, 2026-05-17; wording refreshed 2026-06-29.*
- **Strategy authority (updated 2026-06-29).** Do **not** use or reference Lanto callout / alerted-trade-derived files as strategy authority. They are retired because they are easy to misunderstand. Use only the canonical strategy docs in `docs/strategy/` plus the vendored class transcripts in `docs/strategy/transcripts/`; any session expectation that was imported from those files must be re-derived from the allowed sources and/or explicitly user-approved before it is treated as oracle truth.
- **Run the harness before claiming a step is done.** `npm run smoke:fixtures` must pass before committing any change to `cli/commands/analyze.js`, `.claude/commands/analyze.md`, or `scripts/verify-citations.js`. If a change invalidates an existing fixture (e.g. by adding a required field), update the fixture and the schema check together — do not weaken the schema.
- **Cite every research / strategy claim.** When proposing a behavioral change, point at the exact section (file + heading) that supports it. "The research says…" without a citation is not acceptable.

## Layout

```
.claude/
  commands/
    analyze.md            /analyze slash command — includes ICT vocab and behavioral rules
app/
  electron-main.js        Electron entrypoint (exposes CDP 9223 for the execution webview)
  main/                   main process: sdk.js LLM turns, bar-close.js walker chain,
                          execution/ order engine (TV Paper + Tradovate adapters),
                          session-supervisor.js, backtest engine, prompts/ (kernel+phases+partials)
  renderer/               dashboard UI (React + Vite; Raycast design system per DESIGN.md)
bin/
  tv                      shell wrapper around ./cli/index.js
cli/
  index.js                vendored entrypoint; registers all commands
  router.js               vendored router
  commands/
    (vendored upstream commands)
    analyze.js            project-local: bundles JSON for /analyze
cmd/
  tv-dash/main.go         Go TUI source for ./bin/tv dash (bubbletea + lipgloss)
design-harness/           headless render + computed-style probe for UI verification
docs/
  research/
    ai-consistency.md            evidence base for consistency rules
    ai-trading-analysis.md       evidence base for accuracy rules
  strategy/
    README.md                    spec index + 3-pillar overview + grade rule + 7-step checklist
    daily-bias.md                Pillar 1 — draw & bias (HTF/overnight/NY-open, grade count, SMT)
    price-action.md              Pillar 2 — price quality (displacement, gap size, consolidation)
    entry-models.md              MSS / Trend / Inversion entry models in detail (authoritative)
    confirmation.md              1m candle-close confirmation discipline
    risk-and-management.md       sizing table + TP/management styles + structural stops
    lanto-source-of-truth.md     verbatim Lanto rules + bot fidelity audit
    transcripts/                 the 5 source class transcripts
packages/
  core/                   vendored @tvmcp/core; CDP_PORT = 9225
pine/
  ict-engine.pine         ICT Engine V5 source (evidence schema 4; deploy via tv pine, bump CODE_REV)
package.json              workspaces, scripts (tv / smoke / smoke:fixtures), sole runtime dep
scripts/
  verify-citations.js     enforces constraint #6 on a paired (analysis, bundle)
  smoke-fixtures.js       schema + citation regression across all fixtures
state/                    gitignored; created on demand
  screenshots/            verification / tests only — NOT analysis input
  memory/                 cross-day persistent memory (Hermes-inspired; PR 2026-05-26)
    USER.md               trader profile (preferences, schedule, instruments traded)
    MEMORY.md             cross-day market lessons + agent observations
  session/<YYYY-MM-DD>/   per-day folder; holds bar-close-events.jsonl (detector log)
    <session>/            one folder per session — ny-am / ny-pm / london — each with:
                          pillar1.md, pillar2.md, open-reaction.md, ltf-bias.md,
                          bars.jsonl, bars-5m.jsonl, setups.jsonl, summary.md
  backtest/               replay runs + recorded corpus (state/backtest/<run-id>/<session>/)
  trades/                 execution engine order + fill records
tests/
  fixtures/               regression baselines (NNN-label.bundle.json + .expected.md)
    README.md             how to add and grade fixtures
```

## The `analyze` recipe (what `/analyze` does)

`./bin/tv analyze` returns one JSON object. The single data source is the **ICT Engine** indicator (migrated 2026-05-21 — [docs/plans/2026-05-21-ict-engine-migration.md](docs/plans/2026-05-21-ict-engine-migration.md)):

**Brief digest.** When `--pair` is set, the bundle gains a top-level `brief_digest.symbols.<sym>.{htf, pillar1, pillar2, ltf_context}` block (~7-15KB per symbol). This is the field the brief turn reads — slim enough to fit in Read's first chunk, unlike the full pair block (304KB total, unreachable past chars 140k). The digest is computed in `cli/lib/brief-digest.js` and ranks top FVGs/BPRs/structures by `(state=fresh DESC, took_liq DESC, disp_score DESC)` per TF. Each ranked entry carries a `cite` field that resolves through `engine_by_tf.<tf>.fvgs[N]` / `.bprs[N]` / `.structures[N]`.

```
{
  timestamp:     ISO-8601 string
  chart:         { symbol, resolution, chartType, studies[] }
  visible_range: { from, to } (unix seconds)
  quote:         { last, ohlc, volume, time, ... }
  bars:          OHLCV summary + last_5_bars at the chart's current TF
  bars_by_tf:    { daily, h4, h1, m15, m5, m1 }   per-TF OHLCV summaries (incl. range, change_pct)
  indicators:    [{ name, values: {...} }]        data-window values of visible studies
  engine:        parsed ICT Engine evidence table at the current TF —
                 { schema, schema_supported, meta, levels[], sweeps[],
                   fvgs[], bprs[], swings[], structures[], pools[], quality }
  engine_by_tf:  { daily, h4, h1, m15, m5, m1 }   the same parsed object per TF;
                                                  HTF FVGs + HTF structure live here
  gates: {
    session: { label, timestamp_et, day_of_week, is_weekend, is_market_closed,
               in_ny_open_window, in_killzone, in_killzone_detail, phase,
               minutes_into_phase, next_killzone_label,
               seconds_to_next_killzone, replay }      clock-based (computeSessionGate)
    engine:  {                                         engine-derived (computeEngineGates)
      meta:          { schema, schema_supported, tf, emit_ny, symbol,
                       emit_ms, emit_age_seconds, stale, engine_session }
      price_context: { last, inside_fvgs[], inside_bprs[],
                       nearest_opposing_fvg_above, nearest_opposing_fvg_below }
                                                each zone carries distance_to_top/bottom/ce
      pillar1:       { session_levels:{PWH,PWL,PDH,PDL,AS_H,AS_L,LO_H,LO_L,NYAM_H,NYAM_L},
                       untaken_sell_side_below[], untaken_buy_side_above[], sweeps[],
                       liquidity_pools[], untaken_pools_above[], untaken_pools_below[] }
      pillar2:       { current_tf, m5, m15 }    each the engine quality row
                                                { range_3h, range_quality, displacement,
                                                  candle, atr_14, atr_17, session }
                                                displacement: clean|acceptable|weak|na
      pillar3:       { fvgs[], fvgs_ranked[], bprs[], swings:{internal[],swing[]},
                       structure_events[], structures_by_tier:{swing[],internal[]},
                       failure_swings[], most_recent_structure, fvg_summary }
      confirmation:  { last_bar, last_bar_age_seconds, m5_last_bar, m15_last_bar }
                                                single-bar facts (bar-derived, cli/lib/last-bar.js)
    }
  }
  candidates: {                                          detector output (cli/lib/setup-detector.js) — diagnostic-only, NOT a live signal
    best_candidate: { model, side, entry, stop, stop_options[], tp1, tp2,
                      grade_proposed, grade_capped, components, rationale, tradable } | null,
    rejections: [{ model, side, reason }],
    rejection_summary: string | null,                    set when best_candidate is null
    meta: { detector_version, leader, timestamp_ms, bar_close_ms }
  }
}
```

Gates are pre-computed: `computeSessionGate` in `cli/commands/analyze.js` (clock-based), `computeEngineGates` in `cli/lib/compute-engine-gates.js` (engine-derived). The engine table is parsed by `cli/lib/ict-engine-parser.js`. The LLM consumes gates directly and does not recompute. See "Workflow rules for Claude" above for the discipline.

**Key-naming note.** Engine session-level keys use underscore form (`AS_H` from the engine's `AS.H` level) so they're citation-safe under the verifier's path syntax; each entry keeps its original `name`. **Market-structure swing labels (`HH/HL/LH/LL`) use the textbook convention — the second letter is the pivot type (High/Low), the first is Higher/Lower vs the prior same-type pivot, so `HL` is a Higher Low and `LH` a Lower High.** Each engine swing also carries an explicit `is_high` boolean — trust it over letter-parsing. See `.claude/commands/analyze.md` ICT vocabulary.

**File output.** Pass `--out <path>` to `tv analyze` to write the bundle to a file instead of stdout (mandatory for `/analyze` invocations because the multi-TF bundle exceeds Bash output truncation limits). The slash command writes to `state/last-analyze.json` — a full multi-TF sweep, or a fast `--pillar3-only --baseline` reuse — then `Read`s that file; see `.claude/commands/analyze.md` "How to run" for which capture runs when.

**Polling mode (`--pillar3-only`).** Lightweight bundle for live bar-close polling (strategy §5: "1m/5m candle close"). Skips the multi-TF chart-switching sweep; still captures the current-TF `engine` table, `bars`, `quote`, indicator values, and the full `gates` (`session` + `engine`). Returns in ~0.2s vs ~13s for a full sweep. `engine_by_tf` and `bars_by_tf` are `null` in this mode, so `gates.engine.pillar2.m5/m15` and `gates.engine.confirmation.m5_last_bar/m15_last_bar` are `null` too — the polling consumer relies on `gates.engine.*` (current TF) and `gates.session.*`.

**Baseline reuse (`--baseline <path>`).** Loads a previously-captured full bundle and uses its `bars_by_tf` + `engine_by_tf` instead of re-running the multi-TF chart sweep. Strategy §2.4 explicitly allows reusing HTF context intraday ("HTF gives a macro direction, but immediate trades are decided by how NY reacts to overnight levels"); HTF bias doesn't change minute-to-minute. Pair it with `--pillar3-only` for live bar-close polling or diagnostic/manual captures:

```
# Slow cadence (every 5–15 min, or session boundary):
./bin/tv analyze --out state/baseline.json                # ~13s, full multi-TF capture

# Fast cadence (every 1m / 5m bar close):
./bin/tv analyze --pillar3-only \
                 --baseline state/baseline.json \
                 --out state/last-scan.json               # ~0.2s, fresh LTF + cached HTF

# Full diagnostic capture when a manual/LLM read needs the complete bundle shape:
./bin/tv analyze --baseline state/baseline.json \
                 --out state/last-analyze.json            # ~0.2s, full bundle shape for LLM
```

The merged bundle has the same shape as a full `tv analyze` plus an additional `baseline_meta` field: `{path, captured_at, age_seconds}`. The slash command and harness work unchanged. Consumers should refresh the baseline when `baseline_meta.age_seconds > 900` (15 min) — HTF context older than that becomes stale.

The slash command body (`.claude/commands/analyze.md`) contains the ICT vocabulary, the behavioral rules (cite-or-reject, no arithmetic, prose-first, confidence enum), and the trailing JSON template. Read that file when invoked, not this one.

## The live session recipe (walker-first, LLM narrates)

**Current architecture (updated 2026-06-29):** the deterministic walker chain is the single setup brain for live trading and production backtests. The LLM does **not** decide whether a live setup exists; it narrates the walker verdict, explains context, writes briefs/wraps, and can still answer manual `/analyze` questions.

The flow:

1. **Session supervisor:** `app/main/session-supervisor.js` auto-arms during London / NY AM / NY PM windows, performs readiness checks, and restarts stale bar-close detection. Manual detector stops suppress re-arm for the remainder of that session.
2. **Bar-close capture:** `./bin/tv analyze --pillar3-only --baseline ...` captures fresh LTF state against the TV Desktop CDP backend. The full multi-TF baseline is refreshed on a slower cadence / session boundary.
3. **Evidence bridge + walker chain:** `app/main/bar-close.js` builds detector inputs, bridges ICT Engine evidence into walker-ready shapes, then folds `buildDeterministicPacketTruthFromInputs` over persistent walker state. This is the only production setup producer.
4. **Narration / surfaces:** the per-bar LLM turn receives compact walker truth and writes narration only on packet, stage change, or 5m close. Session folders under `state/session/<YYYY-MM-DD>/<session>/` remain the durable live record: `pillar1.md`, `pillar2.md`, `open-reaction.md`, `ltf-bias.md`, `bars.jsonl`, `bars-5m.jsonl`, `setups.jsonl`, `summary.md`, plus walker inputs/state.

Manual `/analyze` remains useful for one-shot grading and diagnostic reads, but `bundle.candidates` from `cli/lib/setup-detector.js` is diagnostic-only and must not be treated as a live signal.

## The `dash` recipe (live oversight TUI)

`./bin/tv dash` is a terminal UI that gives you live visibility into everything the system is doing. Run it in a separate terminal alongside the running app / session supervisor when you want disk-level live oversight.

What it shows, refreshing every 2s:
- **Detector status** — running/stale/not-running, pid, last heartbeat age, current state (`sleeping_to_boundary` / `polling_for_close` / `emitted`), bar being tracked, last emit time.
- **Recent bar closes** — last ~6 events from `state/session/<today>/bar-close-events.jsonl` with O/H/L/C, plus a `[5m_close]` flag when applicable.
- **Session state files** — for the active session folder (`ny-am` / `ny-pm` / `london`, derived from the current phase): which of `pillar1.md`, `pillar2.md`, `open-reaction.md`, `ltf-bias.md`, `summary.md`, `bars.jsonl`, `setups.jsonl` exist, when they were last modified, and the key verdict line from each markdown.
- **Recent setups** — last ~4 entries from `setups.jsonl`, color-coded by status (green confirmed, yellow candidate, red invalidated).
- **Phase + timing banner** — current ET, phase, minutes into phase, countdown to next killzone.

Press `q` / `Esc` / `Ctrl-C` to quit. Built with **Go + [bubbletea](https://github.com/charmbracelet/bubbletea) + [lipgloss](https://github.com/charmbracelet/lipgloss)** — the same Charm stack that powers lazygit, k9s, gh-dash, gum, etc. Reads disk only; no CDP calls (so it never disturbs the chart).

**Setup (one-time):**
```bash
brew install go        # if you don't have Go 1.22+
make dash              # compiles bin/tv-dash from cmd/tv-dash/
```

After that, `./bin/tv dash` works from any session — the Node CLI shells out to `bin/tv-dash`. Source lives at [cmd/tv-dash/main.go](cmd/tv-dash/main.go).

The detector (`./bin/tv stream bar-close`) writes a heartbeat to `state/session/detector-heartbeat.json` on every poll iteration AND persists every emitted event to `state/session/<today>/bar-close-events.jsonl` (in addition to stdout). That's what the dashboard reads.

## The `/judge` recipe (semantic regression)

`/judge <id|all>` is the semantic half of fixture regression testing — `npm run smoke:fixtures` checks bundle schema + citations deterministically; `/judge` checks whether a fresh read of a bundle still reaches the same verdict as the hand-graded `expected.md`. It is a **slash command, not a script** (CLAUDE.md bans the Anthropic API in scripts): the LLM re-grades the bundle blind, then emits categorical per-dimension verdicts (`agree` / `partial` / `disagree`) to `tests/fixtures/NNN-label.judge.json` (gitignored — regenerated each run); `npm run judge:report` tallies them into agreement percentages (constraint #7 — the LLM never produces the score). Treat `/judge` as an interpretive adjunct to deterministic gates (`npm run test`, `npm run smoke:fixtures`, replay/tape tests), not as the live setup source. See `.claude/commands/judge.md`.

## Current status

- **Source of truth:** strategy docs + transcripts only; Lanto callout / alerted-trade-derived files are retired as authority.
- **Backend:** TV Desktop on CDP 9225 is the analysis/replay/Pine/tape backend. The embedded webview is a personal display surface except for the guarded execution-engine path (TV Paper / Tradovate — constraint #2).
- **Engine:** `ICT Engine V5` ([pine/ict-engine.pine](pine/ict-engine.pine)) emitting evidence schema 4; the parser accepts schemas {1,2,3,4} and pins `EXPECTED_CODE_REV`, so live-check blocks on deploy drift.
- **Setup brain:** deterministic walker chain is the only live + production-backtest setup producer. Manual `/analyze` detector candidates are diagnostic-only.
- **Prompting:** LLM turns consume deterministic evidence, cite JSON paths, do no arithmetic, and use `A+ | B | no-trade` only.
- **Verification:** use `npm run test` as the broad gate and targeted commands (`npm run smoke:fixtures`, replay/tape tests, `node --test <files>`) for touched areas.

## Known active gaps / cautions

- Some historical fixtures and plans may still encode retired callout-derived expectations. Treat those as `needs_gxofnq_review` unless the expectation has been re-derived from allowed docs/transcripts/chart evidence or explicitly user-approved.
- The full decision changelog lives in [docs/decisions-log.md](docs/decisions-log.md); older entries there may be superseded — the hard constraints and Current status here win.
- Keep `CLAUDE.md` as active operating guidance plus high-signal changelog only; move long completed-plan detail into dated docs when it starts to conflict with current behavior.

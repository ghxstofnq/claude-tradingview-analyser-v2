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
| 2026-05-19 | LLM-driven session replaces the watchman | The deterministic watchman (`tv watch`) was a candidate-flagger that fired on bar+FVG+body conditions. Replaced with: bar-close detector (cheap) + Claude Code session + phase-aware `/analyze` that runs on every 1m + 5m close, accumulates `state/session/<date>/*` notes, and reasons across the whole session. Strategy §7 is sequential — making Claude the engine that walks the checklist end-to-end is closer to that than a separate trigger layer. Plan in [docs/plans/llm-driven-session.md](docs/plans/llm-driven-session.md). |
| 2026-05-18 | Watchman context-gating defaults ON, opt-out via flags | Filter alerts by killzone presence, market-open state, and m5/m15 candle quality. Strategy §2.2/§2.3 (liquidity moves during sessions) + §3 (stand aside when price quality is bad). Opt-out (rather than opt-in) means the conservative default matches the strategy. Direction-aware filtering (bullish-bar-into-bullish-FVG etc.) remains deferred — that's the entry-model classification step. |
| 2026-05-18 | Tap detection wick-overlap + FVG direction tagging (carried forward) | Strategy's "tap" is wick-based, not close-inside. `gates.price_context.wick_tapped_boxes[]` lists FVG/iFVG/BPR zones whose high/low overlaps the bar's wick; `inside_boxes[]` is kept for close-based price-vs-zone checks using `quote.last`. Each FVG-study entry carries `fvg_direction` (bullish_fvg/bullish_ifvg/bearish_fvg/bearish_ifvg) from Nephew_Sam_'s bgColor. Verified 2026-05-18 09:35 ET: a bearish bar wicked through 4 FVG zones cleanly but closed in the gap — close-inside would have missed it. Watchman code that consumed these gates was deleted on 2026-05-19, but the gates themselves remain for `/analyze`. |
| 2026-05-20 | Per-session folders: `state/session/<date>/{ny-am,ny-pm,london}/` | Each session (NY AM / NY PM / optional London) gets its own folder holding that session's pillars, open-reaction, ltf-bias, setups, bars, and a `summary.md` wrap. Sessions never overwrite each other — AM, PM, and London grades all persist for later review. Replaces the flat day folder and the short-lived day-level `htf-summary.md` append log. `bar-close-events.jsonl` stays day-level (detector output). The dashboard shows the active session's folder, derived from `gates.session.phase`. |
| 2026-05-20 | Pillar 2 range threshold is per-symbol | `cli/lib/pillar2-thresholds.js` maps symbol → minimum acceptable range. Only the range threshold is price-scale dependent; body-ratio (0.6/0.3) is a normalised ratio and stays fixed. Uncalibrated symbols emit `range_acceptable: null` so the LLM judges the range manually rather than seeing a miscalibrated `false`. |
| 2026-05-21 | Migrate `tv analyze` to the ICT Engine indicator | One schema-versioned indicator replaces the four (FVG/iFVG, AMS, Killzones, BPR) as the data source. Strict superset — adds explicit sweep events, per-FVG displacement scoring, FVG lifecycle state, mechanical MSS/BOS detection — and uses the **textbook** HH/HL/LH/LL convention. Bundle gains `engine`, `engine_by_tf`, `gates.engine.*`. Pillar 2 quality is now the engine's ATR-relative `quality` row (retires `pillar2-thresholds.js`). Plan: [docs/plans/2026-05-21-ict-engine-migration.md](docs/plans/2026-05-21-ict-engine-migration.md). |
| 2026-05-26 | Full ICT Engine utilization — close the gap between what Pine emits and what we use | Audit against the indicator's Pine source surfaced six unused fields and one whole row type. Parser was silently dropping every `liquidity` row (equal-high/low pools — strategy §2.1's draw-target liquidity) and miscoercing the engine's Wilder `atr_14`/`atr_17` as strings. The bundle now exposes: `gates.engine.pillar1.{liquidity_pools, untaken_pools_above, untaken_pools_below}`; `pillar3.fvgs_ranked[]` pre-sorted by `(state=fresh, took_liq, disp_score)`; `pillar3.failure_swings[]` (pre-filtered `event=mss + validation=sweep` — ICT's failure-swing reversal); `pillar3.structures_by_tier:{swing,internal}` mirroring Pine's tier separation; `meta.{emit_age_seconds, stale, engine_session}` for staleness + clock cross-check; signed `distance_to_top/bottom/ce` on every in-zone FVG/BPR; `nearest_opposing_fvg_above/below`; and the previously-unparsed `size_quality`, `reaction_dir`, and `displacement=acceptable` enum value. Additive only — no existing citation paths renamed. |
| 2026-05-26 | Persistent memory layer (cross-day) | Adds `state/memory/{USER.md, MEMORY.md}` with frozen-snapshot injection at the top of the system prompt + an `mcp__tv__memory` tool (action × target, substring-match) exposed only to `chat`/`wrap`/`review` purposes. A new `review` purpose auto-fires after each session wrap (`onSuccessFn` hook in `scheduled-turn`) to extract durable lessons. The brief turn also injects a `<recent_sessions>` block with the last 5 days of summaries. Modeled on the Hermes Agent memory architecture — see [docs/research/hermes-memory-architecture.md](docs/research/hermes-memory-architecture.md) and [docs/plans/2026-05-26-persistent-memory-layer.md](docs/plans/2026-05-26-persistent-memory-layer.md). Closes the cross-day gap: until this PR Claude restarted blank every morning. |
| 2026-05-26 | Observability + guardrails (cost insights, error classifier, memory guardrails, shutdown flush) | (a) Per-turn cost + tokens pulled from the SDK's `SDKResultSuccess` (already includes `total_cost_usd` + `modelUsage`) and persisted into `metrics.jsonl`; `usage:today` IPC exposes a `summarizeUsage()` roll-up (by purpose + by model) for the dashboard. (b) `error-classifier.js` classifies LLM errors into `rate_limit`/`context_overflow`/`content_filter`/`auth`/`network`/`timeout`/`tool_error`/`unknown` with a `retryable` hint; the SDK auto-tags every error event with the kind. (c) Memory tool gains rate-limit (max 3 writes per turn) + per-target throttle (30s window) — stops over-eager models from flooding the char-cap. (d) `before-quit` Electron hook fires one final memory-review turn on app shutdown (`shutdown-flush.js`, 60s timeout, idempotent) so half-day sessions don't lose their lessons. All four additive; no schema or tool-shape changes. |
| 2026-05-26 | Brief reliability — timeout, metrics, and 10 content fixes | Observed 2026-05-26: London brief timed out at 5 min twice (the EFFORT bump to xhigh in PR #56 pushed brief turns past the default), produced a brief that admitted "HTF not refreshed" while HTF data sat in the bundle, cited 1m structure under "1H bias," graded pillar_grade=B with two WEAK pillars (constraint #9 says no-trade), invented arithmetic ("~220pt"), and shipped uncited sizing ("Tuesday standard"). Fixed in one PR — three reliability tweaks + ten content/schema tightenings. **Reliability:** brief-specific `timeoutMs: 600_000` (10 min) plumbed through `makeScheduledTurn`; failure metric now recorded when `userTurn` times out without throwing; retry calls `resetSession(purpose)` so the second attempt doesn't resume a confused partial conversation. **Content:** new `<phase name="brief">` in `app/main/prompts/analyze.md` with explicit per-TF citation paths, deterministic Pillar 1+2 grade rule, and a self-check; brief user prompt routes into it. **Schema:** `htf_bias[].note` requires a `(json.path)` citation regex; `sizing_note` requires `(memory.USER)` / `(memory.MEMORY)` / `(strategy.*)`; `key_levels[]` gains optional `cite` field shown as a tooltip. **Runtime:** `surfaceSessionBrief` rejects `pillar_grade=B` with ≥2 weak/fail pillars and rejects `A+` with any weak/fail. **Diff:** `Prep.jsx` `diffBriefs` normalizes level names (strips parenthetical suffix) so "AS.L" and "AS.L (swept-rejected)" no longer appear in both New and Dropped. **Engine:** `cli/lib/compute-engine-gates.js` augments every `structure_event` (and `most_recent_structure`) with `is_reclaimed: bool` computed from `quote.last` vs `level` by `dir` — surfaces the BoS/MSS-reclaimed warning the brief missed. |
| 2026-05-26 | Strategy chain (brief → open_reaction → entry_hunt → wrap) — structured handoffs + soft-fallback contract | The 2026-05-26 London brief surfaced output that admitted "HTF not refreshed" while HTF data sat in the bundle. Root cause: the dual-symbol bundle (~420KB) exceeds the Read tool's effective window — the `pair` block at chars 140k-420k is unreachable. PR #60's stricter prompt made the model honest about the gap; this PR closes it. **brief_digest:** new top-level field on paired bundles, computed in `cli/lib/brief-digest.js` (~7-15KB per symbol vs 152KB). Carries per-symbol HTF momentum + top-3 ranked FVGs/BPRs/structures + Pillar 2 quality + LTF context. Always readable in Read's first chunk. **Helpers:** `cli/lib/sizing.js` gains `computeSize({day, grade, memory_overrides})` (no LLM arithmetic, cites `strategy.sizing-table` + `memory.USER`); `cli/lib/entry-model-priority.js` is a pure decision-tree resolver (pillar2 poor → undecided; divergent → MSS; aligned + failure_swing → MSS; aligned + BoS in dir → Trend; aligned + inverted FVG → Inversion; else undecided). **Schemas:** `surface_session_brief` Zod gains `primary_draw` (anchor for the chain, cite must match `engine_by_tf.<tf>.fvgs|bprs`), `overnight_block` (untaken_above/below + verdict), `htf_quality` (h4/h1), `pillar2_verdict`, `no_trade_reason` (drives hard-vs-soft short-circuit), `chain_status`. `surface_ltf_bias` gains `leader`, `htf_ltf_alignment`, `is_retrace_day`, `entry_model_priority`, `grade_cap`, `chain_status`. `surface.js` cross-validates `no_trade_reason` (throws if missing on no-trade grade) and `entry_model_priority` (warns on mismatch with resolver). **Memory:** `pillar1.md` / `pillar2.md` become comparative (per-symbol `mnq:`/`mes:` sections re-rendered from disk on each surface call). **Prompt:** four phase rewrites in `app/main/prompts/analyze.md` (mirrored to `.claude/commands/analyze.md`): brief = 8-step walk with primary_draw pick; open_reaction = no-trade gate + minute-14 leader + entry_model_priority; entry_hunt = 6-step chain preamble + primary_draw validity check + chain-closure `tp2_cite: pillar1.<leader>.primary_draw.top`; new `<phase name="catch_up">` backfills when ltf-bias.md missing past 09:45 ET. New rule 8: `chain_status` enum (clean / degraded:&lt;reason&gt; / backfilled:&lt;phase&gt; / divergent / stale:&lt;min&gt;). **Routing:** `bar-close.js` `shouldRouteToCatchUp` detects the catch-up condition and prepends a routing directive into the per-bar prompt. **Wrap:** prompt updated to read chain frontmatter and emit a `chain_audit` block in `summary.md` frontmatter (tomorrow's brief reads this via `<recent_sessions>` for cross-day patterns). **Renderer:** `Prep.jsx` adds `ChainStatusChip` (amber/red on non-clean status) + `PRIMARY HTF DRAW` panel with cite tooltip. **Tests:** +33 unit tests across `brief-digest` (8), `sizing.computeSize` (10), `entry-model-priority` (8), `catch-up` (7); fixtures 004 (paired with digest) + 005 (divergent NY) added (smoke now 10/10). Spec: [docs/superpowers/specs/2026-05-26-strategy-chain-design.md](docs/superpowers/specs/2026-05-26-strategy-chain-design.md). Plan: [docs/superpowers/plans/2026-05-26-strategy-chain-implementation.md](docs/superpowers/plans/2026-05-26-strategy-chain-implementation.md). |
| 2026-05-27 | PREP panel redesign — checklist-mirror layout | Restructure PREP to mirror the strategy doc's 7-step checklist: STEP 1 HTF Bias (+ primary draw nested), STEP 2 Overnight + Levels (grouped above/below `currentPrice` from `useSymbolCache`, with alert bells preserved), STEP 3 Price Quality (Pillar 2 broken out via name-substring matching, robust to ordering changes). One-line PRE-SESSION GRADE headline replaces the full pillar drilldown (Pillar 1 + 2 status visible inline; full pillars panel is still used by LIVE/REVIEW). SCENARIOS promoted from a buried subsection of PLAN to a first-class panel with grade pills; additive Zod extension on `surface_session_brief` adds `id`, per-scenario `grade` enum (`A+`/`B`/`no-trade`), and digit-refined `target`. Existing `condition` field name kept for backward compat with briefs on disk. Stale banner + day-over-day diff link + chain chip + refresh button collapse into one STATUS STRIP row above SESSION BRIEF. Same data hooks (`useSessionBrief`, `useSessionRecap`, alert plumbing) — no IPC changes. Pure helpers extracted to `app/renderer/src/Prep.helpers.js` (4 exports — `groupLevelsByPrice`, `selectPillar`, `pillar2ToRows`, `formatChainChip`) so they're testable with `node --test` (renderer has no Vitest). **Tests:** +16 helper unit tests + 3 brief-flow schema round-trip tests (267 total). Spec: [docs/superpowers/specs/2026-05-26-prep-panel-redesign.md](docs/superpowers/specs/2026-05-26-prep-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-prep-panel-redesign.md](docs/superpowers/plans/2026-05-27-prep-panel-redesign.md). |
| 2026-05-27 | LIVE panel redesign — three explicit sub-states | Restructure LIVE around three deliberate layouts routed by data (activeTrade → InTrade; subState=open-reaction → OpenReaction; else → EntryHunt). **OpenReaction** gains STEP 4 prefix on the existing tracker + a new SESSION LIQUIDITY panel that reads `useSessionBrief().brief.key_levels` (no new IPC). **EntryHunt** gains a STEP 5+6 ENTRY MODEL + CONFIRMATION panel above SetupCard with explicit PD-tap / 1m close / 5m close / clean-delivery checks (substring-matched against `activeSetup.pillar_breakdown[Pillar 3].elements`); SetupCard + accept/reject unchanged. **InTrade** is new and dedicated: trade header, LIVE GRID 4-cell (PRICE / P&L / TO TP1 / TO STOP), risk plan rows, three TV hand-off buttons (`▸ TV STOP` / `▸ TV SCALE` / `▸ TV CLOSE` — fire a toast + scroll the chart pane into view; no broker writes per CLAUDE.md constraint #2), and a BRAIN narration block sourced from the latest `useChat().messages` filtered to `type === "bar-read"`. Chat + setup history persist below the IN-TRADE panel (hybrid layout) so the trader can ask questions mid-trade. Stop-to-BE automation unchanged (already happens on TP1_HIT via `trade-ticker.js`). Pure helpers extracted to `app/renderer/src/Live.helpers.js` (4 exports — `selectPillar3`, `pillar3ToConfirmationRows`, `liveGridFromTrade`, `latestBarReadMessage`) for `node --test` coverage. **Tests:** +17 helper unit tests (~284 total). Spec: [docs/superpowers/specs/2026-05-27-live-panel-redesign.md](docs/superpowers/specs/2026-05-27-live-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-live-panel-redesign.md](docs/superpowers/plans/2026-05-27-live-panel-redesign.md). |
| 2026-05-27 | REVIEW panel redesign — chronological CANDIDATE LEDGER | Merge today's `ACCEPTED TRADES` (full TradeCards) and `REJECTED / NO-TRADE` (compact rows) sections into a single chronological `CANDIDATE LEDGER` sorted by `setup.ts`. Each row carries `ts · grade · side · model · state pill · reason`. State derivation maps `_disposition` + folded trade `outcome` to one of `CONFIRMED · TP1/2`, `STOPPED`, `INVALIDATED`, `REJECTED`, `NO-TRADE`, `OPEN`, `PENDING`. **Click-to-expand:** confirmed/accepted rows show a `▸` / `▾` caret; clicking toggles an inline `LedgerTradeExpand` wrapping the existing `TradeCard` from `Shared.jsx` (reused unchanged). Non-confirmed rows are read-only (the reason column carries the no-trade or rejection text). **Grade column:** renders `"no-trade"` as `"NO"` so the narrow column doesn't wrap; the wider state pill column still shows `"NO-TRADE"`. **BLOCKED MOMENTS skipped** — the ledger already shows the chronological cluster of no-trade markers; a separate panel would duplicate. **Backend change:** one additive line in `app/main/review.js` `getJournalFor` attaches `_rejection_reason` to rejected setups (sourced from the matching reject trade event's `reason` field). **AGENT STATE + EXPORT JSON + SESSION JOURNAL + WATCH NEXT SESSION + SESSION LIBRARY all unchanged.** Pure helpers extracted to `app/renderer/src/Review.helpers.js` (4 exports — `formatGradeShort`, `deriveLedgerState`, `deriveLedgerReason`, `buildLedger`) for `node --test` coverage. **Tests:** +25 helper unit tests (309 total). Spec: [docs/superpowers/specs/2026-05-27-review-panel-redesign.md](docs/superpowers/specs/2026-05-27-review-panel-redesign.md). Plan: [docs/superpowers/plans/2026-05-27-review-panel-redesign.md](docs/superpowers/plans/2026-05-27-review-panel-redesign.md). |

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
  memory/                 cross-day persistent memory (Hermes-inspired; PR 2026-05-26)
    USER.md               trader profile (preferences, schedule, instruments traded)
    MEMORY.md             cross-day market lessons + agent observations
  session/<YYYY-MM-DD>/   per-day folder; holds bar-close-events.jsonl (detector log)
    <session>/            one folder per session — ny-am / ny-pm / london — each with:
                          pillar1.md, pillar2.md, open-reaction.md, ltf-bias.md,
                          bars.jsonl, bars-5m.jsonl, setups.jsonl, summary.md
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
  candidates: {                                          detector output (cli/lib/setup-detector.js)
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

**Baseline reuse (`--baseline <path>`).** Loads a previously-captured full bundle and uses its `bars_by_tf` + `engine_by_tf` instead of re-running the multi-TF chart sweep. Strategy §2.4 explicitly allows reusing HTF context intraday ("HTF gives a macro direction, but immediate trades are decided by how NY reacts to overnight levels"); HTF bias doesn't change minute-to-minute. Pairs with `--pillar3-only` for the watchman pattern:

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

## The session recipe (LLM-driven, runs on every bar close)

**Architecture (decided 2026-05-19):** the LLM (Claude in your Claude Code session) is the engine. It runs Lanto's 3-pillar checklist from a to z, on every 1m and 5m candle close, building up `state/session/<today>/<session>/*` notes as the day goes on.

The plan is in [docs/plans/llm-driven-session.md](docs/plans/llm-driven-session.md) and is being implemented on a feature branch. The flow:

1. **Detector** (cheap, deterministic): `./bin/tv stream bar-close` prints one JSON line per closed 1m bar; one extra line per closed 5m bar. Time-aligned polling (sleeps to next 60s boundary, polls fast post-close).
2. **Monitor in Claude Code:** `Monitor("./bin/tv stream bar-close")` streams those lines into the session. Each line is an event Claude reacts to.
3. **Phase-aware `/analyze`:** reads the ET clock + `state/session/<today>/<session>/*` + the current bundle. Does the right thing per phase (pre-session → grade Pillar 1+2; 09:30-09:45 → open reaction; 09:45-12:00 → entry hunt; etc.). Writes updates.
4. **Session memory** in per-session folders `state/session/<YYYY-MM-DD>/<session>/` (`<session>` = `ny-am` / `ny-pm` / `london`): `pillar1.md`, `pillar2.md`, `open-reaction.md`, `ltf-bias.md`, `bars.jsonl`, `bars-5m.jsonl`, `setups.jsonl`, `summary.md`. Each session folder is self-contained — sessions never overwrite each other. The detector's `bar-close-events.jsonl` stays at the day level.

Until the redesign lands, the existing `analyze` command + slash command still work for one-shot grading.

## The `dash` recipe (live oversight TUI)

`./bin/tv dash` is a terminal UI that gives you live visibility into everything the system is doing. Run it in a separate terminal alongside the detector + Claude Code session.

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

`/judge <id|all>` is the semantic half of fixture regression testing — `npm run smoke:fixtures` checks bundle schema + citations deterministically; `/judge` checks whether a fresh read of a bundle still reaches the same verdict as the hand-graded `expected.md`. It is a **slash command, not a script** (CLAUDE.md bans the Anthropic API in scripts): the LLM re-grades the bundle blind, then emits categorical per-dimension verdicts (`agree` / `partial` / `disagree`) to `tests/fixtures/NNN-label.judge.json` (gitignored — regenerated each run); `npm run judge:report` tallies them into agreement percentages (constraint #7 — the LLM never produces the score). Built 2026-05-20; becomes a real regression gate once the corpus reaches ~10 fixtures. See `.claude/commands/judge.md`.

## Status

- **Scaffolding pushed.** README + .gitignore on `main`. CLI vendored, port locked, `analyze` command in place, slash command in place, research and strategy saved.
- **Research bound.** Hard constraints 5–10 cite the research files as authority. Future design changes must do the same.
- **Strategy bound.** Hard constraint #11 makes `docs/strategy/*.md` the authoritative spec for trade framing. `/analyze` mirrors the 7-step checklist. A+ examples for all three entry models are embedded.
- **Harness operational.** `npm run smoke:fixtures` runs schema + citation checks across every fixture. Verifier mechanically enforces constraint #6.
- **Gates emitting (richer).** `tv analyze` now returns a `gates` object covering: clock-based session, price-in-box checks, **full session liquidity map (PDH/PDL/AS_H/AS_L/LO_H/LO_L/NYAM_H/NYAM_L with taken/untaken)**, **most-recent ICT swing structure points (ST/IT/LT × HH/HL/LH/LL) ordered by Pine x-index**, **FVG counts classified by direction (bullish_fvg / bullish_ifvg / bearish_fvg / bearish_ifvg) via bgColor**, **bias-label scan** (auto-populates if any indicator publishes /bias/i text), **single-bar last_bar confirmation facts**, plus the original range / candle-quality stats. LLM no longer has to compute any of these.
- **Multi-TF bundle.** `bars_by_tf` and `pine_by_tf` provide Daily/4H/1H/15m/5m/1m bar summaries and trimmed Pine surfaces (boxes + labels for tracked studies). Captured via chart-switching with original-TF restore.
- **File output.** `./bin/tv analyze --out <path>` for bundles too large to pipe via stdout.
- **Watchman removed (2026-05-19).** The deterministic `tv watch` (state machine, briefing files, preflight mode, PD-array alerts) was replaced by LLM-driven session analysis. Strategy §7 is sequential — the LLM walking the checklist on every bar close fits that better than a separate trigger layer. Plan in [docs/plans/llm-driven-session.md](docs/plans/llm-driven-session.md). Build in progress on `feat/llm-driven-session`.

## Pending implementation

### Done so far

- Restructure `/analyze` around the 3-pillar framework, mirroring `trading-strategy-2026.md §7`.
- Three A+ canonical examples (MSS / Trend / Inversion) embedded as `<example>` blocks in the slash command. *Source: [docs/research/ai-consistency.md](docs/research/ai-consistency.md) — 72%→90% accuracy lift from Tool Use Examples.*
- Citation verifier (`scripts/verify-citations.js`) enforces constraint #6 mechanically against any paired `(analysis, bundle)` input.
- Minimal verification harness (`scripts/smoke-fixtures.js`, `npm run smoke:fixtures`) — schema + citation regression across every fixture in `tests/fixtures/`.
- Seed fixture (`tests/fixtures/001-current.*`) with hand-graded expected analysis from a 2026-05-15 NY-PM MNQ snapshot.
- **Watchman scaffolding deleted (2026-05-19).** Replaced by LLM-driven session analysis. The watchman as a deterministic state-machine layer was archived; the bar-close detector + phase-aware `/analyze` + session-memory pattern is being built on `feat/llm-driven-session`. The gates and `--scan-tf` flag survive — they're consumed by the new `/analyze`.
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
- ~~**Decide on heuristic thresholds per symbol/timeframe.**~~ Done 2026-05-20. The Pillar 2 range threshold is now per-symbol (`cli/lib/pillar2-thresholds.js`); `MNQ` is calibrated (range ≥ 40), other symbols emit `range_acceptable: null` until a fixture calibrates them. Body-ratio thresholds (≥ 0.6 = good) stay fixed — a normalised 0..1 ratio is symbol-independent. Per-timeframe calibration remains a possible future refinement.
- ~~**LLM-as-judge for semantic regression.**~~ Tooling built 2026-05-20 — the `/judge` command + `npm run judge:report`. Becomes a real regression gate once the corpus exceeds ~10 fixtures; until then its report is directional, not conclusive.

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

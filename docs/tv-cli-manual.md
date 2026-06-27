# TradingView CLI (`./bin/tv`) — Guide, Manual & Operational Report

> Self-authored reference for driving TradingView Desktop from this project. Authoritative source = the local code in `cli/commands/*.js` + `packages/core/*.js`. Upstream context: [tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) (this CLI was vendored + forked from it).
> Written 2026-06-27. Three parts: **Part 1 Guide** (quickstart + how it works), **Part 2 Manual** (every command), **Part 3 Report** (gotchas, limits, what I learned).

---

# PART 1 — GUIDE

## What it is

`./bin/tv` is a JSON-emitting CLI that controls a **locally running TradingView Desktop** app over the **Chrome DevTools Protocol (CDP)**. It does not touch TradingView's servers, network, or files — it speaks to the Electron debug interface already inside the desktop app (the same protocol VS Code / Slack / Discord expose). Nothing works unless TV Desktop was launched with the debug flag.

- **Output:** every command prints one JSON object to stdout (pipe with `jq`). Errors → stderr.
- **Exit codes:** `0` success · `1` error · `2` CDP connection failure.
- **Plumbing:** `bin/tv` (shell wrapper) → `cli/index.js` → `cli/router.js` → `@tvmcp/core/*` (the CDP client in `packages/core/`).

## Architecture (one diagram in words)

```
./bin/tv <cmd>  →  cli/router.js  →  @tvmcp/core (CDP client)  ──WebSocket──►  TradingView Desktop
                                                                                 (Electron, --remote-debugging-port=9225)
                                                                                 page target type = "page"
```

`packages/core/connection.js` finds the chart target (`type: 'page'` or `'webview'`, URL matches `tradingview.com/chart`), opens a CDP WebSocket, enables the `Runtime`/`Page`/`DOM` domains, and exposes `evaluate(jsExpr)` plus typed helpers (`chart`, `data`, `replay`, `alerts`, `pine`, …). Most reads are `Runtime.evaluate` against TradingView's **undocumented internal API** (`window.TradingViewApi` / the active chart widget). Pine-emitted data (lines/labels/tables/boxes) is read from the on-chart study's draw objects.

## Hard constraints (this project — from CLAUDE.md)

1. **Port 9225 only.** TV Desktop runs on CDP `9225` (`packages/core/connection.js` `CDP_PORT`). NOT 9222 (upstream default / other projects) and NOT 9223 (the in-app webview, which is the user's personal display — never drive it for analysis/replay/pine).
2. **CLI only — no MCP tools.** Never use `mcp__tradingview__*`. Every interaction goes through `./bin/tv` (or `node ./cli/index.js`).
3. **TV Desktop must be running with the debug flag**, or the whole system is blind.

### Relaunch recipe (when CDP 9225 doesn't answer / chart is deeply wedged)

```bash
osascript -e 'quit app "TradingView"'
open -a TradingView --args --remote-debugging-port=9225
# wait for it to boot, then verify:
curl -s --max-time 4 http://127.0.0.1:9225/json/version    # should return JSON
./bin/tv status                                            # cdp_connected: true
```

## 30-second quickstart

```bash
./bin/tv status                 # is CDP connected? what symbol/TF?
./bin/tv quote                  # current price
./bin/tv state                  # symbol, timeframe, studies on chart
./bin/tv symbol MNQ1!           # change symbol
./bin/tv timeframe 5            # change timeframe (1/5/15/60/240/D)
./bin/tv data tables -f "ICT Engine"   # read the ICT Engine evidence table (-f = study filter)
./bin/tv analyze --out state/last-analyze.json      # full ICT bundle → file
```

---

# PART 2 — MANUAL (full command reference)

All commands self-register in `cli/commands/*.js` (imported in `cli/index.js`). `./bin/tv <cmd> --help` prints usage. Below: command · what it does · key options.

## Connection & chart state

| Command | Does | Options |
|---|---|---|
| `status` | Check CDP connection (`cdp_connected`, target id/url, chart symbol/res, `api_available`). | — |
| `state` | Current chart state: symbol, timeframe, chart type, studies list. | — |
| `symbol [SYM]` | Get (no arg) or set the chart symbol. | positional `SYM` |
| `timeframe [TF]` | Get/set timeframe. TV codes: `1 5 15 60 240` (= 4H) `D`. | positional `TF` |
| `type [T]` | Get/set chart type (Candles, Line, …). | positional `T` |
| `info` | Detailed symbol metadata. | — |
| `search <q>` | Search symbols by name/keyword. | positional query |
| `range` | Get/set visible chart range. | `--from <unixsec>` `--to <unixsec>` |
| `scroll <date>` | Scroll the chart to a date. | positional date |
| `discover` | Report which internal TradingView API paths are currently available (capability probe). | — |
| `ui-state` | Current UI state (panels, buttons). | — |

## Market data

| Command | Does | Options |
|---|---|---|
| `quote` | Real-time price quote (`last`, `ohlc`, volume, time). | — |
| `ohlcv` | OHLCV bars at the chart's TF. | `-n/--count <N>` (default 100, max 500) · `-s/--summary` (stats instead of bars) |
| `values` | Current indicator values from the Data Window. | — |
| `data lines` | Pine `line.new()` price levels. | `-f/--filter <study>` `-v/--verbose` |
| `data labels` | Pine `label.new()` annotations. | `-f` `-n/--max <N>` (default 50) `-v` |
| `data tables` | Pine `table.new()` data — **how the ICT Engine evidence table is read**. | `-f/--filter <study>` (e.g. `-f "ICT Engine"`; note the deploy-pine skill's `--study-filter` is an unknown flag that falls through to unfiltered) |
| `data boxes` | Pine `box.new()` price zones (FVGs etc.). | `-f` `-v` |
| `data strategy` | Strategy performance metrics. | — |
| `data trades` | Strategy trade list. | `-n/--max <N>` |
| `data equity` | Strategy equity curve. | — |
| `data depth` | Order book / DOM. | — |
| `data indicator` | Indicator info + inputs by entity id. | — |

> **Why tables matter:** the ICT Engine writes all its evidence (levels, sweeps, FVGs, BPRs, swings, structures, pools, quality) into a transparent Pine `table` that renders zero visible pixels but is fully readable over CDP. `data tables` is the read path. See `cli/lib/ict-engine-parser.js`.

## Pine Script

`pine <sub>` — `cli/commands/pine.js`.

| Sub | Does |
|---|---|
| `pine get` | Read current Pine source from the editor. |
| `pine set` | Set source (stdin or `--file/-f <path>`). |
| `pine compile` | **Smart compile** — finds the right editor button by `title` attribute, prefers **"Update on chart"** (in-place, no duplicate), falls back to "Save and add to chart". |
| `pine click` | Click compile/add without smart detection. |
| `pine analyze` | Offline static analysis (no TV needed). `--file/-f`. |
| `pine check` | Server-side compile check (no chart needed). `--file/-f` → `{compiled, error_count}`. |
| `pine save` | Save current script (Ctrl+S). |
| `pine new` | Create a blank script (indicator/strategy/library). |
| `pine open <name>` | Open a saved script by name (retries 3× — the editor pane lags). |
| `pine list` | List saved scripts. |
| `pine errors` | Compilation errors. |
| `pine console` | Console/log output. |

**Correct deploy sequence** (CLAUDE.md 2026-06-21; the `/deploy-pine` skill automates the verify): `pine open "<script>"` (must succeed) → `pine set --file` → `pine compile` (expect `"button_clicked": "Update on chart"`, `"study_added": false`) → `pine save` → **verify by field-KEY presence** (`data tables | grep c1o=`, not by value — new fields read `NaN` on pre-existing zones) and confirm study count stays 1.

## Indicators, drawings, alerts

| Command | Does | Options |
|---|---|---|
| `indicator add <name>` | Add an indicator. | `-i/--inputs <json>` |
| `indicator remove <id>` | Remove by entity id. | — |
| `indicator toggle <id>` | Show/hide. | `--visible` / `--hidden` |
| `indicator set <id>` | Change inputs. | `-i/--inputs '{"length":50}'` |
| `indicator get <id>` | Info + inputs. | — |
| `draw shape` | Draw on chart. | `-t/--type horizontal_line|trend_line|rectangle|text` `-p/--price` `--time` `--price2` `--time2` `--text` `--overrides <json>` |
| `draw list` / `draw get <id>` / `draw remove <id>` / `draw clear` | Manage drawings. | — |
| `alert list` | List active alerts. | — |
| `alert create` | Create a price alert. **REST POST to `pricealerts.tradingview.com/create_alert` from page context** — do NOT set `Content-Type: application/json` (triggers a CORS preflight TV rejects). | `-p/--price` `-c/--condition crossing|greater_than|less_than` `-m/--message` |
| `alert delete` | Delete alerts. | `--id <alert_id>` · `--all` (destructive — clears all) |

## Layout, panes, tabs, watchlist

| Command | Does |
|---|---|
| `layout list` / `layout switch <name>` / `layout save` | Manage saved layouts. `save` persists to server (survives reload — run after a Pine deploy). |
| `pane list` / `pane layout <grid>` / `pane focus <i>` / `pane symbol <i> <sym>` | Multi-pane grids (`s, 2h, 2v, 2x2, 4, 6, 8`). |
| `tab list` / `tab new` / `tab close` / `tab switch <i>` | Chart tabs. |
| `watchlist get` / `watchlist add <sym>` | Watchlist. |

## Replay (historical bar stepping)

`replay <sub>` — `cli/commands/replay.js`. **This drives TV's Bar Replay; the backtest/recorder is built on it.**

| Sub | Does | Options |
|---|---|---|
| `replay start` | Enter replay at a date. | `-d/--date YYYY-MM-DD` (or `--from`) · `--at HH:MM` (ET, e.g. `09:30`; without `--at` a bare date = midnight UTC = 8 PM ET prior day) |
| `replay step` | Advance one bar. | — |
| `replay stop` | Exit replay → realtime. | — |
| `replay status` | `is_replay_started`, `current_date`, autoplay, position. | — |
| `replay autoplay` | Toggle autoplay. | `-s/--speed <ms>` |
| `replay trade` | Execute a trade in replay (buy/sell/close). | — |

## Streaming / monitoring (JSONL, one line per event)

`stream <sub>` — `cli/commands/stream.js`. Long-running; pipe into a monitor.

| Sub | Does | Default poll |
|---|---|---|
| `stream quote` | Price ticks (OHLCV per bar). | `-i 300ms` |
| `stream bars` | Last-bar updates (on new bar or price change). | `-i 500ms` |
| `stream bar-close` | **One JSON line per CLOSED bar.** Time-aligned (sleeps to the next 60s boundary, polls fast post-close). Flags 5m closes when on 1m. The live-session detector. | aligned |
| `stream values` | Indicator values (RSI/MACD/…). | `-i 500ms` |
| `stream lines` / `labels` / `tables` | Pine draw-object streams. | `-i 1000/1000/2000ms`, `-f` filter |
| `stream all` | All panes at once (multi-symbol). | `-i 500ms` |

## Capture & UI automation

| Command | Does | Options |
|---|---|---|
| `screenshot` | Capture chart PNG. **Verification/tests only — never feeds analysis** (CLAUDE.md #5). | `-r/--region full|chart|strategy_tester` `-o/--output <name>` |
| `ui click` | Click a UI element. | `-b/--by aria-label|data-name|text|class-contains` `-v/--value` |
| `ui keyboard <key>` | Press a key/shortcut. | `--ctrl --shift --alt --meta` |
| `ui hover` / `ui scroll` / `ui find` / `ui type` / `ui panel` / `ui fullscreen` / `ui mouse <x> <y>` | Low-level automation. | `ui find -s text|aria-label|css` · `ui mouse --right --double` |
| `ui eval <js>` | **Run arbitrary JS in the TV page context.** The escape hatch — every typed helper is sugar over this. | — |

## Project-specific commands (added in this fork; not in upstream)

| Command | Does |
|---|---|
| **`analyze`** | The big one — bundles chart state + multi-TF OHLCV + parsed ICT Engine (per TF) + deterministic gates (session + 3 pillars) into one JSON for ICT analysis. See Part 2 §"The analyze bundle". |
| `dash` | Live oversight TUI (Go + bubbletea). `./bin/tv dash` exec's `bin/tv-dash`; build with `make dash`. Reads `state/` only (no CDP) — never disturbs the chart. |
| `trades tick` / `trades list` / `trades show <id>` | Trade outcome tracking against open trades (`--session`, `--bar '{"high":N,"low":N,"ts":"…"}'`). |
| `record-tape` | Step replay across a session, recompute the ICT Engine at every bar, emit a per-bar walker **day-tape** (feeds the day-tape gate after hand-grading). `-l/--label` `--from` `--to` `-o/--out` `--fixture`. |
| `capture-replay` | Capture GXNQ no-lookahead replay data (D1/H4/H1/15M/5M context + 15M/5M/1M NY-AM). `-l/--label` `-s` `-d` `--as-of` `--out` `-f`. |
| `live-check` | Fail-closed live startup checklist before MNQ/MES trading. `-s/--session ny-am|ny-pm|london` `-f/--fixture` `--now`. |
| `live-dry-run` | One manual-first live dry-run tick; blocks action when source health/readiness fails. `-s/--session`. |

**Removed from upstream** (footguns / wrote to shared `~/.tradingview-mcp/`): `brief`, `session`, `launch` commands; `morning.js`, `paths.js` core modules.

## The `analyze` bundle (the heart of the system)

`./bin/tv analyze` → one JSON object. Single data source = the **ICT Engine** Pine indicator (evidence table). Key flags:

| Flag | Effect |
|---|---|
| `--out <path>` | Write bundle to file; stdout prints `{saved_to}`. **Mandatory** for multi-TF bundles (>~60KB, exceed Bash output limits). |
| `--current-tf-only` / `--pillar3-only` | Skip the multi-TF chart sweep (no flashing). ~0.4–0.6s vs ~13s. `engine_by_tf`/`bars_by_tf` become null. Used by the live polling loop. |
| `--scan-tf <tf>` | Briefly switch to this TF for the scan, then restore (~2–3s flash). Pairs with `--pillar3-only`. |
| `--baseline <path>` | Reuse a prior full bundle's `bars_by_tf` + `engine_by_tf` instead of re-sweeping (HTF reuse is valid intraday — strategy §2.4). Emits `baseline_meta.age_seconds`; refresh when >900s. |
| `--pair "MNQ1!,MES1!"` | Dual-symbol scan; adds a top-level `pair` block + `brief_digest`. |
| `--symbol <SYM>` | Pin the chart to a symbol before capturing. |
| `--fallback-baseline <path>` | Fill TFs with no fresh engine table after the verified-capture retry (age-capped 24h, recorded in `capture_health`, skipped under replay). |

Bundle shape (abridged): `{ timestamp, chart, quote, bars, bars_by_tf{daily,h4,h1,m15,m5,m1}, engine, engine_by_tf, gates: { session{…clock…}, engine{ meta, price_context, pillar1{session_levels, untaken_*, sweeps, pools}, pillar2{m5,m15 quality}, pillar3{fvgs, bprs, swings, structures, failure_swings} }, }, candidates, capture_health }`. Gates are **pre-computed in code** (`computeSessionGate` clock-based; `computeEngineGates` engine-derived) — the LLM reads them, never recomputes. Citations into the bundle are enforced (constraint #6). Full schema in `CLAUDE.md` → "The `analyze` recipe".

---

# PART 3 — OPERATIONAL REPORT (gotchas, limits, what I learned)

## The #1 rule: ONE process drives the chart at a time

TV Desktop's chart is a single shared surface. **Two CDP clients driving it concurrently = wedge** (chart blanks, engine table empties, quote sticks on "chart may still be loading"). This is the single biggest operational trap.

- The project's **Electron app** (`npm run dev` → `electron .`) holds its own persistent CDP connection to 9225. While it runs, a *second* driver (a headless recorder, a CLI replay loop) fights it → wedge.
- **Why the in-app backtest "just works":** when you run it, the app is the *only* driver. Same `runBacktest` + `PROD_DEPS` code as the headless recorder — the difference is sole ownership, not the code.
- **To record/replay headless:** stop the app first (or close anything else on the chart), run the single-process recorder as the sole driver, then restart the app. Verified 2026-06-27.

## Gotcha: don't poll the chart with `./bin/tv` loops

Each `./bin/tv` call is a **fresh process** that opens a CDP connection, enables Page/Runtime/DOM, and exits. A tight `until`/`while` loop firing `tv data tables`/`tv quote` every few seconds = rapid connect/enable/abrupt-exit **churn** that destabilizes the chart renderer. One-off calls are fine; loops are not. The CLI now closes its connection on exit (`cli/router.js` `safeDisconnect`, fix `449c8b9`) to reduce the damage — but the rule stands: **wait via `curl http://127.0.0.1:9225/json/version` (harmless HTTP), not via `tv` polling.**

## Gotcha: the replay wedge

A *second* `replay.start` on the same chart wedges into "this symbol doesn't exist" — only a **page reload** clears it (not the replay API). The recorder reloads before every replay session (`freshChartForReplay`). A light wedge recovers with `evaluate(location.reload())` + a quote poll; a deep wedge needs the full TV restart (relaunch recipe above). Quotes can tick even when the pane is dead — gauge health by the engine table + a real reload, not just the quote.

## Gotcha: Pine deploy reverts on reload

If two saved scripts share a title, a deploy can revert to old schema on reload. Use a unique indicator name; apply via **"Update on chart"** (not "Add to chart", which duplicates the study); verify by field-KEY presence and a study count of 1. The deployed parser rejects unknown `meta.schema` numbers as a safety gate.

## Gotcha: screenshots are not analysis input

`screenshot` exists for verification/tests only. Multimodal LLMs can answer "correctly" while barely using the image → visual hallucination risk. Analysis reads the **evidence table**, never pixels (CLAUDE.md #5, research-backed).

## Limits (what the CLI can NOT do)

- It rides **undocumented internal TradingView APIs** via the Electron debug interface — these break without notice on any TV update. Pin the TV Desktop version if stability matters.
- It does **not** connect to TV servers, store/transmit market data, or bypass any paywall — a valid TV subscription + the running Desktop app are required.
- It does **not** execute real broker trades from the chart (`replay trade` is replay-only). Real order execution in this project is a separate path (the Tradovate/paper engine), not `./bin/tv`.
- Markets-closed / weekend: the live quote is the prior close; replay still works but the chart is more wedge-prone when there's no live feed.

## Where to look in the code

- Command defs + options: `cli/commands/*.js` (each calls `register(name, {description, options|subcommands, handler})`).
- Dispatch: `cli/router.js` (`execute` runs the handler, prints JSON, `safeDisconnect`, exits).
- CDP client + helpers: `packages/core/{connection,chart,data,replay,alerts,pine}.js` (`CDP_PORT = 9225`).
- The analyze bundle: `cli/commands/analyze.js` + `cli/lib/{compute-engine-gates,ict-engine-parser,brief-digest}.js`.
- Engine source: `pine/ict-engine.pine` (deploy via `/deploy-pine`).

## Upstream vs this fork (for context)

Upstream [tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) is an **MCP server** ("every MCP tool is also a `tv` CLI command") on port **9222**, framed as a research project on LLM↔trading-UI interaction. This project **vendored the CLI**, locked it to **9225**, dropped MCP usage (CLI-only), stripped the shared-state commands, and added the ICT-specific layer (`analyze`, `record-tape`, `capture-replay`, `live-check`, `dash`, the gates, the engine parser). When in doubt, the local code wins — the fork has diverged.

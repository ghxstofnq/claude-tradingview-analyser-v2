# claude-tradingview-analyser — project rules for Claude

This file extends the user's global working agreement at `~/.claude/CLAUDE.md`. The global agreement still applies in full. This file documents project-specific decisions, constraints, and context.

## Hard constraints

1. **CDP port 9223 only. Never 9222.** The vendored CLI under `cli/` has its core (`packages/core/connection.js`, `packages/core/tab.js`) hardcoded to 9223. Do not invoke upstream `~/tradingview-mcp-ict` from this project — that copy targets 9222 and is used by other projects on this machine.
2. **CLI only — no MCP tools.** Do not use any `mcp__tradingview__*` tool when working in this project. Every TradingView interaction goes through `./bin/tv` (or directly `node ./cli/index.js`).
3. **No edits to other projects.** Do not modify `~/Documents/ai-trading-agent` or `~/tradingview-mcp-ict`. This project is fully self-contained.
4. **Local state only.** Project state lives under `./state/`. Never read or write `~/.tradingview-mcp/`. The two upstream commands that wrote there (`brief` and `session`) have been stripped from the vendored CLI; the corresponding core modules (`morning.js`, `paths.js`) deleted.
5. **Screenshots are for verifications and tests only.** `./bin/tv screenshot` exists but its output never feeds analysis. Do not include screenshots in the `analyze` bundle.

## Architecture decisions

| Date | Decision | Why |
|------|----------|-----|
| 2026-05-17 | CLI-only consumption, no MCP tools | Ship without an MCP config requirement; CLI is the long-term canonical surface. |
| 2026-05-17 | Vendor the `tv` CLI inside this project | Enables first-class custom `tv <foo>` commands sharing in-process core access. Accepted cost: maintaining a fork. |
| 2026-05-17 | Lock to CDP port 9223 | Port 9222 is the default for `ai-trading-agent` and upstream `tradingview-mcp-ict`. 9223 is this project's lane. |
| 2026-05-17 | ICT methodology | Analysis is framed in ICT vocabulary (HTF bias, liquidity, FVGs, order blocks, killzones, mitigation, IPDA). |
| 2026-05-17 | Build order: live single-chart read first | Foundation primitive. Tracker, scanner, backtester build on top. |
| 2026-05-17 | Claude Code session only — no Anthropic API in scripts | Project is `tv` recipes + this CLAUDE.md teaching Claude how to use them. No API key required. |
| 2026-05-17 | Stripped `brief`, `session`, `morning.js`, `paths.js` from vendored copy | Removes footguns that would write to the shared `~/.tradingview-mcp/`. |
| 2026-05-17 | Screenshots out of analysis input | Operator decision. Screenshots are sanity-check / regression-test material only. |

## Repo

- Private GitHub repo: https://github.com/ghxstofnq/claude-tradingview-analyser
- Workflow: feature branches + PR. Never push directly to `main` after the bootstrap commit.
- Commits: Conventional Commits (`feat: / fix: / chore: / docs: / refactor: / test:`).
- Hooks: never bypass (`--no-verify` / `--no-gpg-sign` / `--force` / `--amend` forbidden unless explicitly asked).
- Co-author tag on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Layout

```
.claude/
  commands/
    analyze.md            /analyze slash command (Claude Code)
bin/
  tv                      shell wrapper around ./cli/index.js
cli/
  index.js                vendored entrypoint; registers all commands
  router.js               vendored router
  commands/
    (vendored upstream commands)
    analyze.js            project-local: bundles JSON for /analyze
packages/
  core/                   vendored @tvmcp/core; CDP_PORT = 9223
package.json              workspaces, scripts, sole runtime dep: chrome-remote-interface
state/                    gitignored; created on demand
  screenshots/            verification / tests only — NOT analysis input
```

## The `analyze` recipe (what `/analyze` does)

`./bin/tv analyze` returns one JSON object:

```
{
  timestamp:     ISO-8601 string
  chart:         { symbol, resolution, chartType, indicators[] }
  visible_range: { from, to } (unix seconds)
  quote:         { last, ohlc, volume, ... }
  bars:          OHLCV summary
  indicators:    [{ name, values: {...} }]  (current values of every visible indicator)
  pine: {
    lines:       [{ price, label, ... }]    horizontal levels (PDH, PDL, swing levels, equal highs/lows)
    labels:      [{ price, text, ... }]     text annotations (bias readouts, level names)
    tables:      [{ rows... }]               table data (session stats, analytics dashboards)
    boxes:       [{ high, low, label }]     price zones (FVGs, order blocks, ranges)
  }
}
```

The slash command body (`.claude/commands/analyze.md`) tells Claude how to interpret this JSON in ICT terms.

## ICT vocabulary cheat-sheet (for Claude reading the JSON)

- **HTF / LTF** — higher-timeframe (daily / 4h / 1h) and lower-timeframe (15m / 5m / 1m) context. HTF sets bias, LTF triggers entries.
- **Liquidity** — pools of stops sitting above swing highs (buy-side) or below swing lows (sell-side). Price often runs liquidity before reversing.
- **PDH / PDL** — previous day's high / low. Common liquidity targets.
- **FVG (Fair Value Gap)** — a 3-bar imbalance where bar-1 high and bar-3 low don't overlap. Often acts as a retracement target / support-resistance zone. Appears in `pine.boxes` if an FVG indicator is loaded.
- **BISI / SIBI** — Buy-side Imbalance Sell-side Inefficiency / Sell-side Imbalance Buy-side Inefficiency. Direction of an FVG.
- **Order block** — last opposing candle before a strong displacement. Bullish OB = last bearish candle before an up-move; bearish OB inverse.
- **Mitigation** — price returning to an FVG or OB. Mitigated = price has touched; unmitigated = still pristine.
- **Killzone** — a session window where institutional flow concentrates (London Open, NY AM, NY PM). Setups inside killzones rate higher.
- **IPDA** — Interbank Price Delivery Algorithm. ICT's framing for "what drives price"; for our purposes, the higher-TF range and PD arrays.
- **Bias** — directional thesis for the day. Pulled from labels like "Bias Long" / "Bias Short" in `pine.labels`.
- **Displacement** — strong directional move that creates an FVG. Signals intent.
- **Sweep / liquidity raid** — wick above a swing high (or below a swing low) that reverses. Confirms a level was liquidity, not breakout.

## Status

- Scaffolding pushed (README + .gitignore on `main`).
- CLI vendored under `cli/` and `packages/core/`, ports patched to 9223, `brief`/`session` commands removed, dead `morning.js`/`paths.js` deleted from core.
- Custom command `tv analyze` and slash command `/analyze` in place.
- Trading strategy is **TBD** — user will provide after this scaffold is reviewed.

## Open questions for the user

(To be answered after the scaffold PR is reviewed.)

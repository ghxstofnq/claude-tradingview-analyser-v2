# claude-tradingview-analyser

Standalone TradingView chart analyzer driven by Claude. Reads live chart state through a vendored `tv` CLI and produces structured analysis.

## Status

Scaffolding only. Functional scope still to be defined.

## Architecture

- **CLI-only.** All TradingView interaction goes through the vendored `tv` CLI under `cli/`. No MCP tool usage anywhere in this project.
- **CDP port 9223, exclusively.** The vendored CLI is locked to TradingView Desktop's CDP port 9223. Port 9222 is reserved for other projects on this machine and is never touched.
- **Self-contained.** Independent of `~/Documents/ai-trading-agent` and `~/tradingview-mcp-ict`. The CLI is vendored as a fork — fixes and additions live here, never upstream.
- **Local state only.** Project state lives under `./state/`. The shared `~/.tradingview-mcp/` directory is never written to.

## Requirements

- macOS
- TradingView Desktop launched with `--remote-debugging-port=9223`
- Node 18+

## Layout

```
cli/         vendored tv CLI (commands + core), pinned to port 9223
state/       project-local persisted state (gitignored)
scripts/     analysis entrypoints
```

## Usage

### Clone / install on a second computer

```bash
git clone https://github.com/ghxstofnq/claude-tradingview-analyser-v2.git
cd claude-tradingview-analyser-v2
npm install
npm test
npm run replay
```

Expected replay headline:

```text
Replay accuracy — 11 case(s)
  false candidates     0
  missed valid setups  0
  wrong model          0
  wrong side           0
  wrong packet         0
```

### Launch TradingView for this project

Use a dedicated TradingView Desktop instance on CDP `9223`; do not point this project at the main `9222` chart.

```bash
open -na "TradingView" --args --remote-debugging-port=9223 \
  --user-data-dir="$HOME/Library/Application Support/TradingView-Hermes-9223"
```

Then in TradingView:

1. Open an MNQ or MES chart, e.g. `CME_MINI:MNQ1!` or `CME_MINI:MES1!`.
2. Use `1m`, `5m`, or `15m` for live entry work.
3. Load the ICT Engine table/study expected by the analyzer.
4. Make sure TradingView Bar Replay is **off** before live trading.

### Live startup health gate

Run this before the session:

```bash
./bin/tv live-check --session ny-am
```

It must return:

```json
{
  "ok": true,
  "status": "ready",
  "blockers": []
}
```

Blocked readiness is not an ordinary no-trade. It means **do not evaluate the setup** until the source issue is fixed. Common blockers:

- `cdp_unreachable` — TradingView is not reachable on port `9223`.
- `tradingview_api_unavailable` — chart API is not exposed yet; reload/wait.
- `chart_symbol_not_mnq_mes` — wrong chart symbol.
- `unexpected_timeframe` — wrong chart timeframe.
- `ict_engine_study_missing_or_unknown` / `missing_ict_engine_rows` — ICT Engine table not available.
- `unsupported_ict_schema` — indicator schema changed.
- `stale_source` — engine rows are stale.
- `replay_active` — TradingView replay is on; live candidate output is blocked.
- `bars_not_updating` — latest bar is too old or missing.
- `session_not_tradable` — session option is not `ny-am`, `ny-pm`, or `london`.

### Live dry-run

Manual-first dry-run performs one readiness-gated tick and can append the result to session logs:

```bash
./bin/tv live-dry-run --session ny-am --out state/session/live-dry-run.jsonl
```

Rules:

- If readiness is blocked, output is `finalVerdict: "cannot_evaluate_source_health"` and `actionable: false`.
- If readiness is clean but no deterministic packet exists, output is `finalVerdict: "no_trade"`.
- If a packet exists, dry-run reports it but still does not place trades.

### Deterministic packet evidence

Executable packets include an `evidenceAudit` object with:

- entry confirmation close timestamp/OHLC/source ref
- selected structural stop rule/anchor/source ref
- rejected alternative stops and reasons
- TP1 label/price/source ref/R multiple
- grade blockers when the packet is blocked

The LLM/dashboard may explain this packet, but must not change entry, stop, target, model, side, or grade.

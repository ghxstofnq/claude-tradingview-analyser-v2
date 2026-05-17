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

Pending scope decision.

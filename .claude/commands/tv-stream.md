# /tv-stream — stream chart changes (the live-session driver)

Emit JSONL as the chart updates (TV Desktop, CDP 9225). Pipe into a Claude Code **Monitor** to
react per event — this is how a live session runs.

## Commands
- `./bin/tv stream bar-close` — **one JSON line per CLOSED bar**, time-aligned (sleeps to the bar
  boundary, polls fast just after close; flags 5m closes when the chart is on 1m). The
  LLM-driven session's heartbeat. Writes `state/session/detector-heartbeat.json` each poll and
  appends `state/session/<date>/bar-close-events.jsonl`.
- `./bin/tv stream quote | bars | values | lines | labels | tables [-i <ms>] [-f <study>]` —
  continuous reads at a poll interval.

## Live session pattern
- `Monitor("./bin/tv stream bar-close")` → each line is a bar close; on each, run the walker chain
  / `/analyze` for that bar. Quiet 1m bars can skip the LLM; act on packets / 5m closes.
- Run `./bin/tv dash` (read-only TUI, reads disk only — never touches CDP) in another terminal for
  live oversight: detector status, recent closes, session files, setups.
- Heartbeat older than ~120s during a session = the detector is dead → restart it (the
  session-supervisor does this automatically in the app).

## Note
Streaming reads the chart continuously; don't run it at the same time as a replay/record-tape on
the same chart (they fight for the chart state).

# /tv-replay — replay a historical session and read engine evidence reliably

Step TV Desktop's bar replay across a past session (CDP 9225) and read the schema-4 ICT
Engine evidence at each bar — for hand-grading / oracle work. The replay path is wedge-prone
and the engine can read stale; this skill encodes the recovery + freshness discipline so the
reads are trustworthy. Run **/tv-health first** (a reload must restore "ICT Engine V4" schema-4,
or you'll grade on schema-2). All `./bin/tv`; the reliable bits are lib functions driven from a
small node probe importing the worktree's `packages/core/*` + `cli/lib/*`.

## The reliable replay loop
1. **Reload before EVERY replay session** — `freshChartForReplay({leader, timeframe})`
   (`cli/lib/replay-recovery.js`; raw CDP `Page.reload`). Reusing a chart that already ran one
   replay+stop wedges the next `replay.start` into "symbol doesn't exist" — ONLY a page reload
   clears it (the replay API can't). 1m and 5m must be two separate reload-fresh sessions (no
   mid-replay TF switching) — the tape recorder's two-pass pattern.
2. **Start:** `replay.start({date:"YYYY-MM-DD", time:"HH:MM"})` — `time` is ET (`09:30` = NY open;
   no time = midnight UTC = 8 PM ET prior day). Verify `replay.status()` shows started.
3. **Lock ETH after the reload** — `chart.setExtendedHours(true)`. A reload can reset the session
   to "regular", hiding overnight (Asia/London) bars Lanto reads.
4. **Step:** `replay.step()` advances one bar at the chart TF. Sleep ~0.9–1.5s between steps for
   the engine to recompute.
5. **Stop + restore (ALWAYS):** `replay.stop()` at the end. Leaving TV in replay poisons the next
   live capture — verify `replay.status()` is stopped + chart back on live before finishing.

## Freshness — trust the evidence
- The engine **IS fresh** during replay: `engine.meta.bar_ms === quote.time * 1000` at every step.
- `engine.meta.emit_ny` is **WALL-CLOCK** (when the table cell was written), NOT the bar time —
  do NOT read it as staleness (that misread cost time on 2026-06-22).
- Confirm `engine.schema === 4` on each read.

## Reading + grading
- Parse: `parseIctEngineTable(findIctEngineRows(data.getPineTables()))` → levels / sweeps / fvgs /
  bprs / swings / structures / quality (incl. `overnight_dir`, `or_high/low`, `regime`,
  `range_vs_normal`).
- **Grade the FULL move:** extend the step window past the open chop until structure resolves,
  and read the full `structures[]` event list — NOT just `most_recent_structure`. The 2026-06-16
  miss: a window ending 10:15 missed the 10:20 breakdown and mis-graded a B-short as no-trade.

## Producing a reusable tape
For oracle/regression tapes, `./bin/tv record-tape --label <label.json> --from HH:MM --to HH:MM`
wraps this loop (two-pass 1m+5m, emit-verified, wedge recovery) and writes
`tests/tapes/<date>-<session>.tape.json` (verified:false until hand-graded).

## Gotchas
- Wedge signal: the quote feed keeps ticking even when the pane is dead — use `chartHealth`
  (bar count) / `meta.bar_ms`, not `getQuote`, to detect recovery.
- Continuous futures (MNQ1!/MES1!) have full intraday replay history; equities/dated contracts
  are plan-limited.
- In the ctv-rebuild worktree, `./bin/tv` loads MAIN's `packages/core`; for worktree core changes,
  drive replay via direct-import probes of the worktree modules ([[worktree-shared-core-symlink]]).

Source: [Bar Replay — TradingView](https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/).

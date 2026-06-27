#!/usr/bin/env node
// Record a multi-session corpus in ONE long-lived process — the same anti-wedge
// protocol the backtest popover uses (one persistent process, freshChartForReplay
// reloads+pins before every replay session). Firing run-backtest-headless.js once
// per date spawns a fresh process each time; the 2nd CDP attach wedges the chart
// ("symbol doesn't exist"). Looping runBacktest in-process avoids that.
//
// Usage: BACKTEST_LEADER=MNQ node scripts/record-corpus-batch.mjs ny-am 2026-06-15 2026-06-16 ...
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { PROD_DEPS, STATE_DIR } from "../app/main/backtest-deps.js";

const [session = "ny-am", ...dates] = process.argv.slice(2);
if (!dates.length) { console.error("usage: record-corpus-batch.mjs <session> <date...>"); process.exit(2); }

const bus = new EventEmitter();
bus.on("backtest:event", (e) => {
  if (e.type === "setup_surfaced") console.log(`    [setup] ${e.setup.grade} ${e.setup.model} ${e.setup.side} @ ${e.setup.event_ts}`);
  else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  else if (e.type === "error") console.error(`    [error] ${e.message}`);
});

const results = [];
for (const date of dates) {
  const t0 = Date.now();
  process.stdout.write(`>>> ${date} ${session} ... `);
  try {
    const { runId, summary } = await runBacktest({ date, session, mode: "auto", bus, stateDir: STATE_DIR, deps: PROD_DEPS });
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`ok ${runId} bars=${summary.bars} setups=${summary.setups} R=${summary.total_r} chain=${summary.chain_status} interaction=${summary.open_reaction?.interaction ?? "-"} (${secs}s)`);
    results.push({ date, ok: true, ...summary });
  } catch (err) {
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`FAILED (${secs}s): ${err.message}`);
    results.push({ date, ok: false, error: err.message });
  }
}
console.log(`\n=== DONE ${results.filter((r) => r.ok).length}/${results.length} ok ===`);
process.exit(0);

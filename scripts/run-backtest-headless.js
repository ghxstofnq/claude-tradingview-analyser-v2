#!/usr/bin/env node
// Headless deterministic backtest — same engine + production deps as the
// popover (app/main/backtest-deps.js), runnable from a plain node process.
// Used for proof runs and for debugging popover failures with the error
// visible in the terminal instead of the renderer event stream.
//
// Usage: node scripts/run-backtest-headless.js <YYYY-MM-DD> <ny-am|ny-pm|london> [auto|pause]
// Requires: TV Desktop running with --remote-debugging-port=9225, the app
// NOT mid-backtest (one chart, one driver).

import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { PROD_DEPS, STATE_DIR } from "../app/main/backtest-deps.js";

const [date, session = "ny-am", mode = "auto"] = process.argv.slice(2);
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node scripts/run-backtest-headless.js <YYYY-MM-DD> <ny-am|ny-pm|london> [auto|pause]");
  process.exit(2);
}

const bus = new EventEmitter();
let lastPhase = null;
bus.on("backtest:event", (e) => {
  switch (e.type) {
    case "start":
      console.log(`[run] ${e.runId} ${e.date} ${e.session} mode=${e.mode}`);
      break;
    case "progress":
      if (e.phase !== lastPhase || e.bar % 15 === 0 || e.bar === e.total) {
        console.log(`[${e.phase}] bar ${e.bar}${e.total ? `/${e.total}` : ""}`);
        lastPhase = e.phase;
      }
      break;
    case "setup_surfaced":
      console.log(`[setup] ${e.setup.grade} ${e.setup.model} ${e.setup.side} entry=${e.setup.entry} stop=${e.setup.stop} tp1=${e.setup.tp1} @ ${e.setup.event_ts}`);
      break;
    case "setup_outcome":
      console.log(`[outcome] ${e.setupId}: ${e.outcome} exit=${e.exit}`);
      break;
    case "paused":
      // Headless runs are proof runs — auto-accept on pause so the run
      // never hangs waiting for a renderer that isn't there.
      console.log(`[paused] auto-accepting ${e.setup.id}`);
      bus.emit("backtest:command", { type: "decision", choice: "accept" });
      break;
    case "error":
      console.error(`[error] ${e.message}`);
      break;
    case "done":
      break;
    default:
      break;
  }
});

try {
  const { runId, summary } = await runBacktest({
    date, session, mode, bus, stateDir: STATE_DIR, deps: PROD_DEPS,
  });
  console.log(`\n[done] ${runId}`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
} catch (err) {
  console.error(`\n[failed] ${err.stack ?? err.message}`);
  process.exit(1);
}

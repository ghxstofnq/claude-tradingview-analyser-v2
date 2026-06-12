#!/usr/bin/env node
// Re-fold a recorded backtest run through the engine WITHOUT re-recording —
// the tape.json entries + brief-payloads.json already carry everything the
// fold needs. Seconds instead of a 7-minute replay re-record; no chart
// access at all. Output goes to state/backtest-refold/ so real runs are
// never overwritten.
//
// Usage: node scripts/refold-run.js <run-id> [session]

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const [runId, session = "ny-am"] = process.argv.slice(2);
if (!runId) {
  console.error("Usage: node scripts/refold-run.js <run-id> [session]");
  process.exit(2);
}

const runDir = path.join(REPO_ROOT, "state", "backtest", runId, session);
const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
const payloads = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));

const bus = new EventEmitter();
bus.on("backtest:event", (e) => {
  if (e.type === "setup_surfaced") {
    console.log(`[setup] ${e.setup.grade} ${e.setup.model} ${e.setup.side} entry=${e.setup.entry} stop=${e.setup.stop} tp1=${e.setup.tp1} @ ${e.setup.event_ts}`);
  } else if (e.type === "setup_outcome") {
    console.log(`[outcome] ${e.setupId}: ${e.outcome} exit=${e.exit}`);
  } else if (e.type === "error") {
    console.error(`[error] ${e.message}`);
  }
});

const deps = {
  recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
  loadDayContext: async () => null,
  runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
  truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
  gradeFn: gradeOpenTrade,
};

const { summary } = await runBacktest({
  date: tape.date, session, mode: "auto", bus,
  stateDir: path.join(REPO_ROOT, "state", "backtest-refold"), deps,
});
console.log(JSON.stringify(summary, null, 2));

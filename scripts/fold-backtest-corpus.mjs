// Fold EVERY foldable backtest run (tape.json + brief-payloads.json) through
// runBacktest with the current code, summing R. Run old-vs-new (git stash) to
// confirm a change's impact across the whole backtest corpus. Machine-readable
// output: one "RUN <id> <session> <r>" line per run, then "TOTAL <r>".
//
// Usage: node scripts/fold-backtest-corpus.mjs [absoluteBacktestDir]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BT = process.argv[2] || path.join(REPO_ROOT, "state", "backtest");

async function foldRun(runDir, date, session) {
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
  const bus = new EventEmitter();
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  const { summary } = await runBacktest({ date: tape.date ?? date, session, mode: "auto", bus, stateDir: "/tmp/fold-bt-corpus", deps });
  return summary.total_r ?? 0;
}

const dirs = fs.readdirSync(BT).filter((d) => /^2026\d{4}-/.test(d) && !fs.lstatSync(path.join(BT, d)).isSymbolicLink()).sort();
let total = 0, n = 0, errs = 0;
for (const d of dirs) {
  for (const session of ["ny-am", "ny-pm", "london"]) {
    const runDir = path.join(BT, d, session);
    if (!fs.existsSync(path.join(runDir, "tape.json")) || !fs.existsSync(path.join(runDir, "brief-payloads.json"))) continue;
    const date = (d.match(/-(\d{4}-\d{2}-\d{2})$/) || [])[1] || d;
    try {
      const r = await foldRun(runDir, date, session);
      total += r; n += 1;
      console.log(`RUN ${d} ${session} ${r}`);
    } catch (e) {
      errs += 1;
      console.log(`ERR ${d} ${session} ${e.message}`);
    }
  }
}
console.log(`TOTAL ${Math.round(total * 100) / 100}  runs=${n}  errors=${errs}`);

// Fold backtest runs through runBacktest with the current code, summing R.
// Run old-vs-new (an env toggle on the change, or git stash) to measure a
// change's impact across the corpus. Machine-readable output: one
// "RUN <id> <session> <symbol> <r>" line per run, then "TOTAL ...".
//
// ONE SYMBOL AT A TIME. The backtest corpus mixes symbols (MNQ runs and MES
// runs sit side by side); pooling them is meaningless. Always pass --symbol.
//
// Usage:
//   node scripts/fold-backtest-corpus.mjs <state/backtest dir> --symbol MNQ1!
//   node scripts/fold-backtest-corpus.mjs <dir> --symbol MES1! --dates 2026-06-09,2026-06-10
//
// The positional dir lets a worktree fold the MAIN checkout's data:
//   node scripts/fold-backtest-corpus.mjs /abs/path/state/backtest --symbol MNQ1!
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
let BT = null;
let SYMBOL = null;
let DATES = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--symbol") { SYMBOL = argv[i + 1]; i += 1; }
  else if (argv[i] === "--dates") { DATES = new Set(argv[i + 1].split(",").map((s) => s.trim())); i += 1; }
  else if (!argv[i].startsWith("--")) BT = argv[i];
}
BT = BT || path.join(REPO_ROOT, "state", "backtest");

// The reliable per-run symbol is the recorded leader (brief.json is often
// stale/secondary). tape.entries[0].inputs.leader, falling back to the payload.
function runSymbol(tape, payloads) {
  return tape?.entries?.[0]?.inputs?.leader
    ?? (Array.isArray(payloads) ? payloads[0]?.symbol : payloads?.symbol)
    ?? "?";
}

async function foldRun(tape, payloads, date, session) {
  const bus = new EventEmitter();
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  // Fresh stateDir per run, removed right after — otherwise every run's output
  // (multi-MB tape/packets) piles up under a fixed path.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fold-bt-"));
  try {
    const { summary } = await runBacktest({ date: tape.date ?? date, session, mode: "auto", bus, stateDir, deps });
    return summary.total_r ?? 0;
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

if (!SYMBOL) {
  console.log("WARNING: no --symbol given — folding ALL symbols pooled (meaningless). Pass --symbol MNQ1! or --symbol MES1!.");
}

const dirs = fs.readdirSync(BT).filter((d) => /^2026\d{4}-/.test(d) && !fs.lstatSync(path.join(BT, d)).isSymbolicLink()).sort();
let total = 0, n = 0, errs = 0;
const bySymbol = {};
for (const d of dirs) {
  for (const session of ["ny-am", "ny-pm", "london"]) {
    const runDir = path.join(BT, d, session);
    if (!fs.existsSync(path.join(runDir, "tape.json")) || !fs.existsSync(path.join(runDir, "brief-payloads.json"))) continue;
    let tape, payloads;
    try {
      tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
      payloads = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
    } catch { continue; }
    const symbol = runSymbol(tape, payloads);
    const date = (d.match(/-(\d{4}-\d{2}-\d{2})$/) || [])[1] || d;
    if (SYMBOL && symbol !== SYMBOL) continue;
    if (DATES && !DATES.has(date)) continue;
    try {
      const r = await foldRun(tape, payloads, date, session);
      total += r; n += 1;
      bySymbol[symbol] = Math.round(((bySymbol[symbol] || 0) + r) * 100) / 100;
      console.log(`RUN ${d} ${session} ${symbol} ${r}`);
    } catch (e) {
      errs += 1;
      console.log(`ERR ${d} ${session} ${e.message}`);
    }
  }
}
const scope = SYMBOL ? `symbol=${SYMBOL}` : `symbols=${JSON.stringify(bySymbol)}`;
console.log(`TOTAL ${Math.round(total * 100) / 100}  runs=${n}  ${scope}  errors=${errs}`);

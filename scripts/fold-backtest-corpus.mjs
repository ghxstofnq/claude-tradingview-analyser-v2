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
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";

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

// Older runs (pre-brief-payloads.json format) carry no payloads/bundle file,
// but the tape EMBEDS the session-anchor bundle (brief_digest + gates.engine)
// in entries[0].inputs.bundle. Rebuild the brief payloads from it so the 5-week
// MNQ corpus folds. Precedence: on-disk payloads → brief-bundle.json → tape bundle.
function loadPayloads(runDir, tape, session, symbol) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8")); } catch { /* rebuild */ }
  let bundle = null;
  try { bundle = JSON.parse(fs.readFileSync(path.join(runDir, "brief-bundle.json"), "utf8")); } catch { /* next */ }
  if (!bundle) bundle = tape?.entries?.[0]?.inputs?.bundle ?? null;
  if (!bundle) return null;
  if (!bundle.brief_digest) {
    try { bundle.brief_digest = buildBriefDigest({ pair: { symbols: bundle?.pair?.symbols ?? { [symbol]: bundle } } }); } catch { return null; }
  }
  try { return buildDirectSessionBriefPayloads({ session, bundle, symbols: [symbol] }); } catch { return null; }
}

// Pre-brief-payloads runs (the 5-week MNQ corpus) have no payloads/bundle file
// and an empty embedded digest — but every tape entry carries the resolved
// per-bar context (session_state.pillar1.primaryDraw + untaken_targets), which
// is what the truth fn actually folds on. Build the day context straight from
// the first entry that carries a draw; bias starts null and the engine resolves
// the open reaction per bar exactly as a direct-brief run does.
function contextFromTape(tape, session) {
  const e = tape?.entries?.find((x) => x?.inputs?.session_state?.pillar1?.primaryDraw) ?? tape?.entries?.[0];
  const ins = e?.inputs ?? {};
  return {
    session,
    leader: ins.leader ?? null,
    ltf_bias_context: { bias: null, htf_ltf_alignment: "unclear", is_retrace_day: false, entry_model_priority: "undecided", grade_cap: "B" },
    session_state: ins.session_state ?? { pillar1: {}, pillar2: {} },
    untaken_targets: ins.untaken_targets ?? { untaken_above: [], untaken_below: [] },
    brief_digest: { htf_destination: {}, primary_draw: {} },
  };
}

function buildRunContext(runDir, tape, session, symbol) {
  const payloads = loadPayloads(runDir, tape, session, symbol);
  if (payloads) {
    const c = contextFromBriefPayloads({ session, payloads });
    if (c) return c;
  }
  return contextFromTape(tape, session);
}

async function foldRun(tape, context, date, session) {
  const bus = new EventEmitter();
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => context,
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
    if (!fs.existsSync(path.join(runDir, "tape.json"))) continue;
    let tape;
    try { tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8")); } catch { continue; }
    if (!tape?.entries?.length) continue;
    const symbol = runSymbol(tape, null);
    const date = (d.match(/-(\d{4}-\d{2}-\d{2})$/) || [])[1] || d;
    if (SYMBOL && symbol !== SYMBOL) continue;
    if (DATES && !DATES.has(date)) continue;
    const context = buildRunContext(runDir, tape, session, symbol);
    if (!context) { console.log(`SKIP ${d} ${session} ${symbol} no-context`); continue; }
    try {
      const r = await foldRun(tape, context, date, session);
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

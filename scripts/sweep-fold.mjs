// Read-only FAITHFUL corpus fold — the number the BACKTEST popover shows.
//
// Folds every registered backtest run for ONE symbol through runBacktest with
// self-healing brief regen + AM->PM carry (same path as save-fold-baseline.mjs)
// and prints TOTAL R + wins/losses/break-even + win-rate (BE excluded). Unlike
// the two sibling fold tools this one is the right baseline for a PARAMETER
// SWEEP: run it old-vs-new (edit a constant in a throwaway worktree, re-run)
// and compare the totals.
//
//   - save-fold-baseline.mjs : same carry+regen but WRITES state/backtest/index
//                              (mutating — not for repeatable sweeps).
//   - fold-backtest-corpus.mjs: read-only but NO carry (~+59R, understates;
//                              timing-sensitive knobs behave differently).
//   - this script            : read-only AND carry+regen (the faithful +117R/
//                              +67R) AND win/loss counts. Mutates nothing.
//
// ONE SYMBOL AT A TIME (the corpus mixes MNQ and MES runs; pooling is
// meaningless). The positional dir lets a worktree fold the MAIN checkout's
// data while testing edited code:
//   node scripts/sweep-fold.mjs /abs/path/state/backtest --symbol MNQ1!
//   node scripts/sweep-fold.mjs --symbol MES1!            # defaults to this repo
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as barCloseTruth } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
let BT = null;
let SYMBOL = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--symbol") { SYMBOL = argv[i + 1]; i += 1; }
  else if (!argv[i].startsWith("--")) BT = argv[i];
}
BT = BT || path.join(REPO_ROOT, "state", "backtest");
if (!SYMBOL) {
  console.error("usage: node scripts/sweep-fold.mjs [state/backtest dir] --symbol MNQ1!");
  process.exit(2);
}

const idx = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
const r2 = (n) => Math.round(n * 100) / 100;

function runLeader(runDir) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; }
}
function findRun(date, session) {
  const tag = `-${session.replace("ny-", "")}-${date}`;
  const cands = fs.readdirSync(BT).filter((d) => d.includes(tag)).sort();
  for (const d of [...cands].reverse()) if (runLeader(path.join(BT, d, session)) === SYMBOL) return d;
  return null;
}
function regen(runDir, session) {
  const bp = path.join(runDir, "brief-bundle.json");
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8")); } catch { /* regen */ }
  if (!fs.existsSync(bp)) return rec;
  const bundle = JSON.parse(fs.readFileSync(bp, "utf8"));
  const leader = rec?.[0]?.symbol || SYMBOL;
  const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
  return buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] });
}
function pmCarry(date) {
  const run = findRun(date, "ny-pm"); if (!run) return [];
  try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; }
}
async function foldSession(runId, date, session) {
  const runDir = path.join(BT, runId, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = regen(runDir, session); if (!payloads) return null;
  const surfaced = new Map(); const booked = []; const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = surfaced.get(e.setupId) || {};
      const risk = Math.abs(Number(s.entry) - Number(s.stop));
      const signed = r2((s.side === "long" ? Number(e.exit) - Number(s.entry) : Number(s.entry) - Number(e.exit)) / (risk || 1));
      booked.push(e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? signed : 0);
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  // Fresh temp stateDir per session, removed right after — nothing under the
  // folded checkout's state/ is touched (read-only on the corpus).
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-fold-"));
  try {
    const { summary } = await runBacktest({ date: tape.date, session, mode: "auto", bus, stateDir: sd, deps, carryEntries: session === "ny-am" ? pmCarry(date) : [] });
    return {
      total_r: r2(summary.total_r || 0),
      wins: booked.filter((x) => x > 0).length,
      losses: booked.filter((x) => x < 0).length,
      be: booked.filter((x) => x === 0).length,
    };
  } finally { fs.rmSync(sd, { recursive: true, force: true }); }
}

let total = 0, wins = 0, losses = 0, be = 0, n = 0;
for (const entry of idx.runs) {
  if (entry.symbol !== SYMBOL) continue;
  const res = await foldSession(entry.run_id, entry.date, entry.session);
  if (!res) continue;
  total += res.total_r; wins += res.wins; losses += res.losses; be += res.be; n += 1;
}
const decided = wins + losses;
const wr = decided ? Math.round((100 * wins) / decided) : 0;
console.log(`${SYMBOL}  TOTAL=${r2(total)}R  runs=${n}  W=${wins} L=${losses} BE=${be}  winrate=${wr}% (BE excl)`);

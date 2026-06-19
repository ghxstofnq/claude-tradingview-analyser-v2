// Refresh a symbol's registered backtest runs with the canonical fold-week
// result (self-healing brief regen + AM->PM carry) so the backtest popover
// shows the real baseline instead of the understated generation-time numbers.
// Writes total_r / wins / losses + a `refold_baseline` marker into
// state/backtest/index.json and each run's summary.json. Run from the repo root.
//   node scripts/save-fold-baseline.mjs            # MES1! (default)
//   node scripts/save-fold-baseline.mjs MNQ1!      # a specific symbol
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BT = path.join(REPO, "state", "backtest");
const SYMBOL = process.argv[2] || "MES1!";
const idxPath = path.join(BT, "index.json");
const index = JSON.parse(fs.readFileSync(idxPath, "utf8"));
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
    truthFn: bc.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "save-mes-"));
  try {
    const { summary } = await runBacktest({ date: tape.date, session, mode: "auto", bus, stateDir: sd, deps, carryEntries: session === "ny-am" ? pmCarry(date) : [] });
    return { total_r: r2(summary.total_r || 0), wins: booked.filter((x) => x > 0).length, losses: booked.filter((x) => x < 0).length, setups: booked.length };
  } finally { fs.rmSync(sd, { recursive: true, force: true }); }
}

let total = 0, updated = 0;
for (const entry of index.runs) {
  if (entry.symbol !== SYMBOL) continue;
  const res = await foldSession(entry.run_id, entry.date, entry.session);
  if (!res) continue;
  entry.total_r = res.total_r; entry.wins = res.wins; entry.losses = res.losses; entry.setups = res.setups;
  entry.refold_baseline = "fold-week-2026-06-19";
  total += res.total_r; updated += 1;
  try {
    const sp = path.join(BT, entry.run_id, entry.session, "summary.json");
    const sum = JSON.parse(fs.readFileSync(sp, "utf8"));
    sum.total_r = res.total_r; sum.wins = res.wins; sum.losses = res.losses; sum.refold_baseline = entry.refold_baseline;
    fs.writeFileSync(sp, JSON.stringify(sum, null, 2));
  } catch { /* best-effort */ }
}
fs.writeFileSync(idxPath, JSON.stringify(index, null, 2));
console.log(`updated ${updated} ${SYMBOL} runs; fold-week ${SYMBOL} baseline total = ${r2(total)}R`);

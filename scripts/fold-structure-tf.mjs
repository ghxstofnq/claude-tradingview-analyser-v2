// fold-structure-tf.mjs — fold the MNQ corpus under the 1m-vs-5m structure grid.
//
// Faithful fold (carry + regen — same path as the +118.08R baseline). Runs three
// variants by flipping the STRUCTURE_TF / STOP_TF env the walker reads at call
// time:
//   A  1m/1m            (baseline — must reproduce ~118.08R as a sanity gate)
//   B  str5m / stop1m
//   C  str5m / stop5m
//
// Reports per-variant total R, win-days, -3R days, and the per-session diff so
// the false-structure losers that clean up (or new ones that appear) are visible.
//
// Run from the worktree (has the 5m walker). BT = main checkout's state/backtest.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const SYM = "MNQ1!";
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BT = arg("bt", "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2/state/backtest");
const r2 = (n) => Math.round(n * 100) / 100;
const idx = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };
function findRun(date, session) { const tag = `-${session.replace("ny-", "")}-${date}`; for (const d of fs.readdirSync(BT).filter((x) => x.includes(tag)).sort().reverse()) if (leaderOf(path.join(BT, d, session)) === SYM) return d; return null; }
function regen(runDir, session) { const bp = path.join(runDir, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const bundle = JSON.parse(fs.readFileSync(bp, "utf8")); const leader = rec?.[0]?.symbol || SYM; const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } }); return buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] }); }
function pmCarry(date) { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } }

async function foldSession(entry) {
  const runDir = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = regen(runDir, entry.session);
  if (!payloads) return null;
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads });
  const booked = []; const bus = new EventEmitter(); const surfaced = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") { const s = surfaced.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop); booked.push(e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0); }
    else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "grid-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); }
  finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return r2(booked.reduce((a, b) => a + b, 0));
}

async function foldVariant(label, env) {
  for (const k of ["GOFNQ_STRUCTURE_TF", "GOFNQ_STOP_TF"]) delete process.env[k];
  Object.assign(process.env, env);
  const per = new Map(); let total = 0, wins = 0; const neg3 = [];
  for (const entry of idx.runs) {
    if (entry.symbol !== SYM) continue;
    const r = await foldSession(entry);
    if (r == null) continue;
    const key = `${entry.date} ${entry.session}`;
    per.set(key, r); total = r2(total + r);
    if (r > 0) wins++; if (r <= -2.5) neg3.push(key);
  }
  for (const k of ["GOFNQ_STRUCTURE_TF", "GOFNQ_STOP_TF"]) delete process.env[k];
  return { label, total: r2(total), wins, neg3, per };
}

const A = await foldVariant("A 1m/1m        ", { GOFNQ_STRUCTURE_TF: "1" });
const B = await foldVariant("B str5m/stop1m ", { GOFNQ_STRUCTURE_TF: "5" });
const C = await foldVariant("C str5m/stop5m ", { GOFNQ_STRUCTURE_TF: "5", GOFNQ_STOP_TF: "5" });
const D = await foldVariant("D realign5m only", { GOFNQ_REALIGN_TF: "5" });

console.log("\n===== MNQ structure-TF fold grid =====");
for (const v of [A, B, C, D]) console.log(`${v.label}  R=${String(v.total).padStart(8)}  win-days=${v.wins}  -3R days=${v.neg3.length}`);
console.log(`\nbaseline sanity: A total ${A.total} (expect ~118.08)`);

console.log("\n===== B(open5m) & D(realign5m) vs A(1m) — sessions that CHANGED =====");
const keys = [...A.per.keys()].sort();
const wks = new Set();
for (const k of keys) {
  const a = A.per.get(k), b = B.per.get(k), d = D.per.get(k);
  if (a !== b || a !== d) {
    if (a !== b) wks.add(k.slice(0, 7)); // ISO month-week-ish: date prefix for robustness gauge
    console.log(`  ${k.padEnd(18)} A=${String(a).padStart(6)}  B=${String(b).padStart(6)}  D=${String(d).padStart(6)}`);
  }
}
const bUp = keys.filter((k) => B.per.get(k) > A.per.get(k));
const bDown = keys.filter((k) => B.per.get(k) < A.per.get(k));
console.log(`\nB (open read → 5m) vs A: ${bUp.length} up, ${bDown.length} down across ${new Set([...bUp, ...bDown].map((k) => k.slice(0, 7))).size} distinct dates  → A=${A.total}R B=${B.total}R (${r2(B.total - A.total)}R)`);
console.log(`B up dates:   ${bUp.join(", ")}`);
console.log(`B down dates: ${bDown.join(", ")}`);

// Fold the MNQ backtest corpus through the REAL chain (buildDeterministic-
// PacketTruthFromInputs + runBacktest), reading whatever GOFNQ_P1_* flags the
// production code honors. Run twice — flags off (baseline) vs on (lever) — to
// measure a Pillar-1 change old-vs-new. Reads the MAIN checkout's state/backtest
// so it sees the full recorded corpus regardless of which worktree runs it.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const SYM = "MNQ1!";
const BT = "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2/state/backtest";
const r2 = (n) => Math.round(n * 100) / 100;
const idx = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };
const findRun = (date, s) => { const tag = `-${s.replace("ny-", "")}-${date}`; for (const d of fs.readdirSync(BT).filter((x) => x.includes(tag)).sort().reverse()) if (leaderOf(path.join(BT, d, s)) === SYM) return d; return null; };
function regen(rd, s) { const bp = path.join(rd, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const b = JSON.parse(fs.readFileSync(bp, "utf8")); const ld = rec?.[0]?.symbol || SYM; return buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] }); }
const pmCarry = (date) => { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } };

async function foldSession(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return null;
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const booked = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") { const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop); booked.push(e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0); }
    else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "p1-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return r2(booked.reduce((a, b) => a + b, 0));
}

// trade-level tally needs the per-trade R list, not just the session sum
async function foldSessionTrades(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return null;
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const booked = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") { const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop); booked.push(e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0); }
    else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "p1t-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return booked;
}

const per = new Map(); let total = 0, wins = 0; const neg3 = [];
let tWin = 0, tLoss = 0, tBE = 0;
for (const e of idx.runs) {
  if (e.symbol !== SYM) continue;
  const trades = await foldSessionTrades(e); if (trades == null) continue;
  for (const t of trades) { if (t > 0) tWin++; else if (t < 0) tLoss++; else tBE++; }
  const r = r2(trades.reduce((a, b) => a + b, 0));
  const k = `${e.date} ${e.session}`; per.set(k, r); total = r2(total + r); if (r > 0) wins++; if (r <= -2.5) neg3.push(k);
}
const label = process.env.FOLD_LABEL || "fold";
if (process.env.FOLD_PERSESSION === "1") { for (const k of [...per.keys()].sort()) console.log(`  ${k.padEnd(18)} ${String(per.get(k)).padStart(8)}`); }
const tTot = tWin + tLoss + tBE;
const wr = tWin + tLoss > 0 ? Math.round(1000 * tWin / (tWin + tLoss)) / 10 : 0;
console.log(`[${label}]  R=${r2(total)}  win-days=${wins}  -3R days=${neg3.length}  (${per.size} sessions)  | trades=${tTot} W${tWin}/L${tLoss}/BE${tBE}  win%=${wr}`);
// machine-readable line for diffing two runs
console.log(`PERSESSION_JSON ${JSON.stringify([...per.entries()])}`);

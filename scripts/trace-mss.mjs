// Read-only: wrap the truth fn over the pinned corpus and trace MSS. For every
// bar, inspect truth.walkers + truth.packets by model. Answers: do MSS walkers
// EVER spawn? what stages do they reach? do MSS packets ever form? do they ever
// win bestPacket selection? Also tallies the spawn preconditions when context is
// reachable, to find which gate blocks MSS.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const SYM = "MNQ1!";
const MODEL = process.env.TRACE_MODEL || "MSS";
const BT = "/Users/anasqatanani/Documents/claude-tradingview-analyser-v2/state/backtest";
const idx = JSON.parse(fs.readFileSync(path.join(BT, "index.json"), "utf8"));
const SINCE = process.env.FOLD_SINCE, UNTIL = process.env.FOLD_UNTIL;
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };
const findRun = (date, s) => { const tag = `-${s.replace("ny-", "")}-${date}`; for (const d of fs.readdirSync(BT).filter((x) => x.includes(tag)).sort().reverse()) if (leaderOf(path.join(BT, d, s)) === SYM) return d; return null; };
function regen(rd, s) { const bp = path.join(rd, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const b = JSON.parse(fs.readFileSync(bp, "utf8")); const ld = rec?.[0]?.symbol || SYM; return buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] }); }
const pmCarry = (date) => { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } };

const PROG = ["watching", "pd_identified", "tap_seen", "confirmation_pending", "confirmed", "packet_ready"];
const T = {
  bars: 0, packetModels: new Map(), mssPackets: 0, mssBest: 0, evReasons: new Map(),
  mss: new Map(), // distinct walker id -> {prog, fate, reason, ses}
};
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
function noteMss(w, ses) {
  const r = T.mss.get(w.id) ?? { prog: -1, fate: "live", reason: null, ses };
  const pi = PROG.indexOf(w.stage);
  if (pi > r.prog) r.prog = pi;
  if (w.stage === "blocked" || w.stage === "expired") { r.fate = w.stage; r.reason = w.reason ?? w.killReason ?? w.blockReason ?? w.note ?? r.reason; }
  else if (w.stage === "packet_ready") r.fate = "packet_ready";
  T.mss.set(w.id, r);
}

async function foldOne(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return;
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return;
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const sesKey = `${entry.date} ${entry.session}`;
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => { if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" }); });
  const wrapped = async (args) => {
    const t = await bc.buildDeterministicPacketTruthFromInputs(args);
    T.bars++;
    for (const w of t.walkers ?? []) { if (w.model === MODEL) noteMss(w, sesKey); }
    for (const p of t.packets ?? []) { bump(T.packetModels, p.model ?? "?"); if (p.model === MODEL) T.mssPackets++; }
    if (t.bestPacket?.model === MODEL) T.mssBest++;
    for (const ev of t.events ?? []) { const mdl = ev.walker?.model ?? ev.model; if (mdl === MODEL && (ev.reason || ev.type)) bump(T.evReasons, `${ev.type ?? "?"}:${ev.reason ?? "-"}`); }
    return t;
  };
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: wrapped, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "tmss-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
}

for (const e of idx.runs) { if (e.symbol !== SYM) continue; if (SINCE && e.date < SINCE) continue; if (UNTIL && e.date > UNTIL) continue; await foldOne(e); }

const show = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ") || "(none)";
const walkers = [...T.mss.values()];
console.log(`\n${MODEL} TRACE — ${T.bars} bars folded, ${walkers.length} DISTINCT ${MODEL} walkers spawned\n`);
console.log(`  furthest progression stage reached (distinct walkers):`);
for (let i = 0; i < PROG.length; i++) { const n = walkers.filter((w) => w.prog === i).length; if (n) console.log(`    reached-and-stopped-at ${PROG[i].padEnd(20)} ${n}`); }
const reachedTap = walkers.filter((w) => w.prog >= PROG.indexOf("tap_seen")).length;
const reachedConf = walkers.filter((w) => w.prog >= PROG.indexOf("confirmed")).length;
console.log(`\n  funnel: spawned ${walkers.length}  ->  tapped PD ${reachedTap}  ->  confirmed ${reachedConf}  ->  packets ${T.mssPackets}  ->  bestPacket ${T.mssBest}  ->  booked 0`);
console.log(`\n  terminal fate (distinct walkers):`);
const fate = new Map(); for (const w of walkers) bump(fate, w.fate);
console.log(`    ${show(fate)}`);
console.log(`\n  kill reasons (blocked/expired walkers):`);
const reasons = new Map(); for (const w of walkers) if (w.fate !== "live" && w.fate !== "packet_ready") bump(reasons, w.reason ?? "(no reason field)");
console.log(`    ${show(reasons)}`);
console.log(`  packet models formed (bar-instances): ${show(T.packetModels)}`);
console.log(`\n  MSS walker EVENTS (type:reason):\n    ${show(T.evReasons)}`);

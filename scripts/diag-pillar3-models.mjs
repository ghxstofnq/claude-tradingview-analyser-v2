// Read-only: fold the pinned corpus and break every trade down by Pillar-3 entry
// MODEL (MSS / Trend / Inversion): count, W/L/BE, R, win%, grade mix, and the
// winner/loser R profile per model. Parallel to the P1/P2 descriptive cuts.
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
const SINCE = process.env.FOLD_SINCE, UNTIL = process.env.FOLD_UNTIL;
const leaderOf = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; } };
const findRun = (date, s) => { const tag = `-${s.replace("ny-", "")}-${date}`; for (const d of fs.readdirSync(BT).filter((x) => x.includes(tag)).sort().reverse()) if (leaderOf(path.join(BT, d, s)) === SYM) return d; return null; };
function regen(rd, s) { const bp = path.join(rd, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const b = JSON.parse(fs.readFileSync(bp, "utf8")); const ld = rec?.[0]?.symbol || SYM; return buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] }); }
const pmCarry = (date) => { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } };

async function foldTrades(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return [];
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const out = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0;
      out.push({ model: String(s.model), grade: String(s.grade), side: s.side, R });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "p3-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return out;
}

const all = [];
for (const e of idx.runs) { if (e.symbol !== SYM) continue; if (SINCE && e.date < SINCE) continue; if (UNTIL && e.date > UNTIL) continue; all.push(...await foldTrades(e)); }

function stat(arr) {
  const w = arr.filter((t) => t.R > 0), l = arr.filter((t) => t.R < 0), be = arr.filter((t) => t.R === 0);
  const R = r2(arr.reduce((s, t) => s + t.R, 0));
  const wr = w.length + l.length ? Math.round(1000 * w.length / (w.length + l.length)) / 10 : 0;
  const avgW = w.length ? r2(w.reduce((s, t) => s + t.R, 0) / w.length) : 0;
  const avgL = l.length ? r2(l.reduce((s, t) => s + t.R, 0) / l.length) : 0;
  return { n: arr.length, w: w.length, l: l.length, be: be.length, R, wr, avgW, avgL };
}

console.log(`\nPILLAR 3 — by entry model (${all.length} trades):\n`);
console.log(`  model       trades   W/L/BE    win%      R     avgWin  avgLoss`);
for (const m of ["MSS", "Trend", "Inversion", "undefined", "null"]) {
  const g = all.filter((t) => t.model === m); if (!g.length) continue;
  const s = stat(g);
  console.log(`  ${m.padEnd(10)} ${String(s.n).padStart(5)}   ${`${s.w}/${s.l}/${s.be}`.padEnd(9)} ${String(s.wr).padStart(5)}%  ${String(s.R).padStart(7)}  ${String(s.avgW).padStart(6)}  ${String(s.avgL).padStart(6)}`);
}
const tot = stat(all);
console.log(`  ${"TOTAL".padEnd(10)} ${String(tot.n).padStart(5)}   ${`${tot.w}/${tot.l}/${tot.be}`.padEnd(9)} ${String(tot.wr).padStart(5)}%  ${String(tot.R).padStart(7)}`);

console.log(`\n  GRADE effectiveness (does A+ actually beat B?):`);
console.log(`  model.grade   trades   W/L/BE    win%      R     avgR   avgWin`);
for (const m of ["Trend", "Inversion"]) {
  for (const gr of ["A+", "B"]) {
    const g = all.filter((t) => t.model === m && t.grade === gr); if (!g.length) continue;
    const s = stat(g);
    const avgR = r2(s.R / s.n);
    console.log(`  ${`${m} ${gr}`.padEnd(12)} ${String(s.n).padStart(5)}   ${`${s.w}/${s.l}/${s.be}`.padEnd(9)} ${String(s.wr).padStart(5)}%  ${String(s.R).padStart(7)}  ${String(avgR).padStart(5)}  ${String(s.avgW).padStart(6)}`);
  }
}

console.log(`\n  side split per model:`);
for (const m of ["MSS", "Trend", "Inversion"]) {
  const g = all.filter((t) => t.model === m); if (!g.length) continue;
  const lo = stat(g.filter((t) => t.side === "long")), sh = stat(g.filter((t) => t.side === "short"));
  console.log(`    ${m.padEnd(10)} long ${lo.w}/${lo.l} R=${lo.R}   short ${sh.w}/${sh.l} R=${sh.R}`);
}

// Read-only: fold the full MNQ corpus per-trade, aggregate by ISO week + month,
// and compare what distinguishes PROFITABLE weeks from BLEEDING weeks — win rate
// vs winner SIZE (runner presence). Also pulls a per-session daily-move proxy
// (|daily change_pct| from the brief bundle) to test the trend-regime thesis.
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
let lastDailyChg = null;
function regen(rd, s) { const bp = path.join(rd, "brief-bundle.json"); let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(rd, "brief-payloads.json"), "utf8")); } catch {} if (!fs.existsSync(bp)) return null; const b = JSON.parse(fs.readFileSync(bp, "utf8")); lastDailyChg = Math.abs(Number(b?.bars_by_tf?.daily?.change_pct)); if (!Number.isFinite(lastDailyChg)) lastDailyChg = null; const ld = rec?.[0]?.symbol || SYM; return buildDirectSessionBriefPayloads({ session: s, bundle: { ...b, brief_digest: buildBriefDigest({ pair: { symbols: { [ld]: b } } }) }, symbols: [ld] }); }
const pmCarry = (date) => { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } };

async function foldTrades(entry) {
  const rd = path.join(BT, entry.run_id, entry.session);
  if (!fs.existsSync(path.join(rd, "tape.json"))) return { trades: [], dailyChg: null };
  const tape = JSON.parse(fs.readFileSync(path.join(rd, "tape.json"), "utf8"));
  const pl = regen(rd, entry.session); if (!pl) return { trades: [], dailyChg: null };
  const dailyChg = lastDailyChg;
  const ctx = contextFromBriefPayloads({ session: entry.session, payloads: pl });
  const out = []; const bus = new EventEmitter(); const sf = new Map();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sf.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") { const s = sf.get(e.setupId) || {}; const risk = Math.abs(s.entry - s.stop); const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2((s.side === "long" ? e.exit - s.entry : s.entry - e.exit) / risk) : 0; out.push({ date: entry.date, session: entry.session, grade: s.grade, R }); }
    else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null, runDirectBrief: async () => ctx, truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
  try { await runBacktest({ date: tape.date, session: entry.session, mode: "auto", bus, stateDir: sd, deps, carryEntries: entry.session === "ny-am" ? pmCarry(entry.date) : [] }); } finally { fs.rmSync(sd, { recursive: true, force: true }); }
  return { trades: out, dailyChg };
}

// Monday of a YYYY-MM-DD (ISO-week key)
const mondayOf = (d) => { const dt = new Date(d + "T12:00:00Z"); const wd = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - wd); return dt.toISOString().slice(0, 10); };

const all = []; const sessChg = []; // per-session daily-move proxy
for (const e of idx.runs) {
  if (e.symbol !== SYM) continue;
  const { trades, dailyChg } = await foldTrades(e);
  all.push(...trades);
  if (dailyChg != null) sessChg.push({ date: e.date, dailyChg });
}

function agg(keyFn, rows) {
  const m = new Map();
  for (const t of rows) { const k = keyFn(t.date); const o = m.get(k) || { R: 0, w: 0, l: 0, be: 0, winRs: [], aplus: 0, aplusW: 0 }; if (t.R > 0) { o.w++; o.winRs.push(t.R); } else if (t.R < 0) o.l++; else o.be++; if (t.grade === "A+") { o.aplus++; if (t.R > 0) o.aplusW++; } o.R = r2(o.R + t.R); m.set(k, o); }
  return m;
}
const fmt = (m, label) => {
  console.log(`\n=== ${label} ===`);
  console.log(`  period        R      n   W   L  win%  avgWin maxWin  runners(>=3)  A+share`);
  for (const k of [...m.keys()].sort()) {
    const o = m.get(k); const n = o.w + o.l + o.be; const wr = o.w + o.l ? Math.round(1000 * o.w / (o.w + o.l)) / 10 : 0;
    const avgWin = o.winRs.length ? r2(o.winRs.reduce((a, b) => a + b, 0) / o.winRs.length) : 0;
    const maxWin = o.winRs.length ? r2(Math.max(...o.winRs)) : 0;
    const runners = o.winRs.filter((x) => x >= 3).length;
    const aShare = n ? Math.round(100 * o.aplus / n) : 0;
    console.log(`  ${k}  ${String(o.R).padStart(7)} ${String(n).padStart(4)} ${String(o.w).padStart(3)} ${String(o.l).padStart(3)} ${String(wr).padStart(5)} ${String(avgWin).padStart(6)} ${String(maxWin).padStart(6)} ${String(runners).padStart(8)}      ${String(aShare).padStart(3)}%`);
  }
};
fmt(agg(mondayOf, all), "BY WEEK (Mon)");
fmt(agg((d) => d.slice(0, 7), all), "BY MONTH");

// Punchline: profitable weeks vs bleeding weeks — averaged signatures
const wk = agg(mondayOf, all);
const prof = [], bleed = [];
for (const o of wk.values()) { (o.R > 0 ? prof : bleed).push(o); }
function sig(arr) {
  const n = arr.length; if (!n) return "none";
  const avg = (f) => r2(arr.reduce((a, o) => a + f(o), 0) / n);
  const winRs = arr.flatMap((o) => o.winRs);
  const tradesW = arr.reduce((a, o) => a + o.w, 0), tradesL = arr.reduce((a, o) => a + o.l, 0);
  return `weeks=${n}  avgR=${avg((o) => o.R)}  win%=${tradesW + tradesL ? Math.round(1000 * tradesW / (tradesW + tradesL)) / 10 : 0}  avgWinR=${winRs.length ? r2(winRs.reduce((a, b) => a + b, 0) / winRs.length) : 0}  maxWinR=${winRs.length ? r2(Math.max(...winRs)) : 0}  runners/wk=${avg((o) => o.winRs.filter((x) => x >= 3).length)}  A+/wk=${avg((o) => o.aplus)}`;
}
console.log(`\n=== PROFITABLE vs BLEEDING WEEKS ===`);
console.log(`  PROFITABLE: ${sig(prof)}`);
console.log(`  BLEEDING  : ${sig(bleed)}`);

// daily-move proxy: avg |daily change_pct| on profitable-week dates vs bleeding
const profDates = new Set(), bleedDates = new Set();
for (const [k, o] of wk) { /* no-op: need per-date set */ }
const dateR = new Map(); for (const t of all) dateR.set(t.date, r2((dateR.get(t.date) || 0) + t.R));
const wkR = new Map(); for (const [d, R] of dateR) { const k = mondayOf(d); wkR.set(k, r2((wkR.get(k) || 0) + R)); }
const chgProf = [], chgBleed = [];
for (const { date, dailyChg } of sessChg) { const w = wkR.get(mondayOf(date)) ?? 0; (w > 0 ? chgProf : chgBleed).push(dailyChg); }
const mean = (a) => a.length ? r2(a.reduce((x, y) => x + y, 0) / a.length) : 0;
console.log(`\n=== DAILY-MOVE PROXY (|daily change_pct| at session anchor) ===`);
console.log(`  profitable-week sessions: avg ${mean(chgProf)}%  (n=${chgProf.length})`);
console.log(`  bleeding-week sessions  : avg ${mean(chgBleed)}%  (n=${chgBleed.length})`);

#!/usr/bin/env node
// Aggregate every trade across the recorded weeks (carry refold) and slice it
// by grade / model / side / session / time / anchor-vs-add / bias-alignment /
// runner-vs-banker / day, to surface descriptive patterns.
//   node scripts/analyze-patterns.mjs <date>...
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BT = path.join(REPO_ROOT, "state", "backtest");
const DATES = process.argv.slice(2);

const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a) => r2(a.reduce((s, v) => s + v, 0));
const etMin = (ts) => { const d = new Date(ts); return ((d.getUTCHours() + 20) % 24) * 60 + d.getUTCMinutes(); };
const hhmm = (ts) => { const d = new Date(ts); return String((d.getUTCHours() + 20) % 24).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function findRun(date, session) {
  try { return fs.readdirSync(BT).filter((d) => d.includes(`-${session.replace("ny-", "")}-${date}`)).sort().pop(); } catch { return null; }
}
function regen(runDir, session) {
  const rec = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
  const bp = path.join(runDir, "brief-bundle.json"); if (!fs.existsSync(bp)) return rec;
  const leader = rec[0]?.symbol || "MNQ1!";
  const bundle = JSON.parse(fs.readFileSync(bp, "utf8"));
  const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
  return buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] });
}
function pmCarry(date) {
  const run = findRun(date, "ny-pm"); if (!run) return [];
  try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; }
}
async function fold(date, session) {
  const run = findRun(date, session); if (!run) return null;
  const dir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(dir, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(dir, "tape.json"), "utf8"));
  const payloads = regen(dir, session);
  const bias = payloads[0]?.htf_bias_dir ?? null;
  const sm = new Map(); const trades = []; const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sm.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sm.get(e.setupId) || {};
      const risk = Math.abs(Number(s.entry) - Number(s.stop));
      const rr1 = risk ? Math.abs(Number(s.tp1) - Number(s.entry)) / risk : null;
      const signed = r2((s.side === "long" ? Number(e.exit) - Number(s.entry) : Number(s.entry) - Number(e.exit)) / (risk || 1));
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? signed : 0;
      const aligned = bias && ((bias === "bullish" && s.side === "long") || (bias === "bearish" && s.side === "short"));
      trades.push({ date, dow: DOW[new Date(date).getUTCDay()], session: session.replace("ny-", ""), grade: s.grade, model: s.model,
        side: s.side, add: !!s.scale_in_add, risk: r2(risk), rr1: rr1 == null ? null : r2(rr1),
        outcome: e.outcome, R, min: etMin(s.event_ts), t: hhmm(s.event_ts), aligned: !!aligned, bias });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const { summary } = await runBacktest({ date: tape.date, session, mode: "auto", bus,
    stateDir: path.join(REPO_ROOT, "state", "backtest-analyze"), deps, carryEntries: session === "ny-am" ? pmCarry(date) : [] });
  return { date, session, total_r: r2(summary.total_r), trades };
}

const all = [];
const sessionR = [];
for (const date of DATES) for (const s of ["ny-am", "ny-pm"]) {
  const f = await fold(date, s); if (!f) continue;
  sessionR.push({ key: `${date} ${s.replace("ny-", "")}`, dow: DOW[new Date(date).getUTCDay()], session: s.replace("ny-", ""), r: f.total_r, n: f.trades.length });
  all.push(...f.trades);
}

function stat(rows) {
  const n = rows.length; const w = rows.filter((x) => x.r > 0 ? false : x.R > 0).length;
  const wins = rows.filter((x) => x.R > 0), losses = rows.filter((x) => x.R < 0), scratch = rows.filter((x) => x.R === 0);
  const tot = sum(rows.map((x) => x.R));
  return { n, W: wins.length, L: losses.length, S: scratch.length, R: tot,
    exp: n ? r2(tot / n) : 0, wr: n ? Math.round(100 * wins.length / n) : 0,
    avgW: wins.length ? r2(sum(wins.map((x) => x.R)) / wins.length) : 0,
    avgL: losses.length ? r2(sum(losses.map((x) => x.R)) / losses.length) : 0 };
}
function line(label, rows) {
  const s = stat(rows);
  return `${label.padEnd(20)} n=${String(s.n).padStart(3)}  ${String(s.W).padStart(2)}W/${String(s.L).padStart(2)}L/${s.S}S  WR ${String(s.wr).padStart(3)}%  R ${String(s.R).padStart(8)}  exp ${String(s.exp).padStart(6)}  avgW ${String(s.avgW).padStart(5)}  avgL ${String(s.avgL).padStart(5)}`;
}
function group(label, keyFn, keys) {
  console.log(`\n=== ${label} ===`);
  for (const k of keys) console.log(line(String(k), all.filter((x) => keyFn(x) === k)));
}

console.log(`\n############ PATTERN ANALYSIS — ${DATES.length} weeks-worth, ${all.length} trades ############`);
console.log(line("ALL", all));
group("by SESSION", (x) => x.session, ["am", "pm"]);
group("by GRADE", (x) => x.grade, ["A+", "B"]);
group("by MODEL", (x) => x.model, ["Inversion", "Trend", "MSS"]);
group("by SIDE", (x) => x.side, ["long", "short"]);
group("by ANCHOR/ADD", (x) => x.add ? "add" : "anchor", ["anchor", "add"]);
group("by BIAS ALIGNMENT", (x) => x.aligned ? "aligned(trend)" : "against(retrace)", ["aligned(trend)", "against(retrace)"]);
group("by DAY OF WEEK", (x) => x.dow, ["Mon", "Tue", "Wed", "Thu", "Fri"]);
console.log(`\n=== by ENTRY TIME (ET) ===`);
for (const [lo, hi, lbl] of [[0, 600, "<10:00"], [600, 630, "10:00-10:30"], [630, 660, "10:30-11:00"], [660, 690, "11:00-11:30"], [690, 720, "11:30-12:00"], [720, 1000, "PM 13:00+"]])
  console.log(line(lbl, all.filter((x) => x.min >= lo && x.min < hi)));
console.log(`\n=== by RR1 bucket (anchors only) ===`);
for (const [lo, hi, lbl] of [[0, 2, "<2R"], [2, 3, "2-3R"], [3, 5, "3-5R"], [5, 99, "5R+"]])
  console.log(line(lbl, all.filter((x) => !x.add && x.rr1 != null && x.rr1 >= lo && x.rr1 < hi)));
console.log(`\n=== by RISK (stop dist, pts) ===`);
for (const [lo, hi, lbl] of [[0, 25, "<25pt"], [25, 50, "25-50pt"], [50, 75, "50-75pt"], [75, 999, "75pt+"]])
  console.log(line(lbl, all.filter((x) => x.risk >= lo && x.risk < hi)));

// runner vs banker
console.log(`\n=== RUNNER vs BANKER (by outcome) ===`);
for (const oc of ["tp2_hit", "tp1_hit", "closed_1600", "closed_be", "stop_hit"])
  console.log(line(oc, all.filter((x) => x.outcome === oc)));

// day-level concentration
console.log(`\n=== SESSION-LEVEL R (sorted) ===`);
const sorted = [...sessionR].sort((a, b) => b.r - a.r);
for (const s of sorted) if (s.n || s.r) console.log(`  ${s.key.padEnd(16)} ${s.dow}  ${String(s.r).padStart(8)}R  (${s.n} tr)`);
const pos = sessionR.filter((s) => s.r > 0), neg = sessionR.filter((s) => s.r < 0), flat = sessionR.filter((s) => s.r === 0);
console.log(`\n  sessions: ${sessionR.length} total | ${pos.length} green (${sum(pos.map(s=>s.r))}R) | ${neg.length} red (${sum(neg.map(s=>s.r))}R) | ${flat.length} flat`);
const totR = sum(all.map((x) => x.R));
const top3 = sorted.slice(0, 3);
console.log(`  top 3 sessions = ${sum(top3.map(s=>s.r))}R of ${totR}R total (${Math.round(100*sum(top3.map(s=>s.r))/totR)}%): ${top3.map(s=>s.key).join(", ")}`);
process.exit(0);

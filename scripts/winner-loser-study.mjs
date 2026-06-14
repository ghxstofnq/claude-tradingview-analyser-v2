#!/usr/bin/env node
// Profile winners vs losers, AM and PM separately, across entry-time attributes.
//   node scripts/winner-loser-study.mjs <date>...
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
const SCRATCH = path.join(REPO_ROOT, "state", "backtest-wlstudy");

const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const avg = (a) => a.length ? r2(sum(a) / a.length) : 0;
const pct = (cond, rows) => rows.length ? Math.round(100 * rows.filter(cond).length / rows.length) : 0;
const etMin = (ts) => { const d = new Date(ts); return ((d.getUTCHours() + 20) % 24) * 60 + d.getUTCMinutes(); };
const minToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

function findRun(date, session) { try { return fs.readdirSync(BT).filter((d) => d.includes(`-${session.replace("ny-","")}-${date}`)).sort().pop(); } catch { return null; } }
function regen(runDir, session) {
  const rec = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
  const bp = path.join(runDir, "brief-bundle.json"); if (!fs.existsSync(bp)) return rec;
  const leader = rec[0]?.symbol || "MNQ1!";
  const bundle = JSON.parse(fs.readFileSync(bp, "utf8"));
  const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
  return buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] });
}
function pmCarry(date) { const run = findRun(date, "ny-pm"); if (!run) return []; try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; } }
async function fold(date, session) {
  const run = findRun(date, session); if (!run) return [];
  const dir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(dir, "tape.json"))) return [];
  const tape = JSON.parse(fs.readFileSync(path.join(dir, "tape.json"), "utf8"));
  const payloads = regen(dir, session);
  const bias = payloads[0]?.htf_bias_dir ?? null;
  const sm = new Map(); const out = []; const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sm.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sm.get(e.setupId) || {};
      const risk = Math.abs(Number(s.entry) - Number(s.stop));
      const rr1 = risk ? Math.abs(Number(s.tp1) - Number(s.entry)) / risk : null;
      const signed = (s.side === "long" ? Number(e.exit) - Number(s.entry) : Number(s.entry) - Number(e.exit)) / (risk || 1);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? r2(signed) : 0;
      const aligned = bias && ((bias === "bullish" && s.side === "long") || (bias === "bearish" && s.side === "short"));
      out.push({ session: session.replace("ny-", ""), grade: s.grade, model: s.model, side: s.side, add: !!s.scale_in_add,
        risk: r2(risk), rr1: rr1 == null ? null : r2(rr1), outcome: e.outcome, R, min: etMin(s.event_ts), aligned: !!aligned });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }), truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  await runBacktest({ date: tape.date, session, mode: "auto", bus, stateDir: SCRATCH, deps, carryEntries: session === "ny-am" ? pmCarry(date) : [] });
  return out;
}

const all = [];
for (const date of DATES) for (const s of ["ny-am", "ny-pm"]) all.push(...await fold(date, s));
fs.rmSync(SCRATCH, { recursive: true, force: true });   // don't leave scratch on disk

function profile(rows) {
  return {
    n: rows.length, avgR: avg(rows.map((x) => x.R)),
    pctAplus: pct((x) => x.grade === "A+", rows), pctB: pct((x) => x.grade === "B", rows),
    pctShort: pct((x) => x.side === "short", rows), pctLong: pct((x) => x.side === "long", rows),
    pctAdd: pct((x) => x.add, rows), pctTrend: pct((x) => x.aligned, rows),
    avgRisk: avg(rows.map((x) => x.risk)), avgRR1: avg(rows.filter((x) => x.rr1 != null).map((x) => x.rr1)),
    medMin: rows.length ? [...rows.map((x) => x.min)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] : 0,
  };
}
function show(label, rows) {
  const wins = rows.filter((x) => x.R > 0), losses = rows.filter((x) => x.R < 0), scr = rows.filter((x) => x.R === 0);
  const W = profile(wins), L = profile(losses);
  const wr = rows.length ? Math.round(100 * wins.length / rows.length) : 0;
  console.log(`\n========== ${label}  (n=${rows.length}, ${wins.length}W/${losses.length}L/${scr.length}S, win% ${wr}, R ${avg(rows.map(x=>x.R))*rows.length ? r2(sum(rows.map(x=>x.R))) : 0}) ==========`);
  const row = (k, w, l) => console.log(`  ${k.padEnd(22)} winners ${String(w).padStart(8)}    losers ${String(l).padStart(8)}`);
  row("count", W.n, L.n);
  row("avg R", W.avgR, L.avgR);
  row("% A+ grade", W.pctAplus + "%", L.pctAplus + "%");
  row("% short / long", `${W.pctShort}/${W.pctLong}`, `${L.pctShort}/${L.pctLong}`);
  row("% scale-in add", W.pctAdd + "%", L.pctAdd + "%");
  row("% trend-aligned", W.pctTrend + "%", L.pctTrend + "%");
  row("avg stop (pts)", W.avgRisk, L.avgRisk);
  row("avg TP1 R:R", W.avgRR1, L.avgRR1);
  row("median entry (ET)", minToHHMM(W.medMin), minToHHMM(L.medMin));
  // outcome mix
  const ocmix = (g) => ["tp2_hit","tp1_hit","closed_1600","closed_be","stop_hit"].map((o) => `${o.replace("_hit","").replace("closed_","")}:${g.filter((x)=>x.outcome===o).length}`).join(" ");
  console.log(`  winners exits: ${ocmix(wins)}`);
  console.log(`  losers  exits: ${ocmix(losses)}`);
}

console.log(`\n############ WINNERS vs LOSERS — AM and PM ############`);
show("AM", all.filter((x) => x.session === "am"));
show("PM", all.filter((x) => x.session === "pm"));
process.exit(0);

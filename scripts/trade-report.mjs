#!/usr/bin/env node
// Full per-trade report for a set of dates, folded with the authoritative carry
// method (regen brief from bundle + AM->PM carry — same as fold-week / the gate).
//   node scripts/trade-report.mjs 2026-05-11 2026-05-12 2026-05-13 2026-05-14 2026-05-15
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
if (!DATES.length) { console.error("usage: trade-report.mjs <date>..."); process.exit(2); }

const r2 = (n) => Math.round(n * 100) / 100;
const et = (ts) => { const d = new Date(ts); return String((d.getUTCHours() + 20) % 24).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
const pad = (v, n) => String(v ?? "").padStart(n);
const padr = (v, n) => String(v ?? "").padEnd(n);

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
  const sm = new Map(); const trades = []; const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sm.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = sm.get(e.setupId) || {};
      const risk = Math.abs(Number(s.entry) - Number(s.stop));
      const rr1 = risk ? Math.abs(Number(s.tp1) - Number(s.entry)) / risk : null;
      const rr2 = (risk && s.tp2 != null) ? Math.abs(Number(s.tp2) - Number(s.entry)) / risk : null;
      const signed = r2((s.side === "long" ? Number(e.exit) - Number(s.entry) : Number(s.entry) - Number(e.exit)) / (risk || 1));
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? signed : 0;
      trades.push({ t: et(s.event_ts), grade: s.grade, model: s.model, side: s.side, entry: s.entry, stop: s.stop,
        tp1: s.tp1, tp2: s.tp2, risk: r2(risk), rr1: rr1 == null ? null : r2(rr1), rr2: rr2 == null ? null : r2(rr2),
        outcome: e.outcome, exit: e.exit, R, add: !!s.scale_in_add });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: bc.buildDeterministicPacketTruthFromInputs, gradeFn: gradeOpenTrade };
  const { summary } = await runBacktest({ date: tape.date, session, mode: "auto", bus,
    stateDir: path.join(REPO_ROOT, "state", "backtest-report"), deps, carryEntries: session === "ny-am" ? pmCarry(date) : [] });
  const b = payloads[0] || {};
  return { total_r: r2(summary.total_r), trades, brief: { bias: b.htf_bias_dir, grade: b.pillar_grade, ntr: b.no_trade_reason } };
}

const H = `${padr("TIME",5)} ${padr("GR",3)} ${padr("MODEL",9)} ${padr("SIDE",5)} ${pad("ENTRY",8)} ${pad("STOP",8)} ${pad("TP1",8)} ${pad("TP2",8)} ${pad("RISK",6)} ${pad("RR1",5)} ${pad("RR2",6)} ${padr("OUTCOME",11)} ${pad("EXIT",8)} ${pad("R",6)}`;
let week = 0; let nTrades = 0, nWin = 0, nLoss = 0;
console.log(`\n================= TRADE REPORT (carry refold) =================`);
for (const date of DATES) {
  for (const session of ["ny-am", "ny-pm"]) {
    const f = await fold(date, session); if (!f) continue;
    week += f.total_r;
    const hdr = `\n### ${date} ${session.toUpperCase()}  —  ${f.total_r >= 0 ? "+" : ""}${f.total_r}R   [brief: bias=${f.brief.bias ?? "?"}, grade=${f.brief.grade ?? "?"}${f.brief.ntr ? ", " + f.brief.ntr : ""}]`;
    console.log(hdr);
    if (!f.trades.length) { console.log("   (no trades)"); continue; }
    console.log("   " + H);
    for (const t of f.trades) {
      nTrades++; if (t.R > 0) nWin++; else if (t.R < 0) nLoss++;
      console.log("   " + `${padr(t.t, 5)} ${padr(t.grade, 3)} ${padr(t.model, 9)} ${padr(t.side + (t.add ? "*" : ""), 5)} ${pad(t.entry, 8)} ${pad(t.stop, 8)} ${pad(t.tp1, 8)} ${pad(t.tp2, 8)} ${pad(t.risk, 6)} ${pad(t.rr1, 5)} ${pad(t.rr2, 6)} ${padr(t.outcome, 11)} ${pad(t.exit, 8)} ${pad((t.R >= 0 ? "+" : "") + t.R, 6)}`);
    }
  }
}
console.log(`\n---------------------------------------------------------------`);
console.log(`WEEK TOTAL: ${r2(week)}R   |   ${nTrades} trades  (${nWin}W / ${nLoss}L)   |   * = scale-in add`);
process.exit(0);

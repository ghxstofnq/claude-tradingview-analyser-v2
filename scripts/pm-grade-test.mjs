#!/usr/bin/env node
// Test: force every ny-pm trade to grade B (banks at TP1, no A+ runner phase).
// PM_FORCE_B=1 applies the override; unset = baseline. Reports PM-only and 5-week.
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
const SCRATCH = path.join(REPO_ROOT, "state", "backtest-pmgrade");
const DATES = process.argv.slice(2);
const FORCE_B = process.env.PM_FORCE_B === "1";
const r2 = (n) => Math.round(n * 100) / 100;

const WEEKS = ["2026-05-11","2026-05-12","2026-05-13","2026-05-14","2026-05-15","2026-05-18","2026-05-19","2026-05-20","2026-05-21","2026-05-22","2026-05-25","2026-05-26","2026-05-27","2026-05-28","2026-05-29","2026-06-01","2026-06-02","2026-06-03","2026-06-04","2026-06-05","2026-06-08","2026-06-09","2026-06-10","2026-06-11","2026-06-12"];
const USE = DATES.length ? DATES : WEEKS;

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

function gradeTruth(session) {
  return async (args) => {
    const truth = await bc.buildDeterministicPacketTruthFromInputs(args);
    if (FORCE_B && session === "ny-pm" && truth?.bestPacket && truth?.surfacePayload) {
      return { ...truth, bestPacket: { ...truth.bestPacket, grade: "B" }, surfacePayload: { ...truth.surfacePayload, grade: "B" } };
    }
    return truth;
  };
}
async function fold(date, session) {
  const run = findRun(date, session); if (!run) return { r: 0, w: 0, l: 0, s: 0 };
  const dir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(dir, "tape.json"))) return { r: 0, w: 0, l: 0, s: 0 };
  const tape = JSON.parse(fs.readFileSync(path.join(dir, "tape.json"), "utf8"));
  const payloads = regen(dir, session);
  const sm = new Map(); let w = 0, l = 0, s = 0;
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") sm.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const st = sm.get(e.setupId) || {};
      const risk = Math.abs(Number(st.entry) - Number(st.stop));
      const signed = (st.side === "long" ? Number(e.exit) - Number(st.entry) : Number(st.entry) - Number(e.exit)) / (risk || 1);
      const R = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? signed : 0;
      if (R > 0) w++; else if (R < 0) l++; else s++;
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = { recordEntries: async () => ({ entries: tape.entries, warnings: [] }), loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }), truthFn: gradeTruth(session), gradeFn: gradeOpenTrade };
  const { summary } = await runBacktest({ date: tape.date, session, mode: "auto", bus, stateDir: SCRATCH, deps, carryEntries: session === "ny-am" ? pmCarry(date) : [] });
  return { r: Number(summary.total_r) || 0, w, l, s };
}

let pm = { r: 0, w: 0, l: 0, s: 0 }, tot = { r: 0, w: 0, l: 0, s: 0 };
for (const date of USE) for (const sx of ["ny-am", "ny-pm"]) {
  const f = await fold(date, sx);
  tot.r += f.r; tot.w += f.w; tot.l += f.l; tot.s += f.s;
  if (sx === "ny-pm") { pm.r += f.r; pm.w += f.w; pm.l += f.l; pm.s += f.s; }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
const wr = (g) => (g.w + g.l + g.s) ? Math.round(100 * g.w / (g.w + g.l + g.s)) : 0;
console.log(`\n===== PM grade test  (${FORCE_B ? "PM FORCED B / TP1-only" : "BASELINE"}) =====`);
console.log(`  PM only   : ${pm.w}W/${pm.l}L/${pm.s}S  win% ${wr(pm)}  R ${r2(pm.r)}   (baseline PM: 8W/14L, 36%, 7.49R)`);
console.log(`  5-week    : ${tot.w}W/${tot.l}L/${tot.s}S  win% ${wr(tot)}  R ${r2(tot.r)}   (baseline: 45W/61L/3S, 41%, 104.29R)`);
process.exit(0);

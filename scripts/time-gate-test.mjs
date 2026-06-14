#!/usr/bin/env node
// Time-of-day entry gate, tested at the engine level (so anchor/add re-decides:
// drop a pre-window anchor and the next in-window packet becomes the anchor).
// Suppresses any packet whose confirmation bar is outside the allowed window;
// PERMANENT per id (a 09:58 confirm isn't re-surfaced at 10:00 with a stale fill).
//
//   AM_START / AM_END  = allowed ET-minute window for ny-am entries (default all)
//   DROP_PM=1          = suppress all ny-pm entries (AM->PM carry still grades)
//
//   node scripts/time-gate-test.mjs <date>...                 # baseline
//   AM_START=600 DROP_PM=1 node scripts/time-gate-test.mjs ...  # drop pre-10:00 + PM
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
const AM_START = Number(process.env.AM_START ?? 0);
const AM_END = Number(process.env.AM_END ?? 1440);
const DROP_PM = process.env.DROP_PM === "1";

const r2 = (n) => Math.round(n * 100) / 100;
const WEEKS = { "May11-15": ["2026-05-11","2026-05-12","2026-05-13","2026-05-14","2026-05-15"],
  "May18-22": ["2026-05-18","2026-05-19","2026-05-20","2026-05-21","2026-05-22"],
  "May25-29": ["2026-05-25","2026-05-26","2026-05-27","2026-05-28","2026-05-29"],
  "Jun1-5": ["2026-06-01","2026-06-02","2026-06-03","2026-06-04","2026-06-05"],
  "Jun8-12": ["2026-06-08","2026-06-09","2026-06-10","2026-06-11","2026-06-12"] };

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

function makeGate(session) {
  const blocked = new Set();
  return async (args) => {
    const truth = await bc.buildDeterministicPacketTruthFromInputs(args);
    if (!truth?.bestPacket || !truth?.surfacePayload) return truth;
    const id = truth.surfacePayload.id;
    if (blocked.has(id)) return { ...truth, bestPacket: null, surfacePayload: null };
    const d = new Date(Date.parse(args.event?.ts));
    const etMin = ((d.getUTCHours() + 20) % 24) * 60 + d.getUTCMinutes();
    let allow = true;
    if (session === "ny-pm") allow = !DROP_PM;
    else allow = etMin >= AM_START && etMin < AM_END;
    if (!allow) { blocked.add(id); return { ...truth, bestPacket: null, surfacePayload: null }; }
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
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }), truthFn: makeGate(session), gradeFn: gradeOpenTrade };
  const { summary } = await runBacktest({ date: tape.date, session, mode: "auto", bus,
    stateDir: path.join(REPO_ROOT, "state", "backtest-timegate"), deps, carryEntries: session === "ny-am" ? pmCarry(date) : [] });
  return { r: Number(summary.total_r) || 0, w, l, s };
}

const tag = `AM[${AM_START}-${AM_END}) PM=${DROP_PM ? "drop" : "keep"}`;
console.log(`\n===== TIME GATE  ${tag} =====`);
let grand = 0, W = 0, L = 0, S = 0;
for (const dates of Object.values(WEEKS)) {
  for (const date of dates) for (const s of ["ny-am", "ny-pm"]) {
    const f = await fold(date, s); grand += f.r; W += f.w; L += f.l; S += f.s;
  }
}
const n = W + L + S;
const wr = n ? Math.round(100 * W / n) : 0;
console.log(`  trades ${n}   ${W}W / ${L}L / ${S}S   win% ${wr}   R ${r2(grand)}   (baseline: 109 tr, 45W/61L/3S, 41%, 104.29R)`);
process.exit(0);

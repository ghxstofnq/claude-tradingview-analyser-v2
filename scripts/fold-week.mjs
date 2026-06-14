#!/usr/bin/env node
// Fold an arbitrary set of sessions with the SAME clean methodology as the
// 4-week corpus baseline (reclaim-gate-test.mjs WINDOW_MIN=0): regenerate the
// brief from each run's recorded bundle (self-healing, mirrors live), fold the
// production deterministic chain, AM→PM carry. No gate, no reprice — plain
// baseline. Used to validate a freshly-recorded week against the others.
//
//   node scripts/fold-week.mjs 2026-05-11 2026-05-12 2026-05-13 2026-05-14 2026-05-15
//
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
if (!DATES.length) { console.error("usage: fold-week.mjs <date>..."); process.exit(2); }

function findRun(date, session) {
  const tag = `-${session.replace("ny-", "")}-${date}`;
  return fs.readdirSync(BT).filter((d) => d.includes(tag)).sort().pop();
}
function round2(n) { return Math.round(n * 100) / 100; }
const et = (ts) => { const d = new Date(ts); return String((d.getUTCHours() + 20) % 24).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
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
  const runDir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = regen(runDir, session);
  const surfaced = new Map(); const booked = []; const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = surfaced.get(e.setupId) || {};
      const risk = Math.abs(Number(s.entry) - Number(s.stop));
      const signed = round2((s.side === "long" ? Number(e.exit) - Number(s.entry) : Number(s.entry) - Number(e.exit)) / (risk || 1));
      const r = e.outcome === "stop_hit" ? -1 : e.outcome === "closed_be" ? 0 : risk > 0 ? signed : 0;
      booked.push({ t: et(s.event_ts), side: (s.side || "?")[0], add: !!s.scale_in_add, grade: s.grade, r, outcome: e.outcome });
    } else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
  });
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: bc.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  const { summary } = await runBacktest({
    date: tape.date, session, mode: "auto", bus,
    stateDir: path.join(REPO_ROOT, "state", "backtest-foldweek"), deps,
    carryEntries: session === "ny-am" ? pmCarry(date) : [],
  });
  // brief grade for context (no-trade reason etc.)
  const grade = payloads[0]?.pillar_grade, ntr = payloads[0]?.no_trade_reason, bias = payloads[0]?.htf_bias_dir;
  return { total_r: summary.total_r, booked, grade, ntr, bias };
}

console.log(`\n===== WEEK FOLD (clean regen, baseline) =====`);
let week = 0;
for (const date of DATES) {
  for (const session of ["ny-am", "ny-pm"]) {
    const r = await fold(date, session); if (!r) { continue; }
    week += Number(r.total_r) || 0;
    const detail = r.booked.map((b) => `${b.t}${b.add ? "+" : ""}${b.side}${b.r >= 0 ? "+" : ""}${b.r}`).join(" ");
    const tag = r.booked.length ? "" : `  (no-trade${r.ntr ? ": " + r.ntr : ""})`;
    console.log(`  ${date} ${session.padEnd(5)} ${String(round2(r.total_r)).padStart(7)}R  bias=${(r.bias||"?").padEnd(7)} ${detail}${tag}`);
  }
}
console.log("  " + "-".repeat(52));
console.log(`  WEEK TOTAL: ${round2(week)}R`);
// Verified 2026-06-14 (committed chain, accept-bars gate @>=5): full clean fold.
console.log(`\n  corpus reference: May11-15 22.49 | May18-22 15.73 | May25-29 20.16 | Jun1-5 12.63 | Jun8-12 60.08 = 131.09R`);
process.exit(0);

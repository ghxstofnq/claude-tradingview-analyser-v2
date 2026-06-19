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
let BT = path.join(REPO_ROOT, "state", "backtest");
// ONE SYMBOL AT A TIME: `--symbol MNQ1!` picks the right symbol's run for each
// date (the corpus mixes symbols; the bare latest-run pick would grab whichever
// was recorded last — e.g. an MES run for a date you wanted MNQ on).
const argv = process.argv.slice(2);
let SYMBOL = null;
const DATES = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--symbol") { SYMBOL = argv[i + 1]; i += 1; }
  else if (argv[i] === "--bt") { BT = argv[i + 1]; i += 1; }  // override data dir (fold a worktree against the main checkout)
  else DATES.push(argv[i]);
}
if (!DATES.length) { console.error("usage: fold-week.mjs [--symbol MNQ1!] [--bt <state/backtest>] <date>..."); process.exit(2); }

function runLeader(runDir) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8")).entries?.[0]?.inputs?.leader ?? null; } catch { return null; }
}
function findRun(date, session) {
  const tag = `-${session.replace("ny-", "")}-${date}`;
  const cands = fs.readdirSync(BT).filter((d) => d.includes(tag)).sort();
  if (!SYMBOL) return cands.pop();
  // latest candidate whose recorded leader matches the requested symbol
  for (const d of [...cands].reverse()) {
    if (runLeader(path.join(BT, d, session)) === SYMBOL) return d;
  }
  return null;
}
function round2(n) { return Math.round(n * 100) / 100; }
const et = (ts) => { const d = new Date(ts); return String((d.getUTCHours() + 20) % 24).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
// Self-healing brief: recompute the brief from the run's recorded bundle with
// CURRENT code (no stale baked targets). Falls back to the recorded payloads if
// there's no bundle; returns null (caller skips) when neither exists — a
// tape-only legacy run that must be re-recorded before fold-week can use it.
function regen(runDir, session) {
  const pp = path.join(runDir, "brief-payloads.json");
  const bp = path.join(runDir, "brief-bundle.json");
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(pp, "utf8")); } catch { /* may regen from bundle */ }
  if (!fs.existsSync(bp)) return rec;
  const bundle = JSON.parse(fs.readFileSync(bp, "utf8"));
  const leader = rec?.[0]?.symbol || SYMBOL || "MNQ1!";
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
  if (!payloads) return { skipped: true };  // tape-only legacy run — re-record to fold
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
    if (r.skipped) { console.log(`  ${date} ${session.padEnd(5)}    SKIP  (tape-only run, no brief — re-record to fold)`); continue; }
    week += Number(r.total_r) || 0;
    const detail = r.booked.map((b) => `${b.t}${b.add ? "+" : ""}${b.side}${b.r >= 0 ? "+" : ""}${b.r}`).join(" ");
    const tag = r.booked.length ? "" : `  (no-trade${r.ntr ? ": " + r.ntr : ""})`;
    console.log(`  ${date} ${session.padEnd(5)} ${String(round2(r.total_r)).padStart(7)}R  bias=${(r.bias||"?").padEnd(7)} ${detail}${tag}`);
  }
}
console.log("  " + "-".repeat(52));
console.log(`  WEEK TOTAL: ${round2(week)}R`);
// Historical reference (2026-06-14 fold on the THEN-current corpus): May11-15
// 22.49 | May18-22 15.73 | May25-29 20.16 | Jun1-5 12.63 | Jun8-12 60.08 =
// 131.09R. That corpus was later regenerated/cleaned — NOT comparable to a
// fold of today's runs. R is never comparable across corpora (see /fold-test).
process.exit(0);

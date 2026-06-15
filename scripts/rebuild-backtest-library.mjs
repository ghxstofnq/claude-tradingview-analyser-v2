#!/usr/bin/env node
// Rebuild the BACKTEST popover library (state/backtest/index.json + per-run
// setups.jsonl) from the clean corpus fold, so the ANALYTICS dashboard shows
// the real 5-week result instead of the accumulated junk-drawer of duplicate /
// experimental / no-trade runs.
//
// Same fold as scripts/fold-week.mjs (regen brief from each run's recorded
// bundle, fold the production deterministic chain, AM->PM carry) — but pointed
// at the REAL state dir so runBacktest writes a clean run folder + appends a
// fresh index entry per (date, session). One clean run per session; no TV.
//
//   node scripts/rebuild-backtest-library.mjs 2026-05-11 ... 2026-06-12
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
import { parseRunId } from "../app/main/backtest-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const STATE = path.join(REPO_ROOT, "state");        // runBacktest writes under <STATE>/backtest
const BT = path.join(STATE, "backtest");            // source recorded runs + the index
const INDEX = path.join(BT, "index.json");
const DATES = process.argv.slice(2);
if (!DATES.length) { console.error("usage: rebuild-backtest-library.mjs <date>..."); process.exit(2); }

const round2 = (n) => Math.round(n * 100) / 100;

function findRun(date, session) {
  const tag = `-${session.replace("ny-", "")}-${date}`;
  return fs.readdirSync(BT).filter((d) => d.includes(tag)).sort().pop();
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

// Fold one (date, session) and let runBacktest persist a clean run + index entry.
async function rebuild(date, session) {
  const run = findRun(date, session); if (!run) return null;
  const runDir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const payloads = regen(runDir, session);
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => { if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" }); });
  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: bc.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  const { summary } = await runBacktest({
    date: tape.date, session, mode: "auto", bus,
    stateDir: STATE, deps,
    carryEntries: session === "ny-am" ? pmCarry(date) : [],
  });
  return summary;
}

// 1. Back up + reset the index so runBacktest appends only the clean runs.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (fs.existsSync(INDEX)) fs.copyFileSync(INDEX, path.join(BT, `index.json.bak-${stamp}`));
const newRunIds = new Set();
fs.writeFileSync(INDEX, JSON.stringify({ runs: [] }, null, 2));

// 2. Fold the corpus.
console.log("===== REBUILD BACKTEST LIBRARY (clean corpus fold) =====");
let grand = 0;
for (const date of DATES) {
  for (const session of ["ny-am", "ny-pm"]) {
    const s = await rebuild(date, session);
    if (!s) continue;
    newRunIds.add(s.run_id);
    grand += Number(s.total_r) || 0;
    const tag = (s.setups ?? 0) === 0 ? "  (no-trade)" : ` ${s.setups} setup(s) · ${s.wins ?? 0}W/${s.losses ?? 0}L`;
    console.log(`  ${date} ${session.padEnd(5)} ${String(round2(s.total_r)).padStart(7)}R${tag}`);
  }
}
console.log("  " + "-".repeat(52));
console.log(`  CLEAN GRAND TOTAL: ${round2(grand)}R   (corpus reference 131.09R)`);
console.log(`  index runs written: ${newRunIds.size}`);

// 3. Neutralize stale orphan folders so reconcileAbortedRuns can't re-surface
//    them in the dashboard: any parseable run folder not in the new index that
//    lacks a summary.json gets an empty marker (reconcile skips it).
let neutralized = 0;
for (const entry of fs.readdirSync(BT)) {
  if (entry === "index.json" || entry.startsWith("index.json.bak")) continue;
  if (newRunIds.has(entry)) continue;
  let session;
  try { ({ session } = parseRunId(entry)); } catch { continue; } // unparseable → reconcile already skips
  const sessionDir = path.join(BT, entry, session);
  if (!fs.existsSync(sessionDir)) continue;
  const summary = path.join(sessionDir, "summary.json");
  if (!fs.existsSync(summary)) { fs.writeFileSync(summary, "{}\n"); neutralized++; }
}
console.log(`  orphan folders neutralized: ${neutralized}`);
console.log(`  backup: index.json.bak-${stamp}`);
process.exit(0);

#!/usr/bin/env node
// Phase 5 week-proof runner — records a set of sessions through the production
// engine (PROD_DEPS) with per-session wedge recovery, then RE-FOLDS the recorded
// tapes with the AM→PM carry rule to report the authoritative week total.
//
// Two passes, deliberately separated (recording and grading are different jobs):
//
//   PASS 1 — record (natural chronological order). Each session steps TV replay
//   and persists a tape. Heavy replay use intermittently wedges the chart
//   ("symbol doesn't exist", quotes fail); recordEntries throws, and this wrapper
//   reloads the page, waits for a live quote, and retries up to MAX_RETRIES. The
//   per-session R printed here is PROVISIONAL (no carry — the same-day PM tape
//   may not exist yet).
//
//   PASS 2 — refold (authoritative). Once every tape is on disk, re-fold each
//   session with carryEntries from that day's PM tape, exactly like
//   refold-gate.mjs / fold-week.mjs: an AM trade still open at noon carries
//   against the SAME DAY's PM bars to the 16:00 close (user ruling 2026-06-13).
//   The brief is regenerated from the recorded bundle so the run mirrors live
//   end-to-end. This is the number that matches the frozen gate.
//
//   (Earlier this script folded during recording with no carry and under-reported
//   vs the refold — verified 2026-06-14 on May 11-15: -1.46R record-pass vs
//   +4.27R refold. The two-pass split closes that gap without recording PM out of
//   order.)
//
//   node scripts/run-week-proof.mjs                 # June 1-5 ny-am (default)
//   node scripts/run-week-proof.mjs 2026-06-05:ny-am 2026-06-04:ny-am ...
//
// Output: provisional record-pass table + authoritative refold table + week
// total, plus a JSON written to docs/audits/week-proof-<stamp>.json.

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../app/main/backtest-engine.js";
import { PROD_DEPS, STATE_DIR } from "../app/main/backtest-deps.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "../app/main/direct-session-brief.js";
import { getClient, evaluate, disconnect } from "../packages/core/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BT = path.join(STATE_DIR, "backtest");
const MAX_RETRIES = 3;

const args = process.argv.slice(2);
const SESSIONS = args.length
  ? args.map((a) => { const [date, session = "ny-am"] = a.split(":"); return { date, session }; })
  : ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].map((date) => ({ date, session: "ny-am" }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function round2(n) { return Math.round(n * 100) / 100; }

function findRun(date, session) {
  try { return fs.readdirSync(BT).filter((d) => d.includes(`-${session.replace("ny-", "")}-${date}`)).sort().pop(); }
  catch { return null; }
}
function pmCarry(date) {
  const run = findRun(date, "ny-pm"); if (!run) return [];
  try { return JSON.parse(fs.readFileSync(path.join(BT, run, "ny-pm", "tape.json"), "utf8")).entries ?? []; } catch { return []; }
}

async function reloadTvAndWait({ timeoutMs = 90_000 } = {}) {
  console.warn("[week] reloading TV page to clear a wedge…");
  try {
    const c = await getClient();
    await c.Page.reload({ ignoreCache: false });
  } catch { /* reload kills the eval context — expected */ }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const ok = await evaluate("typeof window !== 'undefined' && document.readyState === 'complete'");
      if (ok) { await sleep(3000); return true; }
    } catch { /* context still tearing down */ }
  }
  throw new Error("TV did not recover after reload");
}

function logEvents(bus, label) {
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_outcome") console.log(`  [${label}] outcome ${e.setupId}: ${e.outcome} exit=${e.exit}`);
    else if (e.type === "error") console.error(`  [${label}] ERROR ${e.message}`);
  });
}

// PASS 1 — record a session (and its provisional, carry-less fold) with recovery.
async function recordSession({ date, session }) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const bus = new EventEmitter();
    logEvents(bus, `${date} ${session}`);
    bus.on("backtest:event", (e) => { if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" }); });
    try {
      console.log(`\n[week] ${date} ${session} — attempt ${attempt}/${MAX_RETRIES}`);
      const { summary } = await runBacktest({ date, session, mode: "auto", bus, stateDir: STATE_DIR, deps: PROD_DEPS });
      console.log(`[week] ${date} ${session} recorded — provisional_r ${summary.total_r} (no carry)`);
      return { date, session, ok: true };
    } catch (err) {
      console.error(`[week] ${date} ${session} attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        try { await reloadTvAndWait(); } catch (e) { console.error("[week] recovery failed:", e.message); }
      } else {
        return { date, session, ok: false, error: err.message };
      }
    }
  }
  return { date, session, ok: false, error: "exhausted retries" };
}

// PASS 2 — refold a recorded session with carry (authoritative; mirrors fold-week).
async function refoldSession({ date, session }) {
  const run = findRun(date, session); if (!run) return null;
  const runDir = path.join(BT, run, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return null;
  const tape = JSON.parse(fs.readFileSync(path.join(runDir, "tape.json"), "utf8"));
  const recorded = JSON.parse(fs.readFileSync(path.join(runDir, "brief-payloads.json"), "utf8"));
  let payloads = recorded;
  const bundlePath = path.join(runDir, "brief-bundle.json");
  if (fs.existsSync(bundlePath)) {
    const leader = recorded[0]?.symbol || "MNQ1!";
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
    const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
    payloads = buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] });
  }
  let wins = 0, losses = 0;
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_outcome") { if (e.outcome === "stop_hit") losses++; else if (e.outcome !== "closed_be") wins++; }
    else if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
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
    stateDir: path.join(REPO_ROOT, "state", "backtest-weekproof-refold"), deps,
    carryEntries: session === "ny-am" ? pmCarry(date) : [],
  });
  return { date, session, ok: true, total_r: round2(summary.total_r), wins, losses, best_model: summary.best_model ?? null };
}

// PASS 1: record everything (natural order).
const recorded = [];
for (const s of SESSIONS) recorded.push(await recordSession(s));
await disconnect().catch(() => {});   // recording done; release the TV connection

// PASS 2: refold with carry (authoritative).
console.log("\n========== WEEK PROOF (refold + carry) ==========");
let weekR = 0;
const results = [];
for (const s of SESSIONS) {
  const rec = recorded.find((r) => r.date === s.date && r.session === s.session);
  if (!rec?.ok) { console.log(`${s.date} ${s.session.padEnd(6)}  FAILED: ${rec?.error ?? "not recorded"}`); results.push({ ...s, ok: false, error: rec?.error }); continue; }
  const r = await refoldSession(s);
  if (!r) { console.log(`${s.date} ${s.session.padEnd(6)}  FAILED: no tape`); results.push({ ...s, ok: false, error: "no tape" }); continue; }
  weekR += Number(r.total_r) || 0;
  results.push(r);
  console.log(`${r.date} ${r.session.padEnd(6)}  total_r ${String(r.total_r).padStart(7)}  W${r.wins}/L${r.losses}  best ${r.best_model ?? "-"}`);
}
console.log("------------------------------------------------");
console.log(`WEEK TOTAL R: ${weekR.toFixed(2)}  (${results.filter((r) => r.ok).length}/${results.length} sessions)`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = path.join(REPO_ROOT, "docs", "audits", `week-proof-${stamp}.json`);
fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), week_total_r: Number(weekR.toFixed(2)), results }, null, 2) + "\n");
console.log(`\nwrote ${path.relative(REPO_ROOT, outPath)}`);
process.exit(0);

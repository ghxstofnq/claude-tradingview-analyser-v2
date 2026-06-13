#!/usr/bin/env node
// Phase 5 week-proof runner — records + folds a set of sessions through the
// production deterministic engine (PROD_DEPS), with per-session wedge recovery.
//
// Heavy replay use intermittently wedges the TV chart ("symbol doesn't exist",
// quotes fail). recordEntries throws when that happens; this wrapper catches
// it, reloads the TV page, waits for a live quote, and retries the session up
// to MAX_RETRIES times. Between sessions the engine's own cleanup() stops
// replay so the next session starts clean.
//
//   node scripts/run-week-proof.mjs                 # June 1-5 ny-am (default)
//   node scripts/run-week-proof.mjs 2026-06-05:ny-am 2026-06-04:ny-am ...
//
// Output: per-session trade table + the week's total R, plus a JSON written to
// docs/audits/week-proof-<stamp>.json.

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../app/main/backtest-engine.js";
import { PROD_DEPS, STATE_DIR } from "../app/main/backtest-deps.js";
import { getClient, evaluate, disconnect } from "../packages/core/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MAX_RETRIES = 3;

const args = process.argv.slice(2);
const SESSIONS = args.length
  ? args.map((a) => { const [date, session = "ny-am"] = a.split(":"); return { date, session }; })
  : ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].map((date) => ({ date, session: "ny-am" }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function runSession({ date, session }) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const bus = new EventEmitter();
    logEvents(bus, `${date} ${session}`);
    bus.on("backtest:event", (e) => {
      if (e.type === "paused") bus.emit("backtest:command", { type: "decision", choice: "accept" });
    });
    try {
      console.log(`\n[week] ${date} ${session} — attempt ${attempt}/${MAX_RETRIES}`);
      const { summary } = await runBacktest({ date, session, mode: "auto", bus, stateDir: STATE_DIR, deps: PROD_DEPS });
      console.log(`[week] ${date} ${session} DONE — total_r ${summary.total_r} wins ${summary.wins} losses ${summary.losses}`);
      return { date, session, ok: true, summary };
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

const results = [];
for (const s of SESSIONS) {
  results.push(await runSession(s));
}

console.log("\n========== WEEK PROOF ==========");
let weekR = 0;
for (const r of results) {
  if (r.ok) {
    weekR += Number(r.summary.total_r) || 0;
    console.log(`${r.date} ${r.session.padEnd(6)}  total_r ${String(r.summary.total_r).padStart(7)}  W${r.summary.wins}/L${r.summary.losses}  best ${r.summary.best_model ?? "-"}`);
  } else {
    console.log(`${r.date} ${r.session.padEnd(6)}  FAILED: ${r.error}`);
  }
}
console.log("--------------------------------");
console.log(`WEEK TOTAL R: ${weekR.toFixed(2)}  (${results.filter((r) => r.ok).length}/${results.length} sessions)`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = path.join(REPO_ROOT, "docs", "audits", `week-proof-${stamp}.json`);
fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), week_total_r: Number(weekR.toFixed(2)), results }, null, 2) + "\n");
console.log(`\nwrote ${path.relative(REPO_ROOT, outPath)}`);
await disconnect().catch(() => {});
process.exit(0);

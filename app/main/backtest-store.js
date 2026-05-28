// app/main/backtest-store.js
// Run-id generation + on-disk layout helpers for the Backtest feature.
//   layout: state/backtest/<run-id>/<session>/...   (per spec 2026-05-28)
//   index:  state/backtest/index.json               (master registry)
//
// All functions are pure / fs-local; no Electron deps. Safe to unit-test
// directly with `node --test`.

import fs from "node:fs";
import path from "node:path";

const SESSION_SLUG = { "ny-am": "am", "ny-pm": "pm", london: "london" };
const SLUG_SESSION = { am: "ny-am", pm: "ny-pm", london: "london" };

function pad(n, w = 2) { return String(n).padStart(w, "0"); }

export function generateRunId({ now = new Date(), session, date }) {
  const slug = SESSION_SLUG[session];
  if (!slug) throw new Error(`unknown session: ${session}`);
  const y = now.getUTCFullYear();
  const mo = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const s = pad(now.getUTCSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}-${slug}-${date}`;
}

export function parseRunId(runId) {
  const m = /^(\d{8}-\d{6})-(am|pm|london)-(\d{4}-\d{2}-\d{2})$/.exec(runId);
  if (!m) throw new Error(`invalid run_id: ${runId}`);
  return { ts: m[1], session: SLUG_SESSION[m[2]], date: m[3] };
}

export function resolveRunDir({ stateDir, runId }) {
  const { session } = parseRunId(runId);
  return path.join(stateDir, "backtest", runId, session);
}

function indexPath(stateDir) {
  return path.join(stateDir, "backtest", "index.json");
}

export function readIndex({ stateDir }) {
  const p = indexPath(stateDir);
  if (!fs.existsSync(p)) return { runs: [] };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function writeIndexEntry({ stateDir, entry }) {
  const p = indexPath(stateDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const ix = readIndex({ stateDir });
  ix.runs.push(entry);
  fs.writeFileSync(p, JSON.stringify(ix, null, 2));
}

export function reconcileAbortedRuns({ stateDir }) {
  const root = path.join(stateDir, "backtest");
  if (!fs.existsSync(root)) return [];
  const ix = readIndex({ stateDir });
  const known = new Set(ix.runs.map((r) => r.run_id));
  const aborted = [];
  for (const entry of fs.readdirSync(root)) {
    if (entry === "index.json") continue;
    if (known.has(entry)) continue;
    try {
      const { session, date } = parseRunId(entry);
      const sessionDir = path.join(root, entry, session);
      const summary = path.join(sessionDir, "summary.json");
      if (fs.existsSync(summary)) continue;
      aborted.push({ run_id: entry, date, session, chain_status: "aborted" });
    } catch {
      // unparseable folder name — skip
    }
  }
  return aborted;
}

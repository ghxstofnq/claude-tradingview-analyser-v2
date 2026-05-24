// Last-bar status helper.
//
// The detector appends every closed bar to
// state/session/<date>/bar-close-events.jsonl. We tail that file to seed the
// status line on app open. After that, live bar:close IPC events keep the
// renderer in sync — no polling.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SESSION_ROOT = path.join(REPO_ROOT, "state", "session");

async function lastNonEmptyLine(p) {
  try {
    const txt = await fs.readFile(p, "utf8");
    const lines = txt.split("\n").filter((l) => l.trim());
    return lines.length ? lines[lines.length - 1] : null;
  } catch {
    return null;
  }
}

// Walk session date folders descending, find the most recent event file with
// any entries, return the last line parsed. Returns null when nothing exists.
export async function getLastBar() {
  let dates;
  try { dates = await fs.readdir(SESSION_ROOT); } catch { return null; }
  dates = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const date of dates) {
    const line = await lastNonEmptyLine(path.join(SESSION_ROOT, date, "bar-close-events.jsonl"));
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const ts = ev.ts || ev.time;
    if (!ts) continue;
    const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
    return { ts, tf: ev.tf || null, age_seconds: ageSeconds };
  }
  return null;
}

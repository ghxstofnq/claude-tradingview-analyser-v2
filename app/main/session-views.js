// Read-only views into the per-session folder for the renderer.
//
// One reader per view. All take an explicit session name (since "active" and
// "most-recently-closed" can differ, e.g. between 12:00 and 13:00 ET).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentSession } from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function nyParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(date);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

// Mirrors session-wrap.js — most-recently-closed session for today, or null.
export function mostRecentlyClosed(date = new Date()) {
  const { hour, minute, weekday } = nyParts(date);
  if (weekday === "Sat" || weekday === "Sun") return null;
  const m = hour * 60 + minute;
  if (m >= 16 * 60 + 5) return "ny-pm";
  if (m >= 12 * 60 + 5) return "ny-am";
  if (m >= 6 * 60 + 5) return "london";
  return null;
}

function dirFor(session) {
  const { date } = currentSession();
  return path.join(REPO_ROOT, "state", "session", date, session);
}

async function readJsonOrNull(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

async function tailJsonl(p, n) {
  try {
    const txt = await fs.readFile(p, "utf8");
    const lines = txt.trim().split("\n").filter(Boolean).slice(-n);
    return lines.map((l) => {
      try { return JSON.parse(l); } catch { return { _raw: l }; }
    });
  } catch {
    return [];
  }
}

// RECAP — most-recently-closed session's summary. Returns null when no
// session has closed today (or the wrap hasn't fired yet).
export async function getSessionRecap() {
  const session = mostRecentlyClosed();
  if (!session) return { session: null, recap: null };
  const recap = await readJsonOrNull(path.join(dirFor(session), "summary.json"));
  return { session, recap };
}

// OPEN-REACTION — the running log. Returns { session, reads: [...], latest }.
// If no session is given, falls back to whatever the current clock-active
// session is (LIVE consumer).
export async function getOpenReaction(sessionArg) {
  const session = sessionArg || currentSession().session;
  if (!session || session === "idle") return { session: null, reads: [], latest: null };
  const reads = (await readJsonOrNull(path.join(dirFor(session), "open-reaction.json"))) || [];
  return { session, reads, latest: reads[0] || null };
}

// SETUPS list — last N entries from setups.jsonl for the given session
// (defaults to active). Used by LIVE to show recent candidates + confirmations.
export async function getSetupsList(sessionArg, n = 20) {
  const session = sessionArg || currentSession().session;
  if (!session || session === "idle") return { session: null, setups: [] };
  const setups = await tailJsonl(path.join(dirFor(session), "setups.jsonl"), n);
  return { session, setups: setups.reverse() };   // newest first
}

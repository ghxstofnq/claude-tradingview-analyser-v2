// Active-session resolver — ET-clock based.
//
// Returns which trading session (ny-am / ny-pm / london / idle) is current,
// and where to write per-session state files.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function currentSession() {
  const { date, hour, minute, weekday } = nyParts();
  let session = "idle";
  if (weekday !== "Sat" && weekday !== "Sun") {
    const m = hour * 60 + minute;
    if (m >= 9 * 60 + 30 && m < 12 * 60) session = "ny-am";
    else if (m >= 13 * 60 && m < 16 * 60) session = "ny-pm";
    else if (m >= 3 * 60 && m < 6 * 60) session = "london";
  }
  return { date, session, et_hour: hour, et_minute: minute, weekday };
}

// #39 During idle (between sessions), pick the MOST-RECENTLY-CLOSED
// session for the day, NOT a blind fallback to ny-am. Was: at 12:01-
// 13:00 ET, activeSessionDir wrote to ny-am/ even though that session
// just ended — mixing post-AM activity (e.g. trade outcomes from a
// position open at the close) with the AM session log.
function mostRecentSession(hour, minute) {
  const m = hour * 60 + minute;
  if (m >= 16 * 60) return "ny-pm";        // post-PM
  if (m >= 13 * 60) return "ny-pm";        // during PM (handled by currentSession, just defensive)
  if (m >= 12 * 60) return "ny-am";        // inter-session 12:00-13:00
  if (m >= 9 * 60 + 30) return "ny-am";    // during AM (defensive)
  if (m >= 6 * 60) return "london";        // post-London
  if (m >= 3 * 60) return "london";        // during London (defensive)
  return "ny-pm";                          // overnight / pre-London — last NY PM
}

// ─────────────────────────────────────────────────────────────────────
// Backtest session-dir override.
//
// When set, activeSessionDir() returns state/backtest/<run-id>/<session>/
// instead of state/session/<date>/<session>/. Same shape, different root,
// so every existing writer (session-memory.js, bar-close.js, etc.) lands
// in the backtest folder without any per-callsite changes.
// ─────────────────────────────────────────────────────────────────────
let _backtestSessionContext = null;

export function setBacktestSessionContext(ctx) {
  _backtestSessionContext = ctx;
}

export function clearBacktestSessionContext() {
  _backtestSessionContext = null;
}

// State root. GOFNQ_STATE_DIR redirects every session-state write off the
// live tree — the test suite sets it to a temp dir so a stray surface call
// can never clobber the live brief/session (a brief-flow test once did,
// wiping a live NY-AM MNQ brief). Falls back to the real state/ in production.
export function stateRoot() {
  return process.env.GOFNQ_STATE_DIR || path.join(REPO_ROOT, "state");
}

export async function activeSessionDir() {
  if (_backtestSessionContext) {
    const { runId, session } = _backtestSessionContext;
    const dir = path.join(stateRoot(), "backtest", runId, session);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  const { date, session, et_hour, et_minute } = currentSession();
  const folder = session === "idle"
    ? mostRecentSession(et_hour, et_minute)
    : session;
  const dir = path.join(stateRoot(), "session", date, folder);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

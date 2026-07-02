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
// Returns { session, dayOffset } — dayOffset is 0 for today's most-recent
// session, -1 when the most-recent session actually closed on the PRIOR ET day
// (the overnight window). C7: a 00:00-02:59 ET idle write used to land in
// <today>/ny-pm, an orphan folder, instead of yesterday's real PM session.
function mostRecentSession(hour, minute) {
  const m = hour * 60 + minute;
  if (m >= 13 * 60) return { session: "ny-pm", dayOffset: 0 };     // during/after PM (today)
  if (m >= 12 * 60) return { session: "ny-am", dayOffset: 0 };     // inter-session 12:00-13:00
  if (m >= 9 * 60 + 30) return { session: "ny-am", dayOffset: 0 }; // during AM (defensive)
  if (m >= 6 * 60) return { session: "london", dayOffset: 0 };     // post-London (today)
  if (m >= 3 * 60) return { session: "london", dayOffset: 0 };     // during London (defensive)
  return { session: "ny-pm", dayOffset: -1 };                      // overnight 00:00-02:59 — YESTERDAY's PM
}

// Shift a plain ET date string (YYYY-MM-DD) by whole days. UTC arithmetic on a
// date-only value is DST-safe (no wall-clock hour involved).
function shiftDate(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Pure resolver for the session folder + date, given a currentSession() result.
// Exported for tests (activeSessionDir wraps it with the live clock + mkdir).
export function resolveSessionFolder({ date, session, et_hour, et_minute }) {
  if (session !== "idle") return { date, folder: session };
  const { session: folder, dayOffset } = mostRecentSession(et_hour, et_minute);
  return { date: dayOffset ? shiftDate(date, dayOffset) : date, folder };
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
  const { date, folder } = resolveSessionFolder(currentSession());
  const dir = path.join(stateRoot(), "session", date, folder);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

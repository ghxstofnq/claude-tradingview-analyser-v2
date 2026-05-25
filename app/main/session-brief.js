// Session-brief runner + scheduler.
//
// Triggers a single Claude turn that loads HTF context, grades Pillars 1+2,
// and calls the `surface_session_brief` tool to populate the PREP panels.
//
// Schedule (ET, weekdays only):
//   02:00 → London
//   09:00 → NY AM
//   13:00 → NY PM
//
// Also runs on app open if today's current/imminent session has no cached
// brief, and on demand via the refresh button.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { userTurn } from "./sdk.js";
import { currentSession } from "./sessions.js";
import { PAIR_DEFAULT, PAIR_PRIMARY, PAIR_SECONDARY } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const TRIGGERS = [
  { session: "london", briefHour: 2,  briefMinute: 0 },
  { session: "ny-am",  briefHour: 9,  briefMinute: 0 },
  { session: "ny-pm",  briefHour: 13, briefMinute: 0 },
];

let _send = null;
let _timer = null;
let _running = false;

function nyParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  }).formatToParts(date);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

// The "active or imminent" session at a given ET time — useful at app-open to
// decide which session's brief to load/run.
export function activeOrImminentSession(date = new Date()) {
  const { hour, minute, weekday } = nyParts(date);
  if (weekday === "Sat" || weekday === "Sun") return null;
  const m = hour * 60 + minute;
  // Map ET minute → session whose brief covers this moment.
  // Brief lifetime: from its trigger time until the start of the NEXT session's
  // brief trigger (or end-of-day).
  if (m >= 2 * 60 && m < 9 * 60) return "london";
  if (m >= 9 * 60 && m < 13 * 60) return "ny-am";
  if (m >= 13 * 60 && m < 16 * 60 + 30) return "ny-pm";
  // Outside trading hours → most recent session is ny-pm of the same day, but
  // if the session is fully over we just don't run a brief.
  return null;
}

function dateMsFromNyHM(hour, minute) {
  // Compute a Date.now()-comparable timestamp for "today at HH:MM ET".
  // We do this by walking minute-by-minute from now until the ET clock matches —
  // simpler than parsing offsets manually and correct across DST.
  const now = Date.now();
  // Start from now, then probe forward until we find the next time when ET
  // shows the target HH:MM. Cap at 26 hours for safety.
  for (let off = 0; off < 26 * 60; off += 1) {
    const probe = now + off * 60_000;
    const p = nyParts(new Date(probe));
    if (p.hour === hour && p.minute === minute && p.weekday !== "Sat" && p.weekday !== "Sun") {
      // Snap to the top of the minute so we don't drift seconds-wise.
      return Math.floor(probe / 60_000) * 60_000;
    }
  }
  return null;
}

function nextTrigger() {
  const candidates = TRIGGERS
    .map((t) => ({ session: t.session, at: dateMsFromNyHM(t.briefHour, t.briefMinute) }))
    .filter((c) => c.at != null && c.at > Date.now())
    .sort((a, b) => a.at - b.at);
  return candidates[0] || null;
}

async function briefPathFor(session, date = nyParts().date) {
  const dir = path.join(REPO_ROOT, "state", "session", date, session);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "brief.json");
}

// Returns the legacy single-symbol brief (brief.json) for a session, or null.
export async function getBriefForToday(session) {
  if (!session) return null;
  try {
    const file = await briefPathFor(session);
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

// Returns per-symbol briefs as { [symbol]: payload } for a session, or {}.
// Reads brief-<symbol>.json for each known pair symbol — falls back to
// legacy brief.json (under PAIR_PRIMARY) if no per-symbol files exist yet.
export async function getBriefsBySymbolForToday(session) {
  if (!session) return {};
  const out = {};
  for (const symbol of [PAIR_PRIMARY, PAIR_SECONDARY]) {
    try {
      const dir = path.join(REPO_ROOT, "state", "session", nyParts().date, session);
      const file = path.join(dir, `brief-${symbol}.json`);
      const txt = await fs.readFile(file, "utf8");
      out[symbol] = JSON.parse(txt);
    } catch { /* missing — leave undefined */ }
  }
  // Backward compat — surface the legacy brief.json under the primary key
  // when no per-symbol file exists yet.
  if (!out[PAIR_PRIMARY]) {
    const legacy = await getBriefForToday(session);
    if (legacy) out[PAIR_PRIMARY] = legacy;
  }
  return out;
}

async function runBriefFor(session) {
  if (!session) return;
  if (_running) return;
  _running = true;
  _send?.("prep:status", { state: "running", session });
  try {
    const text = `Run the SESSION BRIEF for the ${session.toUpperCase()} session.

Steps:
1. Call mcp__tv__tv_analyze_full with pair="${PAIR_DEFAULT}" to load dual-symbol HTF context (Daily / 4H / 1H, overnight ranges, both symbols).
2. Reason in prose — for EACH symbol independently — grade Pillars 1 (Draw & Bias) and 2 (Price-Action Quality). Identify HTF bias per timeframe, overnight context (Asia / London ranges, what was swept), key levels (PWH / PDH / ONH / ONL / PDL / PWL with taken/untaken state), and a written plan for the session open. Cite from pair.symbols.${PAIR_PRIMARY}.* and pair.symbols.${PAIR_SECONDARY}.* — not the top-level fields (those mirror the primary only).
3. At the END of the turn, call mcp__tv__surface_session_brief TWICE — once with symbol="${PAIR_PRIMARY}" and once with symbol="${PAIR_SECONDARY}". Each call carries the per-symbol structured payload. This is the only tool call that surfaces briefs to the PREP panels — do NOT call surface_setup or surface_no_trade in a session-brief turn.`;
    await userTurn({
      text,
      onEvent: (e) => {
        if (e.type === "chunk") _send?.("chat:chunk", e);
        else if (e.type === "tool_call") _send?.("chat:tool_call", e);
        else if (e.type === "turn_complete") _send?.("chat:turn_complete", e);
        else if (e.type === "error") _send?.("app:error", { source: "session-brief", message: e.message });
      },
    });
    _send?.("prep:status", { state: "idle", session });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[session-brief] run failed", err);
    _send?.("prep:status", { state: "error", session, message: String(err?.message || err) });
  } finally {
    _running = false;
  }
}

export async function runManualRefresh() {
  const session = activeOrImminentSession();
  if (!session) {
    _send?.("prep:status", { state: "skipped", reason: "no active session window" });
    return;
  }
  await runBriefFor(session);
}

export async function bootstrap({ send }) {
  _send = send;
  // App-open: ensure today's brief for the current/imminent session exists.
  const session = activeOrImminentSession();
  if (session) {
    const existing = await getBriefForToday(session);
    if (!existing) {
      // Fire in background — don't block app boot.
      runBriefFor(session).catch(() => {});
    }
  }
  scheduleNextBoundary();
}

function scheduleNextBoundary() {
  if (_timer) clearTimeout(_timer);
  const next = nextTrigger();
  if (!next) return;
  const ms = next.at - Date.now();
  _timer = setTimeout(async () => {
    await runBriefFor(next.session);
    scheduleNextBoundary();
  }, ms);
  // eslint-disable-next-line no-console
  console.log("[session-brief] next trigger", next.session, "in", Math.round(ms / 1000), "s");
}

export function stopScheduler() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

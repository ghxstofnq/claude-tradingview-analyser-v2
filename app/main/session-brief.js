// Session-brief — schedules + reads. The scheduler itself lives in
// scheduled-turn.js; this file only specifies the brief-specific bits:
// which clock times trigger it, when it's already done, and the prompt.
//
// Public surface (unchanged):
//   bootstrap({send})              — call once at app boot
//   runManualRefresh()             — wire to the PREP refresh button
//   getBriefForToday(session)      — legacy brief.json reader
//   getBriefsBySymbolForToday()    — per-symbol brief reader (PREP panel)
//   activeOrImminentSession()      — used by ipc.prep:get to decide which
//                                    session's brief to display

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeScheduledTurn } from "./scheduled-turn.js";
import { PAIR_DEFAULT, PAIR_PRIMARY, PAIR_SECONDARY } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Schedule: brief fires this many minutes before the actual session window
// opens (so the PREP panel is populated when the user opens the app to
// review the open).
const TRIGGERS = [
  { session: "london", hour: 2,  minute: 0 },
  { session: "ny-am",  hour: 9,  minute: 0 },
  { session: "ny-pm",  hour: 13, minute: 0 },
];

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

// Active or imminent session — used both by the scheduler (to pick which
// session to fire for) and by the PREP panel (to pick which brief to read).
// Window covers from the brief trigger time until the next session's brief.
export function activeOrImminentSession(date = new Date()) {
  const { hour, minute, weekday } = nyParts(date);
  if (weekday === "Sat" || weekday === "Sun") return null;
  const m = hour * 60 + minute;
  if (m >= 2 * 60 && m < 9 * 60) return "london";
  if (m >= 9 * 60 && m < 13 * 60) return "ny-am";
  if (m >= 13 * 60 && m < 16 * 60 + 30) return "ny-pm";
  return null;
}

async function briefPathFor(session, date = nyParts().date) {
  const dir = path.join(REPO_ROOT, "state", "session", date, session);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "brief.json");
}

// Legacy single-symbol brief reader. brief.json is now the PRIMARY mirror
// (see session-memory.writeBrief) so this returns the primary's brief in
// dual-symbol mode.
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

// Per-symbol briefs. Falls back to legacy brief.json under PAIR_PRIMARY if
// per-symbol files haven't been written yet.
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
  if (!out[PAIR_PRIMARY]) {
    const legacy = await getBriefForToday(session);
    if (legacy) out[PAIR_PRIMARY] = legacy;
  }
  return out;
}

async function isAlreadyDone(session) {
  return !!(await getBriefForToday(session));
}

function buildPrompt(session) {
  return Promise.resolve(`Run the SESSION BRIEF for the ${session.toUpperCase()} session.

Steps:
1. Call mcp__tv__tv_analyze_full with pair="${PAIR_DEFAULT}" to load dual-symbol HTF context (Daily / 4H / 1H, overnight ranges, both symbols).
2. Reason in prose — for EACH symbol independently — grade Pillars 1 (Draw & Bias) and 2 (Price-Action Quality). Identify HTF bias per timeframe, overnight context (Asia / London ranges, what was swept), key levels (PWH / PDH / ONH / ONL / PDL / PWL with taken/untaken state), and a written plan for the session open. Cite from pair.symbols.${PAIR_PRIMARY}.* and pair.symbols.${PAIR_SECONDARY}.* — not the top-level fields (those mirror the primary only).
3. At the END of the turn, call mcp__tv__surface_session_brief TWICE — once with symbol="${PAIR_PRIMARY}" and once with symbol="${PAIR_SECONDARY}". Each call carries the per-symbol structured payload. This is the only tool call that surfaces briefs to the PREP panels — do NOT call surface_setup or surface_no_trade in a session-brief turn.`);
}

const _driver = makeScheduledTurn({
  name: "session-brief",
  purpose: "brief",
  statusChannel: "prep:status",
  triggers: TRIGGERS,
  activeSessionFn: activeOrImminentSession,
  isAlreadyDoneFn: isAlreadyDone,
  buildPromptFn: buildPrompt,
});

export const bootstrap = _driver.bootstrap;
export const runManualRefresh = _driver.runManual;
export const stopScheduler = _driver.stop;

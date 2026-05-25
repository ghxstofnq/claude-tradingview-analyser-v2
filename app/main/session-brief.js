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
import * as replayCore from "@tvmcp/core/replay";
import { makeScheduledTurn } from "./scheduled-turn.js";
import { ensureChartState } from "./tools/tv-chart.js";
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
//
// "Imminent" window: 30 minutes BEFORE the next session's brief trigger we
// roll forward. So at 08:55 ET, the answer is "ny-am" (brief trigger at
// 09:00), not "london" — even though we're still inside London's window by
// clock. Prior behavior fired a stale London brief at 08:55 that the user
// would discard 5 min later when NY AM arrived.
const IMMINENT_LEAD_MIN = 30;

export function activeOrImminentSession(date = new Date()) {
  const { hour, minute, weekday } = nyParts(date);
  if (weekday === "Sat" || weekday === "Sun") return null;
  const m = hour * 60 + minute;
  const NY_AM_BRIEF = 9 * 60;     // 09:00 ET
  const NY_PM_BRIEF = 13 * 60;    // 13:00 ET
  // Imminent rolls: if we're within IMMINENT_LEAD_MIN of the next session's
  // brief trigger, the answer is the next session — not the current one.
  if (m >= NY_PM_BRIEF - IMMINENT_LEAD_MIN && m < 16 * 60 + 30) return "ny-pm";
  if (m >= NY_AM_BRIEF - IMMINENT_LEAD_MIN && m < NY_PM_BRIEF - IMMINENT_LEAD_MIN) return "ny-am";
  if (m >= 2 * 60 && m < NY_AM_BRIEF - IMMINENT_LEAD_MIN) return "london";
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

// Preflight: skip the brief turn when the market is closed (no fresh data
// to analyze), when replay is active on the chart (would grade replay
// state instead of live), or when the chart isn't on a pair symbol (the
// analyze call would throw on the symbol check).
async function preflight() {
  const { hour, minute, weekday } = nyParts();
  // Market-closed window for CME index futures: Friday 17:00 ET → Sunday
  // 18:00 ET, plus daily 17:00–18:00 ET settlement break on weekdays. Match
  // the logic in cli/commands/analyze.js#computeSessionGate.
  const m = hour * 60 + minute;
  const isSat = weekday === "Sat";
  const isFridayAfter = weekday === "Fri" && m >= 17 * 60;
  const isSundayBefore = weekday === "Sun" && m < 18 * 60;
  const isDailyBreak = !isSat && !isFridayAfter && !isSundayBefore && m >= 17 * 60 && m < 18 * 60;
  if (isSat || isFridayAfter || isSundayBefore || isDailyBreak) {
    return { ok: false, reason: "market closed (CME futures pause)" };
  }
  // Replay mode active on the chart — grading replay would mislead the
  // trader. Best-effort: if the call fails we proceed (no replay session
  // means the API errors).
  try {
    const status = await replayCore.status();
    if (status?.is_replay_started) {
      return { ok: false, reason: "TradingView replay is active — toggle it off and retry" };
    }
  } catch { /* no replay session — proceed */ }
  // Chart preflight: tv analyze --pair throws if the chart isn't on one of
  // the pair symbols. Pin to PAIR_PRIMARY before the turn so the analyzer
  // never gets a wrong-symbol bundle.
  try {
    await ensureChartState({ symbol: PAIR_PRIMARY });
  } catch (err) {
    return { ok: false, reason: `chart preflight failed: ${err?.message || err}` };
  }
  return { ok: true };
}

// Post-validate: confirm Claude actually called surface_session_brief
// twice in the dual-symbol turn. Without this, a "turn completed" with no
// briefs surfaced was silent — PREP panel just stayed on yesterday.
// Exported for tests/brief-flow.test.js.
export function postValidate(toolCalls) {
  const briefCalls = toolCalls.filter((n) => n && n.includes("surface_session_brief"));
  if (briefCalls.length === 0) {
    return "brief turn completed without calling surface_session_brief — PREP panel will stay stale";
  }
  if (briefCalls.length < 2) {
    return `brief turn called surface_session_brief only ${briefCalls.length}× — expected 2 (one per symbol)`;
  }
  return null;
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
  preflightFn: preflight,
  postValidateFn: postValidate,
});

export const bootstrap = _driver.bootstrap;
export const runManualRefresh = _driver.runManual;
export const stopScheduler = _driver.stop;
export const rearmScheduler = _driver.rearm;

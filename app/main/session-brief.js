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
import { computeSize, dayOfWeek } from "../../cli/lib/sizing.js";
import { getPersistentMemory } from "./persistent-memory.js";
import { archiveBriefArtifacts } from "./session-memory.js";
import { runDirectSessionBrief } from "./direct-session-brief.js";
import { captureLeaderH1 } from "./live-h1-capture.js";

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
  const dir = await briefDirFor(session, date);
  return path.join(dir, "brief.json");
}

async function briefDirFor(session, date = nyParts().date) {
  const dir = path.join(REPO_ROOT, "state", "session", date, session);
  await fs.mkdir(dir, { recursive: true });
  return dir;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientChartReadyError(err) {
  const msg = String(err?.message || err || "");
  return /Value is null|_activeChartWidgetWV|Cannot read properties of undefined|chart.*ready|TradingViewApi/i.test(msg);
}

export async function ensureChartStateWithRetry({
  symbol,
  ensureFn = ensureChartState,
  sleepFn = sleep,
  maxAttempts = 5,
  baseDelayMs = 500,
} = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await ensureFn({ symbol });
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransientChartReadyError(err)) throw err;
      await sleepFn(baseDelayMs * attempt);
    }
  }
  throw lastErr;
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
    await ensureChartStateWithRetry({ symbol: PAIR_PRIMARY });
  } catch (err) {
    return { ok: false, reason: `chart preflight failed after retry: ${err?.message || err}` };
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

// Read up to maxDays of recent per-session summary.md files for context
// injection into the brief turn. Cheap approximation of FTS5 session
// search: gives Claude a view of "what happened on the last 5 trading
// days" before grading today. Cap total content at ~4000 chars to keep
// the brief turn's prompt bounded.
//
// Layout: state/session/<YYYY-MM-DD>/{ny-am,ny-pm,london}/summary.md.
// Skip days with no folder. Skip sessions without a summary.md (e.g. a
// session that didn't wrap because of an app restart).
async function readRecentSessionSummaries({ maxDays = 5, maxChars = 4000 } = {}) {
  const sessionRoot = path.join(REPO_ROOT, "state", "session");
  let dates;
  try {
    dates = (await fs.readdir(sessionRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse(); // newest first
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const today = nyParts().date;
  // Skip today's folder — those summaries are about-to-be-created by THIS
  // session's wrap; injecting them would echo back to the model.
  dates = dates.filter((d) => d !== today).slice(0, maxDays);

  const entries = [];
  let totalChars = 0;
  for (const date of dates) {
    const dayDir = path.join(sessionRoot, date);
    let sessions;
    try {
      sessions = (await fs.readdir(dayDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }
    // Preferred order: ny-am, ny-pm, london (chronological inside a day)
    const ordered = ["ny-am", "ny-pm", "london"].filter((s) => sessions.includes(s));
    for (const session of ordered) {
      const summaryPath = path.join(dayDir, session, "summary.md");
      let raw;
      try {
        raw = await fs.readFile(summaryPath, "utf8");
      } catch {
        continue;
      }
      // Strip YAML frontmatter to keep injected text tight.
      const body = raw.replace(/^---[\s\S]*?---\s*/m, "").trim();
      if (!body) continue;
      const entry = `### ${date} ${session}\n${body}`;
      if (totalChars + entry.length > maxChars && entries.length > 0) break;
      entries.push(entry);
      totalChars += entry.length;
    }
    if (totalChars >= maxChars) break;
  }
  return entries;
}

async function buildPrompt(session) {
  // Read last 5 days' session summaries — cross-session context that helps
  // the model spot recurring patterns and avoid contradicting recent
  // verdicts without good cause. See
  // docs/research/hermes-memory-architecture.md (Layer 5 cheap approximation).
  let recentBlock = "";
  try {
    const entries = await readRecentSessionSummaries();
    if (entries.length) {
      recentBlock =
        `<recent_sessions>\n` +
        `For cross-session context — what you graded over the last few trading days. ` +
        `Use this to spot recurring patterns and to avoid contradicting recent verdicts without good cause.\n\n` +
        entries.join("\n\n") +
        `\n</recent_sessions>\n\n`;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[session-brief] recent-sessions read failed", err?.message || err);
  }

  // Pre-compute today's sizing matrix from the helper. No LLM arithmetic —
  // the model copies r_size verbatim into sizing_note based on the grade
  // it produces. Avoids "1.0 R · Tuesday standard" being model-fabricated
  // (it was right by training, but the helper is the source of truth).
  // memory.USER overrides (e.g. "skip PCE Wednesdays") are checked too.
  const today = dayOfWeek();
  let memoryUserText = "";
  try {
    const mem = getPersistentMemory();
    await mem.load();
    memoryUserText = mem.formatForSystemPrompt("user") || "";
  } catch { /* memory unavailable — pass empty string */ }
  const sizingAplus = computeSize({ day_of_week: today, grade: "A+", memory_overrides: memoryUserText });
  const sizingB = computeSize({ day_of_week: today, grade: "B", memory_overrides: memoryUserText });
  const sizingBlock = `<sizing_pre_computed>
day_of_week: ${today}
A+: { r_size: ${sizingAplus.r_size}, cites: [${sizingAplus.cites.map((c) => `"${c}"`).join(", ")}]${sizingAplus.override_reason ? `, override: "${sizingAplus.override_reason}"` : ""} }
B:  { r_size: ${sizingB.r_size}, cites: [${sizingB.cites.map((c) => `"${c}"`).join(", ")}]${sizingB.override_reason ? `, override: "${sizingB.override_reason}"` : ""} }
no-trade: 0
</sizing_pre_computed>

`;

  // The brief workflow lives in the system prompt under <phase name="brief">
  // — that's the rigorous step-by-step. This user message is just the router:
  // it tells the model "you're a brief turn, here's the pair, go run that
  // phase." Keeping the heavy guidance in the system prompt means the brief
  // benefits from the same XML structuring, citation discipline, and grade
  // semantics as the per-bar /analyze phases.
  return `${recentBlock}${sizingBlock}This is a SESSION BRIEF turn for the ${session.toUpperCase()} session.

Pair: ${PAIR_DEFAULT}  (primary=${PAIR_PRIMARY}, secondary=${PAIR_SECONDARY})

Follow the <phase name="brief"> instructions in the system prompt end-to-end:
  1. Full capture with --pair.
  2. For each symbol, walk Step 1 (HTF Bias per-TF with per-TF citations), Step 2 (Overnight Context), Step 3 (Pillar 2 Quality), Step 4 (Deterministic Pillar 1+2 grade), Step 5 (Scenarios), Step 6 (Sizing Note).
  3. Run the Step 7 self-check.
  4. End with mcp__tv__surface_session_brief — once per symbol (twice in dual-symbol mode). Skip surface_setup and surface_no_trade.

For Step 6 (Sizing): use the <sizing_pre_computed> block above verbatim. Pick the row matching this symbol's grade. Format the sizing_note as: "<r_size> R · ${today} <grade> (strategy.sizing-table)" — copy r_size as a number, do not recompute. If override is set on the matching grade, surface the override_reason instead.

The brief is what the trader sees during the open; sloppy citations or self-contradicting verdicts here directly hurt their decisions. The phase spec exists exactly to keep this turn disciplined.`;
}

async function sizingByGradeForToday() {
  const today = dayOfWeek();
  let memoryUserText = "";
  try {
    const mem = getPersistentMemory();
    await mem.load();
    memoryUserText = mem.formatForSystemPrompt("user") || "";
  } catch { /* memory unavailable — pass empty string */ }
  return {
    "A+": computeSize({ day_of_week: today, grade: "A+", memory_overrides: memoryUserText }),
    B: computeSize({ day_of_week: today, grade: "B", memory_overrides: memoryUserText }),
    "no-trade": { r_size: 0, cites: ["strategy.sizing-table"] },
  };
}

async function runDirectBrief(session, { onEvent } = {}) {
  return runDirectSessionBrief({
    session,
    sizingByGrade: await sizingByGradeForToday(),
    captureH1Fn: captureLeaderH1,
    onEvent,
  });
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
  // Briefs do the heaviest single turn in the system: tv_analyze_full
  // (dual-symbol multi-TF sweep, ~15-30s) + Opus 4.7 xhigh reasoning over
  // both symbols + two surface_session_brief calls + scenarios. Observed
  // 2026-05-26 (London brief): both the original attempt AND its 60s retry
  // hit the 5-min default after EFFORT moved to xhigh in PR #56. 10 min
  // covers the worst case with headroom.
  timeoutMs: 600_000,
  // Codex cannot call app MCP surface tools. When the selected provider is a
  // non-tool provider for this tool-required purpose, scheduled-turn uses this
  // deterministic in-process path instead of forcing Claude.
  directRunFn: runDirectBrief,
});

export const bootstrap = _driver.bootstrap;
export async function runManualRefresh(options = {}) {
  const session = activeOrImminentSession();
  if (session) {
    try {
      await archiveBriefArtifacts(await briefDirFor(session));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[session-brief] failed to archive existing brief before manual refresh", err?.message || err);
    }
  }
  return _driver.runManual({ force: true, ...options });
}
export const stopScheduler = _driver.stop;
export const rearmScheduler = _driver.rearm;

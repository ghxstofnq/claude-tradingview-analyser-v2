// Session-wrap runner + scheduler.
//
// Fires a Claude turn after each trading session closes, asking it to
// synthesize the session's memory files and call `surface_session_summary`
// to write state/session/<date>/<session>/summary.md.
//
// Schedule (ET, weekdays only — 5 minutes after each session's close so the
// final bar's state is settled):
//   06:05 → London
//   12:05 → NY AM
//   16:05 → NY PM
//
// Also runs on app open if today's most-recently-closed session has no
// summary yet (catch-up).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { userTurn } from "./sdk.js";
import { readSessionMemoryFor } from "./tools/surface.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const TRIGGERS = [
  { session: "london", hour: 6,  minute: 5 },
  { session: "ny-am",  hour: 12, minute: 5 },
  { session: "ny-pm",  hour: 16, minute: 5 },
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
    weekday: get("weekday"),
  };
}

// Most-recently-closed session for today, or null if no session has closed yet.
function mostRecentlyClosed(date = new Date()) {
  const { hour, minute, weekday } = nyParts(date);
  if (weekday === "Sat" || weekday === "Sun") return null;
  const m = hour * 60 + minute;
  if (m >= 16 * 60 + 5) return "ny-pm";
  if (m >= 12 * 60 + 5) return "ny-am";
  if (m >= 6 * 60 + 5) return "london";
  return null;
}

function dateMsFromNyHM(hour, minute) {
  const now = Date.now();
  for (let off = 0; off < 26 * 60; off += 1) {
    const probe = now + off * 60_000;
    const p = nyParts(new Date(probe));
    if (p.hour === hour && p.minute === minute && p.weekday !== "Sat" && p.weekday !== "Sun") {
      return Math.floor(probe / 60_000) * 60_000;
    }
  }
  return null;
}

function nextTrigger() {
  const candidates = TRIGGERS
    .map((t) => ({ session: t.session, at: dateMsFromNyHM(t.hour, t.minute) }))
    .filter((c) => c.at != null && c.at > Date.now())
    .sort((a, b) => a.at - b.at);
  return candidates[0] || null;
}

async function summaryPathFor(session) {
  const { date } = nyParts();
  const dir = path.join(REPO_ROOT, "state", "session", date, session);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "summary.md");
}

async function hasSummary(session) {
  try {
    await fs.stat(await summaryPathFor(session));
    return true;
  } catch {
    return false;
  }
}

async function runWrapFor(session) {
  if (!session) return;
  if (_running) return;
  _running = true;
  _send?.("wrap:status", { state: "running", session });
  try {
    if (await hasSummary(session)) {
      _send?.("wrap:status", { state: "skipped", session, reason: "already wrapped" });
      return;
    }
    const memory = await readSessionMemoryFor(session);
    const memoryBlock = memory
      ? `\n\nSESSION MEMORY:\n${memory}\n`
      : "\n\nSESSION MEMORY: _no memory files for this session — wrap with whatever you can infer; explicitly note the gap._\n";

    const text = `Run the SESSION SUMMARY for the ${session.toUpperCase()} session.${memoryBlock}
Steps:
1. Synthesize Pillar 1 + Pillar 2 + LTF bias into a one-paragraph bias picture (cite prices via JSON paths where applicable).
2. Write one paragraph describing what happened — did setups fire / confirm; the session's narrative.
3. List 1–2 bullets for what to watch in the next session.
4. End the turn by calling mcp__tv__surface_session_summary with session="${session}" and the structured payload. Do NOT call surface_setup or surface_no_trade.`;

    await userTurn({
      text,
      onEvent: (e) => {
        if (e.type === "chunk") _send?.("chat:chunk", e);
        else if (e.type === "tool_call") _send?.("chat:tool_call", e);
        else if (e.type === "turn_complete") _send?.("chat:turn_complete", e);
        else if (e.type === "error") _send?.("app:error", { source: "session-wrap", message: e.message });
      },
    });
    _send?.("wrap:status", { state: "idle", session });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[session-wrap] run failed", err);
    _send?.("wrap:status", { state: "error", session, message: String(err?.message || err) });
  } finally {
    _running = false;
  }
}

export async function bootstrap({ send }) {
  _send = send;
  // App-open: if today's most-recently-closed session has no summary, fire it now.
  const session = mostRecentlyClosed();
  if (session) {
    const has = await hasSummary(session);
    if (!has) runWrapFor(session).catch(() => {});
  }
  scheduleNextBoundary();
}

function scheduleNextBoundary() {
  if (_timer) clearTimeout(_timer);
  const next = nextTrigger();
  if (!next) return;
  const ms = next.at - Date.now();
  _timer = setTimeout(async () => {
    await runWrapFor(next.session);
    scheduleNextBoundary();
  }, ms);
  // eslint-disable-next-line no-console
  console.log("[session-wrap] next trigger", next.session, "in", Math.round(ms / 1000), "s");
}

export function stopScheduler() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

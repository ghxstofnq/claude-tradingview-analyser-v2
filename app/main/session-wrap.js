// Session-wrap — schedules + completion check. Scheduler lives in
// scheduled-turn.js; this file specifies the wrap-specific bits.
//
// Public surface (unchanged):
//   bootstrap({send})

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeScheduledTurn } from "./scheduled-turn.js";
import { readSessionMemoryFor } from "./tools/surface.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Schedule: 5 minutes after each session close so the final bar's state
// is settled.
const TRIGGERS = [
  { session: "london", hour: 6,  minute: 5 },
  { session: "ny-am",  hour: 12, minute: 5 },
  { session: "ny-pm",  hour: 16, minute: 5 },
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

// Most-recently-closed session for today, or null if no session has closed.
function mostRecentlyClosed(date = new Date()) {
  const { hour, minute, weekday } = nyParts(date);
  if (weekday === "Sat" || weekday === "Sun") return null;
  const m = hour * 60 + minute;
  if (m >= 16 * 60 + 5) return "ny-pm";
  if (m >= 12 * 60 + 5) return "ny-am";
  if (m >= 6 * 60 + 5) return "london";
  return null;
}

async function summaryPathFor(session) {
  const { date } = nyParts();
  const dir = path.join(REPO_ROOT, "state", "session", date, session);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "summary.md");
}

async function isAlreadyDone(session) {
  try {
    await fs.stat(await summaryPathFor(session));
    return true;
  } catch {
    return false;
  }
}

async function buildPrompt(session) {
  const memory = await readSessionMemoryFor(session);
  const memoryBlock = memory
    ? `\n\nSESSION MEMORY:\n${memory}\n`
    : "\n\nSESSION MEMORY: _no memory files for this session — wrap with whatever you can infer; explicitly note the gap._\n";

  return `Run the SESSION SUMMARY for the ${session.toUpperCase()} session.${memoryBlock}
Steps:
1. Synthesize Pillar 1 + Pillar 2 + LTF bias into a one-paragraph bias picture (cite prices via JSON paths where applicable).
2. Write one paragraph describing what happened — did setups fire / confirm; the session's narrative.
3. List 1–2 bullets for what to watch in the next session.
4. End the turn by calling mcp__tv__surface_session_summary with session="${session}" and the structured payload. Do NOT call surface_setup or surface_no_trade.`;
}

const _driver = makeScheduledTurn({
  name: "session-wrap",
  purpose: "wrap",
  statusChannel: "wrap:status",
  triggers: TRIGGERS,
  activeSessionFn: mostRecentlyClosed,
  isAlreadyDoneFn: isAlreadyDone,
  buildPromptFn: buildPrompt,
});

export const bootstrap = _driver.bootstrap;
export const stopScheduler = _driver.stop;

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
import { userTurn } from "./sdk.js";
import { record as recordMetric } from "./metrics.js";
import { getPersistentMemory } from "./persistent-memory.js";

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
Required action:
1. Read the chain frontmatter (chain_audit inputs):
   - <sdir>/pillar1.md frontmatter → brief.{pillar_grade, no_trade_reason, chain_status}; per-symbol primary_draw / htf_destination.
   - <sdir>/ltf-bias.md frontmatter → leader, ltf_bias, htf_ltf_alignment, grade_cap, chain_status, backfilled (if present).
   - <sdir>/setups.jsonl → count of confirmed setups, list of (model, side, outcome) for each.
   - quote.last from a fresh tv_analyze_fast → did price reach the brief's primary_draw?
2. Synthesize Pillar 1 + Pillar 2 + LTF bias into a one-paragraph bias picture. CITE THE CHAIN — name the primary_draw, the htf_destination, what NY did, what alignment was, what fired. Use JSON paths for prices.
3. Write one paragraph describing what happened — what setups fired/confirmed, the session's narrative.
4. List 1–2 bullets for what to watch in the next session, referencing any still-untaken HTF draws or unresolved divergence.
5. End the turn by calling mcp__tv__surface_session_summary with session="${session}" and the structured payload. The summary's frontmatter should carry a chain_audit block summarizing what each phase produced (brief: primary_draw + chain_status, open_reaction: leader + alignment + chain_status, entry_hunt: setups_count + max_grade_reached, outcome: primary_draw_reached bool). Skip surface_setup and surface_no_trade for wrap turns.`;
}

// Post-wrap memory-review turn — fires after each successful wrap. The
// review reads <sdir>/summary.md + setups.jsonl and decides whether to
// update persistent memory with trader preferences or cross-day patterns.
// Modeled on Hermes Agent's background_review fork
// (docs/research/hermes-memory-architecture.md, Layer 4).
//
// Fire-and-forget: errors are caught + logged, never bubble back to fail
// the wrap. Timeout is tight (60s) — review is bounded, and failure
// shouldn't block the next bar-close.
async function fireReviewTurn(session) {
  // Inject a usage hint so the model knows when consolidation matters.
  // Loads memory just to get the current usage % — cheap (one disk read).
  let usageHint = "";
  try {
    const mem = getPersistentMemory();
    await mem.load();
    const userPct = mem.userEntries.length === 0
      ? 0
      : Math.floor(mem.userEntries.join("").length / 1500 * 100);
    const memPct = mem.memoryEntries.length === 0
      ? 0
      : Math.floor(mem.memoryEntries.join("").length / 2000 * 100);
    if (userPct > 90 || memPct > 90) {
      usageHint =
        `\n\nNOTE: persistent memory usage is high (user=${userPct}%, memory=${memPct}%). ` +
        "Consider replacing or removing existing entries rather than adding new ones.";
    }
  } catch {
    // Don't block the review on a memory-read failure; the system prompt
    // will tell the model the same thing.
  }

  const text =
    `Review the ${session.toUpperCase()} session that just wrapped. ` +
    `Read state/session/<date>/${session}/summary.md and ` +
    `state/session/<date>/${session}/setups.jsonl, then update persistent ` +
    `memory per your system prompt guidance.${usageHint}`;

  recordMetric({ kind: "review", event: "started", session });
  const startedAt = Date.now();
  let errored = false;
  let usage = null;
  try {
    await userTurn({
      text,
      purpose: "review",
      // Tight timeout — review is bounded; failure shouldn't block next session.
      timeoutMs: 60_000,
      onEvent: (e) => {
        if (e.type === "usage") { usage = e.usage; }
        else if (e.type === "error") {
          errored = true;
          // eslint-disable-next-line no-console
          console.warn(`[session-wrap] review turn error`, e.message);
        }
      },
    });
    recordMetric({
      kind: "review",
      event: errored ? "failed" : "succeeded",
      session,
      durationMs: Date.now() - startedAt,
      usage,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[session-wrap] review turn threw`, err?.message || err);
    recordMetric({
      kind: "review",
      event: "failed",
      session,
      reason: String(err?.message || err),
      durationMs: Date.now() - startedAt,
    });
  }
}

const _driver = makeScheduledTurn({
  name: "session-wrap",
  purpose: "wrap",
  statusChannel: "wrap:status",
  triggers: TRIGGERS,
  activeSessionFn: mostRecentlyClosed,
  isAlreadyDoneFn: isAlreadyDone,
  buildPromptFn: buildPrompt,
  onSuccessFn: fireReviewTurn,
});

export const bootstrap = _driver.bootstrap;
export const stopScheduler = _driver.stop;
export const rearmScheduler = _driver.rearm;

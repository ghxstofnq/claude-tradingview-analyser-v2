// Agent SDK integration for the main process.
//
// One async function per user turn — calls query() with our analyze.md as
// the system prompt, resumes the previous session id so the conversation
// persists across the trading session.
//
// Events emitted via onEvent:
//   { type: "chunk", text }          — streamed text delta
//   { type: "tool_call", name, args } — Claude invoked a tool (Phase 4+)
//   { type: "turn_complete" }         — final result; turn is done
//   { type: "error", message }        — something failed

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, tool, createSdkMcpServer, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { tvAnalyzeFull, tvAnalyzeFast } from "./tools/tv-analyze.js";
import { tvAlertCreate, tvAlertList, tvAlertDeleteOne } from "./tools/tv-alerts.js";
import {
  surfaceSetup,
  surfaceNoTrade,
  surfaceSessionBrief,
  surfaceOpenReaction,
  surfaceLtfBias,
  surfaceSessionSummary,
  surfaceLeaderDecision,
} from "./tools/surface.js";
import { getPersistentMemory, setBacktestContext, clearBacktestContext } from "./persistent-memory.js";
import { setBacktestSessionContext, clearBacktestSessionContext } from "./sessions.js";
import { extractUsageFromResult } from "./usage.js";
import { classifyError } from "./error-classifier.js";
import { findPartialReferences, composePhaseWithPartials, joinSystemPrompt } from "./prompt-composer.js";
import { validateTurnSurfaceContract } from "./turn-surface-contract.js";
import { resolveLlmProvider, runCodexTextTurn, normalizeProviderName } from "./llm-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "prompts");
const KERNEL_PATH = path.join(PROMPTS_DIR, "kernel.md");
const PARTIALS_DIR = path.join(PROMPTS_DIR, "partials");
const PHASE_PATHS = {
  "bar-close": path.join(PROMPTS_DIR, "phase-bar-close.md"),
  "brief":     path.join(PROMPTS_DIR, "phase-brief.md"),
  "catch-up":  path.join(PROMPTS_DIR, "phase-catch-up.md"),
  "wrap":      path.join(PROMPTS_DIR, "phase-wrap.md"),
  "chat":      path.join(PROMPTS_DIR, "phase-chat.md"),
  "review":    path.join(PROMPTS_DIR, "phase-review.md"),
};

// (Was `let _systemPrompt = null` for caching — removed when hot-reload
// landed. loadSystemPrompt(purpose) re-reads + composes per call now.)
// Per-purpose session IDs. Splitting the conversation by purpose stops
// brief / wrap / bar-close / chat from contaminating each other's history.
// One global _sessionId — the old design — meant a NY AM brief and a 13:00
// bar-close ended up resuming the same conversation, and yesterday's London
// brief was in context when today's London brief ran.
const _sessionIds = new Map(); // purpose/provider key -> sessionId
function sessionKeyForPurposeProvider(purpose, providerName = 'claude') {
  const normalized = normalizeProviderName(providerName);
  return normalized === 'claude' ? String(purpose || '') : `${String(purpose || '')}:${normalized}`;
}
let _mcpServer = null;
let _allowedToolNames = [];
let _memoryToolName = "";  // populated in buildMcpServer; whitelisted per-purpose

// Global mutex serializing all userTurn calls. There are four callers
// (chat:send_message, session-brief, session-wrap, bar-close) and three
// auto-firing schedulers. Without the mutex, a 13:00 brief and a 13:01
// bar-close tick start in parallel — even with per-purpose session ids,
// resource contention on the Claude subprocess + the shared MCP server
// makes parallel turns unsafe in practice. Mutex keeps it predictable.
let _turnInFlight = Promise.resolve();

// Handle on the in-flight turn so cancelCurrentTurn() can abort it from
// outside. Cleared when the turn finishes naturally. Lets the UI offer
// a "stop" button when Claude is mid-thought (token-burning loop, wrong
// analysis worth aborting, etc.) without forcing an app restart.
let _currentCancel = null; // { cancelToken, q, purpose }

// Auth circuit breaker. If Claude Code reports local auth is missing, stop
// auto schedulers from burning a failed SDK turn every bar. Manual login + app
// restart clears this in-memory flag; full resetSession() also clears it for tests.
// Scoped resetSession(purpose) must NOT clear it — chat reset should not re-enable autos.
let _authBlocked = null; // { ts, message }
export function isClaudeAuthBlocked() { return _authBlocked; }
function markClaudeAuthBlocked(message) {
  if (_authBlocked) return;
  _authBlocked = { ts: Date.now(), message };
  // eslint-disable-next-line no-console
  console.warn("[sdk] Claude auth blocked — suppressing auto turns until restart/login", message);
}

// Global activity broadcaster — every event from every userTurn (any
// purpose) is forwarded to all registered listeners with a `purpose` tag.
// Lets a single subscriber (ipc.js → renderer) show "what Claude is
// currently doing" across all purposes, not just the chat purpose.
const _activityListeners = new Set();
export function addActivityListener(fn) { _activityListeners.add(fn); }
export function removeActivityListener(fn) { _activityListeners.delete(fn); }
function _broadcastActivity(ev) {
  for (const fn of _activityListeners) {
    try { fn(ev); } catch { /* listener errors must not break the turn */ }
  }
}

// Wall-clock timeout per turn. If Claude / the network hangs, we don't want
// the mutex held forever — that would freeze every other caller.
//
// Observed (2026-05-25): briefs legitimately need 2-5 minutes — tv_analyze_full
// is ~15s, Opus 4.7 high-effort reasoning over a dual-symbol bundle plus two
// surface tool calls adds up. Bar-close turns are smaller — closer to 30-90s.
// Default to 300s; bar-close + chat callers should pass a tighter value
// (90s) so a stalled per-bar turn doesn't block the next minute's tick.
const DEFAULT_TURN_TIMEOUT_MS = 300_000;

// Hot-reload prompts: re-read each prompt file ONLY when its mtime changes.
// Each purpose loads two files (kernel.md + phase-<purpose>.md); both are
// cached independently. With bar-close at ~60/hour plus brief/wrap/chat,
// stat-on-every-turn is cheap, readFile-only-if-changed avoids MBs/hour
// of disk I/O re-reading unchanged files.
//
// SAFETY: keep a last-known-good copy per file. If a hot read returns an
// empty / partial / oversized file (editor mid-save), use the cached
// version instead of letting Claude operate on garbage.
const _promptCache = new Map(); // absPath -> { text, mtime }
const PROMPT_MIN_LENGTH = 500;          // phase-chat.md is ~2.5 KB; <500 = mid-save
const PROMPT_MAX_LENGTH = 500_000;      // hard cap so a corrupt file doesn't OOM

async function loadPromptFile(absPath, label) {
  const cached = _promptCache.get(absPath);
  let text = cached?.text;
  try {
    const stat = await fs.stat(absPath);
    if (!cached || stat.mtimeMs !== cached.mtime) {
      const fresh = await fs.readFile(absPath, "utf8");
      if (fresh.length < PROMPT_MIN_LENGTH || fresh.length > PROMPT_MAX_LENGTH) {
        // eslint-disable-next-line no-console
        console.warn(`[sdk] ${label} looks wrong size (${fresh.length} bytes) — using last-known-good`);
      } else {
        text = fresh;
        _promptCache.set(absPath, { text: fresh, mtime: stat.mtimeMs });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[sdk] ${label} stat/read failed (${err?.message}) — using last-known-good`);
  }
  if (!text) {
    throw new Error(`${label} read failed and no last-known-good available`);
  }
  return text;
}

async function loadSystemPrompt(purpose) {
  const phasePath = PHASE_PATHS[purpose] || PHASE_PATHS["bar-close"];
  const [kernel, phaseRaw] = await Promise.all([
    loadPromptFile(KERNEL_PATH, "kernel.md"),
    loadPromptFile(phasePath, `phase-${purpose}.md`),
  ]);

  // Scan phase body for <!-- @partial:NAME --> markers and read each
  // referenced partial. When no markers exist (current state during
  // migration), the loop is a no-op and the composed phase === phaseRaw.
  const partialNames = findPartialReferences(phaseRaw);
  const partialContents = new Map();
  for (const name of partialNames) {
    const partialPath = path.join(PARTIALS_DIR, `${name}.md`);
    const content = await loadPromptFile(partialPath, `partials/${name}.md`);
    partialContents.set(name, content);
  }
  const composedPhase = composePhaseWithPartials(phaseRaw, partialContents);

  // Persistent-memory block — prepended (most cache-stable position). Loaded
  // by runOneTurn() at the start of each turn so the snapshot is fresh-per-
  // turn but byte-stable across the turn's many messages. See
  // app/main/persistent-memory.js for the snapshot-freeze contract.
  const memBlock = getPersistentMemory().formatBlockForSystemPrompt();

  // Return as string[] so the SDK places a prompt-cache breakpoint at
  // SYSTEM_PROMPT_DYNAMIC_BOUNDARY: blocks before are part of the
  // cross-session-cacheable prefix (memBlock stable per day, kernel
  // permanent); composedPhase varies per purpose and sits after.
  // Mixed-purpose sequences hit the shared prefix instead of paying full
  // input cost on every switch. joinSystemPrompt() in prompt-composer.js
  // reverses this for tests/scripts that compare composed prompts as text.
  return [
    ...(memBlock ? [memBlock] : []),
    kernel,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    composedPhase,
  ];
}

// Purposes that can WRITE to persistent memory via the memory tool.
// Bar-close fires ~420×/day — keeping it read-only prevents an over-eager
// model from spamming memory writes on every minute close. Chat is the
// natural surface for trader-driven corrections; wrap and review are the
// two reflective phases.
const PURPOSES_WITH_MEMORY_WRITE = new Set(["chat", "wrap", "review"]);

function buildAllowedToolNames(purpose) {
  const base = ["Read", "Glob", ..._allowedToolNames];
  if (_memoryToolName && PURPOSES_WITH_MEMORY_WRITE.has(purpose)) {
    base.push(_memoryToolName);
  }
  return base;
}

// ---------------------------------------------------------------------
// Memory-tool guardrails
//
// The memory tool is char-capped + drift-detected at the store level,
// but those defenses sit BELOW the LLM — once a write succeeds the cap
// is silently consumed. Two additional caps live HERE so a misbehaving
// model can't burn the budget all in one turn:
//
//  1. Per-turn cap   — at most MAX_WRITES_PER_TURN successful writes
//     per userTurn. Reset by runOneTurn().
//  2. Per-target throttle — same target can't be written more than
//     once every THROTTLE_MS. Stops "add → immediately replace" loops.
//
// Counters live module-scope. resetMemoryGuardrails() runs at the start
// of each userTurn (see runOneTurn).
// ---------------------------------------------------------------------
const MAX_WRITES_PER_TURN = 3;
const THROTTLE_MS = 30_000;
let _memoryWritesThisTurn = 0;
const _lastWriteByTarget = new Map(); // target -> epoch ms

function resetMemoryGuardrails() {
  _memoryWritesThisTurn = 0;
  // Don't clear _lastWriteByTarget — the throttle spans across turns
  // (per-turn cap handles within-turn floods; throttle handles
  // back-to-back-turn floods).
}

function checkMemoryGuardrails(action, target) {
  // remove is cheap and recoverable; don't count it toward the per-turn cap.
  if (action === "remove") return { ok: true };
  if (_memoryWritesThisTurn >= MAX_WRITES_PER_TURN) {
    return {
      ok: false,
      reason:
        `memory write rate limit: at most ${MAX_WRITES_PER_TURN} writes per turn. ` +
        "consolidate your saves into fewer, denser entries — declarative facts, " +
        "not paragraphs.",
    };
  }
  const last = _lastWriteByTarget.get(target);
  if (last && Date.now() - last < THROTTLE_MS) {
    const wait = Math.ceil((THROTTLE_MS - (Date.now() - last)) / 1000);
    return {
      ok: false,
      reason:
        `memory throttle: ${target} was written ${Math.floor((Date.now() - last) / 1000)}s ago; ` +
        `wait ${wait}s before another ${target} write, or use action='replace' to update an existing entry.`,
    };
  }
  return { ok: true };
}

function recordMemoryWrite(target) {
  _memoryWritesThisTurn += 1;
  _lastWriteByTarget.set(target, Date.now());
}

function shouldRecordMemoryWrite(action, result) {
  return result?.success === true && action !== "remove";
}

// Exported for tests only.
export const _guardrailsForTests = {
  checkMemoryGuardrails,
  recordMemoryWrite,
  resetMemoryGuardrails,
  shouldRecordMemoryWrite,
  getState: () => ({
    writesThisTurn: _memoryWritesThisTurn,
    lastByTarget: new Map(_lastWriteByTarget),
    MAX_WRITES_PER_TURN,
    THROTTLE_MS,
  }),
};

// CallToolResult envelope expected by the SDK's MCP tool API.
function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function err(message) {
  return { content: [{ type: "text", text: String(message) }], isError: true };
}

function buildMcpServer() {
  const tools = [
    tool(
      "tv_analyze_full",
      "Run the full multi-timeframe TradingView analysis sweep. Returns { path } pointing to the JSON bundle. Pass `pair` during pre-session or open-reaction phases to capture both symbols in one bundle.",
      {
        pair: z.string().optional().describe('Dual-symbol scan format: "<primary>,<secondary>" (e.g. "MNQ1!,MES1!"). Adds a top-level `pair` block to the bundle with both symbols\' data + `leader_evidence`. Required for pre-session and open-reaction work; omit during entry-hunt (which runs single-symbol on the leader).'),
        baseline_secondary: z.string().optional().describe("Per-symbol baseline path for the secondary symbol when using `pair`. Default `state/baseline-<secondary>.json`."),
      },
      async (args) => {
        try {
          const res = await tvAnalyzeFull({
            pair: args?.pair,
            baselineSecondary: args?.baseline_secondary,
          });
          return ok(res);
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "tv_analyze_fast",
      "Run a fast pillar-3 analysis poll, optionally reusing a cached baseline. Returns { path }. Pass `pair` during open-reaction to keep the dual-symbol bundle structure.",
      {
        baseline: z.string().optional().describe("Path to a previously captured baseline JSON; omit on first call. Default `state/baseline-<primary>.json` when paired, else `state/baseline.json`."),
        pair: z.string().optional().describe('Dual-symbol scan format: "<primary>,<secondary>". MUST be passed during open-reaction so the bundle has a `pair` block + `leader_evidence`. Omit during entry-hunt (the analyzer auto-short-circuits to single-symbol when pair-decision.json exists).'),
        baseline_secondary: z.string().optional().describe("Per-symbol baseline path for the secondary symbol when using `pair`. Default `state/baseline-<secondary>.json`. Required for fast paired scans — without it the secondary falls back to a fresh multi-TF sweep (~13s)."),
      },
      async (args) => {
        try {
          const res = await tvAnalyzeFast({
            baseline: args?.baseline,
            pair: args?.pair,
            baselineSecondary: args?.baseline_secondary,
          });
          return ok(res);
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "tv_alert_create",
      "Create a TradingView price alert.",
      {
        price: z.number().describe("Price level to alert on"),
        label: z.string().describe("Human-readable label / message attached to the alert"),
        condition: z.string().optional().describe("Optional condition: crossing | greater_than | less_than (default crossing)"),
      },
      async (args) => {
        try {
          await tvAlertCreate(args);
          return ok({ ok: true });
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "tv_alert_list",
      "List the trader's TradingView alerts and their statuses.",
      {},
      async () => {
        try {
          return ok(await tvAlertList({}));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "tv_alert_delete",
      "Remove a single TradingView alert by alert_id. Use tv_alert_list first to look up the id if the trader names the alert by description rather than id.",
      {
        id: z.string().describe("alert_id returned by tv_alert_list or tv_alert_create"),
      },
      async (args) => {
        try {
          return ok(await tvAlertDeleteOne(args));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "surface_setup",
      "Render a graded trade setup as a card in the workstation rail. Call this once Claude has identified a valid setup and the trader should decide Accept/Reject. Reason in prose first; call this tool LAST in the turn.",
      {
        grade: z.enum(["A+", "B", "no-trade"]).describe("Setup grade per the strategy enum"),
        model: z.string().describe("Entry model: MSS / Trend / Inversion"),
        direction: z.enum(["long", "short"]).describe("Trade direction"),
        entry: z.number().describe("Entry price"),
        stop: z.number().describe("Stop-loss price"),
        tp1: z.number().describe("First take-profit"),
        tp2: z.number().describe("Second take-profit"),
        invalidation: z.number().describe("Price at which the setup is invalidated"),
        rr: z.number().optional().describe("Risk:reward ratio"),
        confirmation_status: z.enum(["confirmed", "candidate", "invalidated"]).optional(),
        tf: z.enum(["1m", "5m"]).optional().describe('Timeframe of the bar that triggered this setup ("1m" or "5m"). Stamp it on the card so the trader can see at a glance whether the setup is a 1m or 5m read. Match the tf in the per-bar prompt that fired this turn.'),
        pillar_breakdown: z.array(z.object({
          name: z.string().describe("Pillar name: 'Draw & Bias' / 'Price-Action Quality' / 'Entry + Confirmation'"),
          status: z.enum(["pass", "weak", "fail", "pending"]),
          elements: z.array(z.object({
            name: z.string(),
            status: z.enum(["pass", "weak", "fail", "pending"]),
          })).min(1),
        })).optional().describe("3-pillar alignment breakdown rendered in the LIVE PILLAR ALIGNMENT panel. Required for A+ setups (runtime-enforced in surface.js); panel hidden when omitted on B / no-trade."),
        label: z.string().optional().describe("Optional short label, default ACTIVE SETUP"),
      },
      async (args) => {
        try {
          return ok(await surfaceSetup(args));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "surface_no_trade",
      "Mark the current period as no-trade in the UI. Use when no valid setup is in play; silence is also fine, this tool is for explicit discipline.",
      {
        reason: z.string().describe("Short reason: e.g. 'no entry model in play', 'price quality weak'"),
      },
      async (args) => {
        try {
          return ok(await surfaceNoTrade(args));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "surface_open_reaction",
      "Persist a running-log entry to state/session/<date>/<session>/open-reaction.md. Call once per bar during the open-reaction phase. Latest read goes to the top; previous reads archived below.",
      {
        session: z.enum(["london", "ny-am", "ny-pm"]).describe("Which session this read belongs to (matches the phase)"),
        minutes_into_phase: z.number().describe("Minutes since the open-reaction window started (0–15)"),
        latest_read: z.string().describe("One paragraph — what NY just did, with cited prices"),
        bias_direction: z.enum(["bullish", "bearish", "mixed", "unclear"]).describe("Bias direction so far"),
        watching: z.string().describe("One line — the level / FVG that will resolve the bias"),
      },
      async (args) => {
        try {
          return ok(await surfaceOpenReaction(args));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "surface_ltf_bias",
      "Persist the finalized LTF bias to state/session/<date>/<session>/ltf-bias.md. Call ONCE at the end of the open-reaction window (when minutes_into_phase >= 14).",
      {
        session: z.enum(["london", "ny-am", "ny-pm"]).describe("Which session this finalizes"),
        ltf_bias: z.enum(["bullish", "bearish", "mixed", "stand_aside"]).describe("Finalized LTF bias"),
        htf_ltf_alignment: z.enum(["aligned", "divergent", "unclear"]).describe("How LTF bias relates to HTF draw"),
        reasoning: z.string().describe("One paragraph, cited"),
        // ---- Strategy chain handoff fields (Section 3.6 of spec) ----
        // Optional for backwards-compat. Once the chain is live, the open_reaction
        // prompt requires them; old callers can still surface a minimal payload.
        leader: z.string().optional().describe("The chosen leader symbol (mirrors pair-decision.json) when in dual-symbol mode."),
        is_retrace_day: z.boolean().optional().describe("True when divergent + HTF draw still untouched. Caps grade at B."),
        entry_model_priority: z.enum(["MSS", "Trend", "Inversion", "undecided"]).optional().describe("Mechanically computed from htf_ltf_alignment × engine signals. See cli/lib/entry-model-priority.js."),
        priority_reason: z.string().optional().describe("One-line cite for the priority decision (e.g. 'failure_swings[0]')."),
        grade_cap: z.enum(["A+", "B"]).optional().describe("Max grade entry_hunt can surface this session. divergent → B."),
        chain_status: z.string().optional().describe("clean | degraded:<reason> | divergent | backfilled:open_reaction"),
        // Inputs for the entry_model_priority cross-check in surface.js.
        // Optional — when omitted, surface.js skips the cross-check.
        pillar2_verdict: z.enum(["good", "marginal", "poor"]).optional().describe("Latest Pillar 2 verdict — used to cross-check entry_model_priority."),
        failure_swings_present: z.boolean().optional().describe("True if a recent failure_swing exists in the engine. Cross-check input."),
        most_recent_structure: z.object({ event: z.string(), dir: z.string(), confirmed_ms: z.number().optional() }).optional().describe("Latest engine structure event. Cross-check input."),
        inverted_fvg_present: z.boolean().optional().describe("True if an opposing FVG has flipped to state=inverted. Cross-check input."),
      },
      async (args) => {
        try {
          return ok(await surfaceLtfBias(args));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "surface_session_summary",
      "Persist the session wrap to state/session/<date>/<session>/summary.md. Call ONCE at the end of a session-summary turn (fired automatically a few minutes after the session closes).",
      {
        session: z.enum(["london", "ny-am", "ny-pm"]).describe("Which session is being wrapped"),
        bias_picture: z.string().describe("One paragraph synthesizing P1 + P2 + LTF bias, prices cited"),
        what_happened: z.string().describe("One paragraph — did setups fire / confirm; the session's narrative"),
        watch_next_session: z.array(z.string()).describe("One or two bullets — what to watch in the next session"),
        // Free-form prose rendered in the REVIEW popover's WRAP · CLAUDE
        // section. 2-4 sentences in the trader's voice — what happened,
        // which setups paid, lessons for next session.
        prose_summary: z.string().min(50).max(1000).optional().describe(
          "2-4 sentences in your own words on what happened this session. " +
          "Call out which setups paid, which didn't, and one lesson worth remembering for next session. " +
          "Example: 'Two A+ shorts in line with the bearish HTF. First MSS at 29105 sweep hit TP1 in 9 bars — textbook. Second (Trend continuation at 10:18) stopped — entered late, RR was already 1:0.7. Day +1.7R. Memory note: late-entry continuations are still hitting stops more than 50% — flag for next session.'",
        ),
      },
      async (args) => {
        try {
          return ok(await surfaceSessionSummary(args));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "surface_session_brief",
      "Render the SESSION BRIEF in the PREP panels. Call this ONCE per symbol at the end of a session-brief turn (dual-symbol turns call it TWICE — once for each symbol). Persists to state/session/<date>/<session>/brief-<symbol>.json (and brief.json as legacy mirror).",
      {
        session: z.enum(["london", "ny-am", "ny-pm"]).describe("Which session this brief is for"),
        symbol: z.string().optional().describe("Which symbol this brief is for (e.g. 'MNQ1!' or 'MES1!'). Required in dual-symbol mode — call surface_session_brief once per symbol. Omit for legacy single-symbol mode."),
        brief: z.string().describe("Headline paragraph for the Morning Brief panel. Every numeric price must be followed by (json.path); see analyze.md <rules>."),
        htf_bias: z.array(z.object({
          tf: z.enum(["DAILY", "4H", "1H"]),
          bias: z.enum(["BULLISH", "BEARISH", "MIXED", "NEUTRAL"]),
          // The note must cite a path AT THIS TF. Citing engine.* (current
          // chart TF = 1m) in a 4H or 1H row is a wrong-TF citation — the
          // most-common failure observed 2026-05-26.
          note: z.string().refine(
            (s) => /\((engine_by_tf|bars_by_tf|gates|engine)[^)]+\)/.test(s),
            { message: "note must cite a JSON path (e.g. '(engine_by_tf.h4.structures[0])'). Wrong-TF cites are bugs — cite engine_by_tf.<tf> / bars_by_tf.<tf> for the row's tf." },
          ),
        })).describe("HTF bias per timeframe — exactly DAILY / 4H / 1H. Each note must cite a path at its own TF."),
        overnight: z.array(z.object({
          k: z.string(),
          v: z.string(),
          tone: z.enum(["green", "red", "amber"]).optional(),
        })).describe("Overnight context rows: Asia range, London range, what was swept, direction overnight, etc. Prices in v must be cited."),
        key_levels: z.array(z.object({
          // Canonical engine name — PWH/PDH/AS_H/AS_L/LO_H/LO_L/NYAM_H/NYAM_L/PDL/PWL/ONH/ONL.
          // Do NOT decorate with state suffixes like "AS.L (swept-rejected)" —
          // the state field below already carries that. Decorated names break
          // the day-over-day CHANGED-SINCE diff (Prep.jsx normalizes via
          // parenthetical strip, but the canonical name is still the right
          // input).
          name: z.string().describe("Canonical name only — PWH/PDH/AS_H/AS_L/LO_H/LO_L/NYAM_H/NYAM_L/PDL/PWL/ONH/ONL. For non-session-level rows (FVG bounds, structure points), use a stable short label without parenthetical suffixes."),
          // Numeric only. Previously z.union([number, string]) — Claude
          // could submit price: "PDH" and the UI rendered the string in
          // the price column. The number → format-on-render path keeps
          // formatting (e.g. "21 528.50") under the renderer's control.
          price: z.number().finite().describe("Numeric price — formatting is the renderer's job"),
          state: z.enum(["taken", "untaken"]),
          // Optional JSON path the price was sourced from. UI renders as a
          // tooltip / subtle badge. Empty allowed for legacy briefs.
          cite: z.string().optional().describe("JSON path the price came from — e.g. 'pair.symbols.MNQ1!.gates.engine.pillar1.session_levels.PDH.price'. Populates a tooltip in the KEY LEVELS panel."),
        })).describe("Key levels for the session, sorted high → low. Use canonical names; state is the source of truth for taken/untaken."),
        pillar_grade: z.enum(["A+", "B", "no-trade"]).describe(
          "Roll-up grade for Pillars 1+2 (Pillar 3 is pending until LIVE). " +
          "A+: HTF agrees across ≥2 of D/4H/1H with cited evidence AND ≥1 untaken HTF draw AND Pillar 2 range_quality=good + displacement∈{clean,acceptable} + candle≠doji_wick. " +
          "B: Pillars 1+2 align with EXACTLY ONE weaker element. " +
          "no-trade: ≥2 weak/missing elements, OR any HTF TF NEUTRAL because data wasn't read, OR engine stale. " +
          "surface.js postValidate rejects 'B' when 2+ pillars are weak/fail.",
        ),
        pillars: z.array(z.object({
          name: z.string(),
          status: z.enum(["pass", "weak", "fail", "pending"]),
          // Each pillar must articulate at least one element. Was
          // unconstrained — Claude could submit elements:[] and the
          // UI rendered a status with no detail underneath (a pill
          // marked "pass" with nothing to verify against).
          elements: z.array(z.object({
            name: z.string(),
            status: z.enum(["pass", "weak", "fail", "pending"]),
          })).min(1, "each pillar must list at least one element so the panel shows what was graded"),
        })).describe("Three pillars: 'Draw & Bias', 'Price-Action Quality', 'Entry Model + Confirmation' (the third is pending until LIVE)"),
        // plan: prose paragraph for headline. scenarios: structured IF/THEN
        // rows so the trader can see "IF NY opens above X THEN bias is Y /
        // IF below THEN Z" at a glance. Was: one paragraph of unstructured
        // prose; trader had to parse it on every read.
        plan: z.string().describe("One-paragraph headline plan — bias direction, what looks A+, what would flip it"),
        scenarios: z.array(z.object({
          // Stable id for React keys + cross-references. e.g. "scn-1", "scn-2".
          id: z.string().describe("Stable id — 'scn-1', 'scn-2'. Used as a React key and as an anchor for future cross-references."),
          // Per-scenario grade (NOT the overall pre-session grade — that's
          // pillar_grade above). Tells the trader at a glance whether this
          // scenario is the prime candidate or a fallback.
          grade: z.enum(["A+", "B", "no-trade"]).describe("Grade for THIS scenario if it fires — independent of pillar_grade. A+ when all six elements would align if the trigger fires; B if one weaker; no-trade if a defensive scenario."),
          // condition stays — UI labels this row "TRIGGER" but the field name
          // is preserved for backward compatibility with briefs already on disk.
          condition: z.string().describe("Trigger condition — 'NY opens above 21487.25 (PDH)', 'sweep of Asia low without close back'. UI labels this row 'TRIGGER'."),
          action: z.string().describe("Reaction / bias — 'long continuation toward 21528.50 (PWH); stop below 21450.50 (AS_L)'"),
          // Anchored target with a citation. Must contain a digit so the
          // verifier and humans both know there's a real number behind it.
          target: z.string().refine((s) => /\d/.test(s), {
            message: "target must contain a cited price (a digit) — e.g. '21 528.50 (PWH)' or '21420 (engine.levels.PWH)'",
          }).describe("Anchored target with citation — e.g. '21 528.50 (PWH)' or '21 420 (engine_by_tf.h4.fvgs[0].top)'"),
        })).min(1).max(4).describe("Structured scenarios for the open. Min 1, max 4 — keep it tight, the trader reads these live. Each scenario carries its own grade so the trader sees the prime candidate at a glance."),
        // anchored_target / anchored_stop are free strings (Claude wraps
        // a price with a label like "(PDH)"), but they MUST cite an
        // actual price — empty / "TBD" / whitespace-only is a degenerate
        // state the UI renders as a blank target field. Refinement: the
        // string must contain at least one digit.
        anchored_target: z.string().refine((s) => /\d/.test(s), {
          message: "anchored_target must contain a cited price (a digit) — e.g. '21528.50 (PDH)'",
        }).describe("e.g. '21 528.50 (PDH)' — must include a numeric price"),
        anchored_stop: z.string().refine((s) => /\d/.test(s), {
          message: "anchored_stop must contain a cited price (a digit) — e.g. '21462.75 (PDL)'",
        }).describe("e.g. '21 462.75 (PDL)' — must include a numeric price"),
        // Sizing must cite its source — memory or strategy spec — so the
        // trader can verify why 0.75 R / 0.5 R was chosen. Free-string with
        // no citation was the 2026-05-26 failure mode.
        sizing_note: z.string().refine(
          (s) => /\((memory\.(USER|MEMORY)|strategy[^)]*)\)/.test(s),
          { message: "sizing_note must cite '(memory.USER)', '(memory.MEMORY)', or '(strategy.xyz)' — free-text rules are unauditable." },
        ).describe("e.g. '0.75 R · Tuesday standard (memory.USER)' — must cite (memory.USER), (memory.MEMORY), or (strategy)."),
        // ---- Strategy chain handoff fields (Section 2.3 of spec) ----
        // All optional for backwards-compat with PR #60. Once the chain is
        // live, the brief prompt will require them; ad-hoc / legacy callers
        // can still surface a minimal payload.
        primary_draw: z.object({
          tf: z.enum(["daily", "h4", "h1"]),
          kind: z.enum(["fvg", "bpr", "ifvg"]),
          dir: z.enum(["bull", "bear"]),
          top: z.number().finite(),
          bottom: z.number().finite(),
          ce: z.number().finite(),
          disp_score: z.number().finite(),
          took_liq: z.boolean(),
          state: z.enum(["fresh", "ce_tapped", "filled", "inverted", "invalidated"]),
          // Reaction + position evidence for bias derivation (strategy §2.1
          // step 3 / §2.3). Optional — emitted by the deterministic brief.
          reacted: z.boolean().optional(),
          reaction_dir: z.enum(["bull", "bear", "none"]).optional(),
          position: z.enum(["above_price", "below_price"]).optional(),
          cite: z.string().refine((s) => /engine_by_tf\.(daily|h4|h1)\.(fvgs|bprs)/.test(s), {
            message: "primary_draw.cite must point at engine_by_tf.<tf>.fvgs[N] or .bprs[N]",
          }),
        }).optional().describe("The chosen primary HTF PD array — anchor for the day. From brief_digest.symbols.<sym>.htf.<tf>.top_fvgs/top_bprs."),
        htf_destination: z.string().optional().describe('Free-string: "above 30000 buy-side" / "below 29400 sell-side" / "balanced".'),
        overnight_block: z.object({
          asia: z.object({ high: z.number(), low: z.number(), state: z.enum(["extended", "swept", "untaken"]), cite: z.string() }).optional(),
          london: z.object({ high: z.number(), low: z.number(), state: z.enum(["extended", "swept", "untaken"]), cite: z.string() }).optional(),
          untaken_above: z.array(z.object({ name: z.string(), price: z.number(), cite: z.string() })).optional(),
          untaken_below: z.array(z.object({ name: z.string(), price: z.number(), cite: z.string() })).optional(),
          overnight_verdict: z.enum(["extending_htf", "retracing_htf", "consolidating"]).optional(),
          path_to_destination: z.string().optional(),
        }).optional().describe("Structured overnight context handoff — populated by brief, consumed by open_reaction + entry_hunt."),
        htf_quality: z.object({
          h4: z.object({ range_quality: z.string(), displacement: z.string(), candle: z.string(), cite: z.string() }).optional(),
          h1: z.object({ range_quality: z.string(), displacement: z.string(), candle: z.string(), cite: z.string() }).optional(),
        }).optional().describe("HTF Pillar 2 quality verdict for h4 + h1. Strategy §3 step 3."),
        pillar2_verdict: z.enum(["good", "marginal", "poor"]).optional().describe("Final P2 verdict for the session. Gates entry_hunt — 'poor' → stand aside."),
        no_trade_reason: z.enum(["data_gap", "engine_stale", "pillar2_poor", "htf_unclear", "session_closed"]).optional().describe("Required iff pillar_grade==='no-trade'. Drives the hard-vs-soft short-circuit downstream."),
        chain_status: z.string().optional().describe("clean | degraded:<reason> | divergent | backfilled:<phase> | stale:<minutes>"),
        // Free-form prose rendered in the PREP popover's BRIEF · DETERMINISTIC
        // section. 2-4 sentences in the trader's voice — HTF context, the
        // room price has, primary draw, what you're watching for. The UI
        // does its own color emphasis via `<b>` / .green / .red / .amber
        // spans — Claude just writes natural sentences.
        prose_summary: z.string().min(50).max(1000).optional().describe(
          "2-4 sentences in your own words synthesizing the brief. Read aloud, " +
          "this should sound like the trader explaining the day's setup to a colleague. " +
          "Example: 'HTF stacks bearish D → 1H. Daily took PDH 29105 and is set up for a PDL 29050 visit; overnight held the 4H FVG 29070–29105 untaken. Pillar 2 is clean. Watching two shorts: an A+ MSS on a sweep of 29105 and a B-grade iFVG flip at 29080.'",
        ),
      },
      async (args) => {
        try {
          return ok(await surfaceSessionBrief(args));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "surface_leader_decision",
      "Persist the chosen leader symbol for a dual-symbol session to state/session/<date>/<session>/pair-decision.json. Call ONCE at the end of the open-reaction phase (minutes_into_phase >= 14), alongside surface_ltf_bias. After this fires, subsequent tv analyze --pair runs short-circuit and run single-symbol on the leader.",
      {
        session: z.enum(["london", "ny-am", "ny-pm"]).describe("Which session this decision is for"),
        primary: z.string().describe("Primary symbol from the pair (e.g. 'MNQ1!')"),
        secondary: z.string().describe("Secondary symbol from the pair (e.g. 'MES1!')"),
        leader: z.string().nullable().describe("The chosen leader symbol, or null if inconclusive (margin too small / no FVGs in window / etc.)"),
        evidence: z.object({
          primary_disp_score: z.number(),
          secondary_disp_score: z.number(),
          margin: z.number(),
          threshold: z.number(),
        }).describe("The numeric evidence from compute-leader. Always cite from pair.leader_evidence in the bundle."),
        reason: z.string().describe("The reason from compute-leader: primary_higher_disp_score | secondary_higher_disp_score | inconclusive_margin_below_threshold | no_fvgs_created_in_window | secondary_engine_missing"),
      },
      async (args) => {
        try {
          return ok(await surfaceLeaderDecision(args));
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "memory",
      `Save durable facts to persistent memory that survives across trading days. Memory injects into every future session as part of the system prompt — keep it compact, declarative, and focused on facts that will still matter in a week.

WHEN TO SAVE (proactively, don't wait to be asked):
- Trader corrects you ("stop calling tiny FVGs A+", "I don't trade Mondays")
- Trader expresses a preference (sizing rule, sessions traded, instruments to skip)
- A cross-day market pattern surfaces (PCE-day chop, NY AM fades after fast Asia)
- You learn a chart-reading nuance specific to this trader's setup

PRIORITY: trader corrections + preferences > cross-day market patterns > facts about the trader's environment. The most valuable memory is one that prevents the trader from having to remind you again.

DO NOT save:
- Today's setups / today's PnL / today's session outcomes — those live in state/session/<date>/<session>/summary.md
- Specific PR numbers, commit SHAs, file counts, anything stale in a week
- Single-occurrence chart events that resolved
- Negative claims about indicators or tools ("the engine is broken")
- One-off task narratives ("the trader asked about MES today")

DECLARATIVE PHRASING (important): write memories as facts, not directives.
- "Trader uses structural stops below the FVG low" ✓
- "Always set stops below the FVG low" ✗
- "Trader skips Wednesdays during FOMC weeks" ✓
- "Don't trade Wednesdays" ✗
Imperative phrasing gets re-read as a standing order every turn — it can override the trader's current request. Facts are applied contextually.

TWO TARGETS:
- target="user" → who the trader is (preferences, schedule, instruments, style)
- target="memory" → cross-day lessons (recurring patterns, durable observations)

ACTIONS:
- add: append a new entry
- replace: find existing entry by old_text (unique substring), replace it
- remove: find by old_text, delete

If a write would exceed the char limit, the tool refuses and tells you which entries to remove first.`,
      {
        action: z.enum(["add", "replace", "remove"]).describe("The action to perform."),
        target: z.enum(["memory", "user"]).describe("Which store: 'memory' for cross-day lessons, 'user' for trader profile."),
        content: z.string().optional().describe("Entry content. Required for 'add' and 'replace'."),
        old_text: z.string().optional().describe("Short unique substring identifying the entry to replace or remove."),
      },
      async (args) => {
        try {
          const action = args?.action;
          const target = args?.target;
          // Guardrails: rate-limit per-turn writes + per-target throttle.
          // Prevents an over-eager model from dumping 10 entries in one
          // turn (memory is char-capped so the damage is bounded anyway,
          // but a flood of low-signal entries pushes out the valuable
          // ones and burns tokens on every future system prompt).
          const guard = checkMemoryGuardrails(action, target);
          if (!guard.ok) return err(guard.reason);
          const mem = getPersistentMemory();
          let result;
          if (action === "add") {
            result = await mem.add(target, args?.content || "");
          } else if (action === "replace") {
            result = await mem.replace(target, args?.old_text || "", args?.content || "");
          } else if (action === "remove") {
            result = await mem.remove(target, args?.old_text || "");
          } else {
            result = { success: false, error: `unknown action '${action}' — use add/replace/remove` };
          }
          if (shouldRecordMemoryWrite(action, result)) recordMemoryWrite(target);
          return result.success ? ok(result) : err(result.error || "memory tool failed");
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
  ];

  // The SDK prefixes MCP tool names as mcp__<server>__<tool>; we whitelist
  // these names in allowedTools so Claude can call them without permission
  // prompts.
  //
  // memory is EXCLUDED from the default whitelist — it's added per-purpose
  // (chat / wrap / review only) by buildAllowedToolNames(purpose) so the
  // 420×/day bar-close turn surface stays read-only.
  const serverName = "tv";
  _allowedToolNames = tools
    .filter((t) => t.name !== "memory")
    .map((t) => `mcp__${serverName}__${t.name}`);
  _memoryToolName = `mcp__${serverName}__memory`;
  // alwaysLoad: true forces the SDK MCP server to be available in turn 1
  // (per 0.3.142 release notes — by default MCP servers connect in the
  // background and may be "pending" during the first turn). Without this,
  // the first per-bar turn after restart can see tv_analyze_* as not
  // resolvable and fall back to a degraded "no data" no-trade.
  return createSdkMcpServer({ name: serverName, version: "0.1.0", tools, alwaysLoad: true });
}

export async function initSdk() {
  // Warm the prompt path (catch missing-file errors at boot, not first turn)
  // — bar-close is the most common purpose, use it as the warm-up shape.
  const warmup = await loadSystemPrompt("bar-close");
  _mcpServer = buildMcpServer();
  // loadSystemPrompt now returns string[] (PR 3 — cache breakpoint). The
  // boot log is informational; report the joined char count to stay
  // comparable with pre-PR-3 logs (~33000 chars for bar-close).
  const warmupChars = joinSystemPrompt(warmup).length;
  // eslint-disable-next-line no-console
  console.log("[sdk] init ok, prompt length (bar-close)", warmupChars, "tools", _allowedToolNames);
}

export function resetSession(purpose, providerName = 'claude') {
  if (purpose) {
    _sessionIds.delete(sessionKeyForPurposeProvider(purpose, providerName));
    return;
  }
  _sessionIds.clear();
  _authBlocked = null;
}

export const _authCircuitForTests = {
  block(message = "Claude Code not logged in") { markClaudeAuthBlocked(message); },
  current() { return _authBlocked; },
  clear() { _authBlocked = null; },
};

// Model config. Per Claude Code docs (code.claude.com/docs/en/model-config):
// the "opus" alias on Max/Team/Enterprise plans auto-resolves to Opus 4.7
// with 1M context. Opus everywhere; no Sonnet fallback per user decision
// (2026-05-28).
const MODEL = "opus";
const FALLBACK_MODEL = "opus";

function modelForPurpose(_purpose) {
  return { model: MODEL, fallbackModel: FALLBACK_MODEL };
}

// Effort level: how hard Claude thinks per turn.
//
// 2026-05-26 — raised from "high" to "xhigh" per Anthropic's current guidance:
// "Start with the new xhigh effort level for coding and agentic use cases."
// Our bar-close turns are both agentic (multiple tool calls) and intelligence-
// sensitive (walk 3 entry models with per-component citation, emit a graded
// tool call). xhigh was the initial pick but pushed brief turns past 5 min
// and bar-close turns to ~50% timeout rate even at 120s. Dropped back to
// "high" — faster turns, lower spend, slightly less reasoning depth. The
// new chain (digest at top, structured handoffs in pillar1/2.md frontmatter,
// deterministic resolvers in cli/lib/) shifts intelligence load off the
// model: it no longer has to fabricate primary_draw selection or
// entry_model_priority — those are pre-computed.
//
// Levels: low | medium | high | xhigh | max.
const EFFORT = "medium";

/**
 * userTurn — the one entry point for any Claude turn (brief / wrap / bar-close
 * / chat). Three deepening guarantees:
 *
 *  1. **Mutex** — only one turn runs at a time. Eliminates the concurrent-
 *     resume class of bug where a brief and a bar-close fired in parallel.
 *  2. **Per-purpose session id** — each `purpose` keeps its own conversation
 *     history. NY AM brief doesn't see yesterday's London brief.
 *  3. **Timeout** — if a turn hangs, it's released after `timeoutMs` so the
 *     mutex never freezes the rest of the system.
 *
 * Caller contract:
 *   - `purpose`: required. One of 'brief' | 'wrap' | 'bar-close' | 'chat' |
 *     'catch-up'. Used as the session-id key.
 *   - `text`: the user-turn message.
 *   - `onEvent`: event callback (chunk / tool_call / turn_complete / error).
 *   - `timeoutMs`: optional override (default 300_000).
 */
export async function userTurn({ text, purpose, onEvent, timeoutMs = DEFAULT_TURN_TIMEOUT_MS, backtestContext = null, providerOverride = null }) {
  if (!purpose) {
    const msg = "userTurn() requires a purpose (brief | wrap | bar-close | chat | catch-up | review)";
    onEvent?.({ type: "error", message: msg });
    onEvent?.({ type: "turn_complete" });
    throw new Error(msg);
  }

  // Chain onto the in-flight turn (mutex). The release function is captured
  // in `release` and called in the finally block so the next queued turn can
  // proceed even if this one throws.
  let release;
  const lock = new Promise((r) => (release = r));
  const prev = _turnInFlight;
  _turnInFlight = lock;
  // #44 Notify if we have to wait. Chat-on-bar-close was the worst
  // case: trader typed, waited 30-90s, no feedback. Now onEvent gets a
  // "queued" event right after the user message lands.
  let queued = false;
  if (_currentCancel) {
    queued = true;
    onEvent?.({ type: "queued", waitingOn: _currentCancel.purpose });
  }
  await prev;

  // Backtest mode: scope the session-dir override + memory-write
  // suppression to the duration of this turn. Live behavior is untouched
  // (these short-circuit to no-ops when backtestContext is null).
  if (backtestContext) {
    setBacktestSessionContext({ runId: backtestContext.runId, session: backtestContext.session });
    setBacktestContext({ runId: backtestContext.runId });
  }

  try {
    if (queued) onEvent?.({ type: "queue_ready" });
    await runOneTurn({ text, purpose, onEvent, timeoutMs, providerOverride });
  } finally {
    if (backtestContext) {
      clearBacktestSessionContext();
      clearBacktestContext();
    }
    release();
  }
}

async function runOneTurn({ text, purpose, onEvent: rawOnEvent, timeoutMs, providerOverride = null }) {
  const provider = resolveLlmProvider({ purpose, providerOverride });
  const toolCallsThisTurn = [];
  // Wrap onEvent so every "error" event picks up a classified `kind` +
  // `retryable` hint. Consumers (bar-close retry logic, UI error chip)
  // can react differently per kind without each reimplementing the
  // pattern matching. See app/main/error-classifier.js for the taxonomy.
  // Also forwards every event to the global activity broadcaster (with
  // purpose tag) so the CLAUDE conversation can show what's happening
  // across all purposes.
  const onEvent = (ev) => {
    let processed = ev;
    if (ev && ev.type === "tool_call" && ev.name) {
      toolCallsThisTurn.push(ev.name);
    }
    if (ev && ev.type === "error" && !ev.kind) {
      const classified = classifyError(ev.message);
      processed = { ...ev, kind: classified.kind, retryable: classified.retryable };
      if (classified.kind === "auth") markClaudeAuthBlocked(classified.message);
    } else if (ev && ev.type === "error" && ev.kind === "auth") {
      markClaudeAuthBlocked(ev.message || "Claude auth failed");
    }
    processed = { ...processed, provider: provider.name };
    if (rawOnEvent) rawOnEvent(processed);
    _broadcastActivity({ ...processed, purpose });
  };
  _broadcastActivity({ type: "activity_start", purpose, provider: provider.name, ts: Date.now(), text });
  // Reset the per-turn memory-write counter. The throttle counter is NOT
  // reset — it spans across turns by design.
  resetMemoryGuardrails();
  // Refresh persistent memory from disk at the start of each turn. The store
  // freezes a snapshot at this point; loadSystemPrompt reads that snapshot
  // when composing the prompt. Mid-turn writes (memory tool calls inside
  // this same turn) hit disk + live state but DO NOT change the snapshot
  // that's already been injected — that's the prefix-cache invariant.
  try {
    await getPersistentMemory().load();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[sdk] persistent memory load failed (continuing without)", err?.message || err);
  }
  const systemPrompt = await loadSystemPrompt(purpose);
  if (provider.name === "codex") {
    // Codex is available as a text-only replacement provider. Tool-requiring
    // purposes fail closed inside runCodexTextTurn instead of pretending Codex
    // can call the MCP surface tools that lock packet truth.
    await runCodexTextTurn({ text, systemPrompt, purpose, onEvent, timeoutMs, provider });
    return;
  }
  const resumeKey = sessionKeyForPurposeProvider(purpose, provider.name);
  const resumeId = _sessionIds.get(resumeKey);
  const { model, fallbackModel } = modelForPurpose(purpose);
  const opts = {
    systemPrompt,
    model,
    // Agent SDK rejects identical main/fallback. Only pass fallbackModel
    // when it differs from the main model.
    ...(fallbackModel && fallbackModel !== model ? { fallbackModel } : {}),
    effort: EFFORT,
    // tools: ["Read", "Glob"] — explicitly load ONLY these built-in tools
    // (no Edit / Write / Bash / Task / etc). Read is critical because
    // tv_analyze_* writes its bundle to disk and the bundle is too big to
    // fit in the tool result body. The pre-merge version used tools:[] —
    // empty — but Claude then couldn't Read state/last-scan.slim.json on
    // the per-bar polling path. Read is essential, Glob is cheap insurance
    // for "find the latest bundle" cases.
    tools: ["Read", "Glob"],
    mcpServers: _mcpServer ? { tv: _mcpServer } : undefined,
    // Per-purpose whitelist: chat / wrap / review can call the memory tool;
    // brief / bar-close / catch-up are read-only for memory. Keeps the
    // 420×/day bar-close turn from being a write surface.
    allowedTools: buildAllowedToolNames(purpose),
    // MCP_CONNECTION_NONBLOCKING=0 — per 0.3.142 release notes, MCP servers
    // connect in the background by default and may report "pending" in
    // turn 1. Setting this to 0 forces the SDK to wait up to 5s for MCP
    // servers to connect before the first query. env REPLACES process.env
    // per 0.3.149 docs — must spread process.env explicitly to keep PATH,
    // OAuth refresh creds, etc.
    env: { ...process.env, MCP_CONNECTION_NONBLOCKING: "0" },
    includePartialMessages: true,
    ...(resumeId ? { resume: resumeId } : {}),
  };
  // eslint-disable-next-line no-console
  console.log("[sdk] userTurn start", { purpose, textLen: text.length, resuming: !!resumeId, timeoutMs });

  let q;
  try {
    q = query({ prompt: text, options: opts });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sdk] query() threw", err);
    onEvent?.({ type: "error", message: String(err?.message || err) });
    onEvent?.({ type: "turn_complete" });
    return;
  }

  // Race the iteration against a wall-clock timeout. On timeout:
  //   1. Flip a cancel flag so iterateMessages breaks the for-await loop
  //      on its next message (the SDK's async iterator can't be force-
  //      cancelled from outside, but checking a flag per message means
  //      iteration stops as soon as the next message arrives).
  //   2. Call q.return() to signal the iterator to wind down — most SDKs
  //      honor this and clean up the underlying subprocess.
  //   3. Emit error + turn_complete + release the mutex so the next turn
  //      can start. The bug we hit before: timeout emitted error but
  //      iteration kept going, so the "retry" ran in parallel with the
  //      original. Now the original is told to stop.
  const cancelToken = { cancelled: false };
  // Expose this turn's cancel handle so cancelCurrentTurn() can abort
  // from outside (the chat panel's STOP button).
  _currentCancel = { cancelToken, q, purpose };
  let timeoutHandle;
  let timedOut = false;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      cancelToken.cancelled = true;
      // Tell the SDK iterator to stop. Best-effort; some SDKs don't
      // honor .return() on async iterators.
      try { q.return?.(); } catch { /* ignore */ }
      resolve();
    }, timeoutMs);
  });

  const startedAt = Date.now();
  try {
    await Promise.race([iterateMessages(q, purpose, onEvent, cancelToken, startedAt, text, toolCallsThisTurn), timeoutPromise]);
    if (timedOut) {
      const msg = `userTurn timed out after ${timeoutMs}ms (purpose=${purpose})`;
      // eslint-disable-next-line no-console
      console.warn("[sdk]", msg);
      onEvent?.({ type: "error", message: msg });
      onEvent?.({ type: "turn_complete" });
    } else if (cancelToken.cancelled) {
      // External cancel (kill switch). Emit a clean error + turn_complete
      // so callers (and the UI) see the turn ended, just like a timeout.
      onEvent?.({ type: "error", message: `turn cancelled by user (purpose=${purpose})` });
      onEvent?.({ type: "turn_complete" });
    }
  } finally {
    clearTimeout(timeoutHandle);
    _currentCancel = null;
    _broadcastActivity({ type: "activity_end", purpose, provider: provider.name, ts: Date.now() });
  }
}

/**
 * cancelCurrentTurn — abort the currently in-flight userTurn, if any.
 * Returns true if a turn was cancelled, false if nothing was running.
 * The next queued turn proceeds normally once the mutex releases.
 */
export function cancelCurrentTurn() {
  if (!_currentCancel) return false;
  // eslint-disable-next-line no-console
  console.log(`[sdk] cancelCurrentTurn purpose=${_currentCancel.purpose}`);
  _currentCancel.cancelToken.cancelled = true;
  try { _currentCancel.q.return?.(); } catch { /* ignore */ }
  return true;
}

async function iterateMessages(q, purpose, onEvent, cancelToken, startedAt, turnText = "", toolCallsThisTurn = []) {
  let msgCount = 0;
  try {
    for await (const msg of q) {
      // Cancellation gate: the timeout path flips cancelToken.cancelled and
      // we exit immediately. The SDK's async iterator can't be force-stopped
      // mid-await, so the first message after the timeout is processed —
      // but no more after that. Prevents the "two parallel turns" bug.
      if (cancelToken?.cancelled) {
        // eslint-disable-next-line no-console
        console.log("[sdk] iteration cancelled", { purpose, msgCount });
        return;
      }
      msgCount += 1;
      if (msg.session_id) _sessionIds.set(sessionKeyForPurposeProvider(purpose, 'claude'), msg.session_id);
      // eslint-disable-next-line no-console
      console.log("[sdk] msg", purpose, msg.type, msg.type === "stream_event" ? msg.event?.type : "");
      handleSdkMessage(msg, onEvent);
    }
    // eslint-disable-next-line no-console
    console.log("[sdk] userTurn done", { purpose, msgCount });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sdk] iteration threw", err);
    onEvent?.({ type: "error", message: String(err?.message || err) });
  } finally {
    // turn_complete is emitted by the caller (runOneTurn) on the timeout
    // path. Emit it here ONLY when iteration ran to natural completion or
    // threw — and only when not cancelled (the cancel path skips it so the
    // timeout path can emit its own).
    if (!cancelToken?.cancelled) {
      // #63 Include the wall-clock duration so the UI can show
      // "this bar-close took 47s".
      const durationMs = startedAt ? Date.now() - startedAt : null;
      const contract = validateTurnSurfaceContract({ purpose, text: turnText, toolCalls: toolCallsThisTurn });
      if (!contract.ok) {
        onEvent?.({ type: "error", message: `surface contract violation (purpose=${purpose}): ${contract.message}` });
      }
      onEvent?.({ type: "turn_complete", durationMs, purpose });
    }
  }
}

function handleSdkMessage(msg, onEvent) {
  if (!msg || !onEvent) return;

  // Streaming text deltas.
  if (msg.type === "stream_event" && msg.event) {
    const e = msg.event;
    if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
      onEvent({ type: "chunk", text: e.delta.text || "" });
    }
    return;
  }

  // Final assistant message — extract tool calls (Phase 4+).
  if (msg.type === "assistant") {
    const content = msg.message?.content || [];
    for (const block of content) {
      if (block.type === "tool_use") {
        onEvent({ type: "tool_call", name: block.name, args: block.input || {}, id: block.id });
      }
    }
    return;
  }

  // Result message — done. The for-await loop will exit; our finally emits turn_complete.
  if (msg.type === "result") {
    if (msg.is_error) {
      onEvent({ type: "error", message: (msg.errors || []).join(" · ") || "result error" });
      return;
    }
    // SDKResultSuccess carries usage + cost; surface them to the caller so
    // metrics.record() can persist per-turn cost. (see app/main/usage.js)
    const usage = extractUsageFromResult(msg);
    if (usage) {
      onEvent({ type: "usage", usage });
    }
    return;
  }

  // System init / hook / status / etc. — log in dev, ignore.
  if (msg.type === "system") {
    // eslint-disable-next-line no-console
    if (msg.subtype === "init") {
      // Surface the actual model + tools the CLI is using — separate from
      // whatever the model self-reports in chat (which can lag training).
      console.log("[sdk system] init",
        "session=", msg.session_id,
        "model=", msg.model,
        "tools=", Array.isArray(msg.tools) ? msg.tools.length : "?",
      );
    } else {
      console.log("[sdk system]", msg.subtype, msg.session_id);
    }
    return;
  }
}

// Exported for tests only — same internal function the SDK uses to compose
// the system prompt per turn. Tests can call this without firing a userTurn.
export { loadSystemPrompt as _loadSystemPromptForTests };

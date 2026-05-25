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
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(__dirname, "prompts", "analyze.md");

let _systemPrompt = null;
// Per-purpose session IDs. Splitting the conversation by purpose stops
// brief / wrap / bar-close / chat from contaminating each other's history.
// One global _sessionId — the old design — meant a NY AM brief and a 13:00
// bar-close ended up resuming the same conversation, and yesterday's London
// brief was in context when today's London brief ran.
const _sessionIds = new Map(); // purpose -> sessionId
let _mcpServer = null;
let _allowedToolNames = [];

// Global mutex serializing all userTurn calls. There are four callers
// (chat:send_message, session-brief, session-wrap, bar-close) and three
// auto-firing schedulers. Without the mutex, a 13:00 brief and a 13:01
// bar-close tick start in parallel — even with per-purpose session ids,
// resource contention on the Claude subprocess + the shared MCP server
// makes parallel turns unsafe in practice. Mutex keeps it predictable.
let _turnInFlight = Promise.resolve();

// Wall-clock timeout per turn. If Claude / the network hangs, we don't want
// the mutex held forever — that would freeze every other caller.
//
// Observed (2026-05-25): briefs legitimately need 2-5 minutes — tv_analyze_full
// is ~15s, Opus 4.7 high-effort reasoning over a dual-symbol bundle plus two
// surface tool calls adds up. Bar-close turns are smaller — closer to 30-90s.
// Default to 300s; bar-close + chat callers should pass a tighter value
// (90s) so a stalled per-bar turn doesn't block the next minute's tick.
const DEFAULT_TURN_TIMEOUT_MS = 300_000;

const OUTPUT_PROTOCOL = `

---

## OUTPUT PROTOCOL — TOOL SURFACES (read carefully)

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders setup cards from your tool calls — prose alone does not surface a card.

**Every analysis turn MUST end with exactly one tool call**, in this order of priority:

1. If a valid setup is in play and you would call it \`A+\` or \`B\` — call \`mcp__tv__surface_setup\` with the full setup payload (grade, model, direction, entry, stop, tp1, tp2, invalidation, rr, confirmation_status, tf, pillar_breakdown). Do this AFTER your prose reasoning. \`tf\` is "1m" or "5m" — stamp it to match the TF of the bar that triggered this turn (the per-bar prompt tells you which). \`pillar_breakdown\` is an array of three pillars ('Draw & Bias' / 'Price-Action Quality' / 'Entry + Confirmation'), each with a status and 2–3 named elements — see the schema. Skipping pillar_breakdown hides the alignment panel.

2. Otherwise (any reason you would have written "no-trade" in prose) — call \`mcp__tv__surface_no_trade\` with a short \`reason\` string. Examples:
   - "outside active session"
   - "no entry model in play"
   - "price quality weak — premium/discount unclear"
   - "HTF/LTF opposed — retrace day"

Writing "no trade" or "no setup" in prose without calling \`surface_no_trade\` is a bug — the UI will stay stuck on the previous state. Always end with one of the two surface tools.

To read the chart, use \`mcp__tv__tv_analyze_full\` (full multi-TF sweep) or \`mcp__tv__tv_analyze_fast\` (1-bar poll with a baseline path). To arm alerts, use \`mcp__tv__tv_alert_create\`.

**EXCEPTION — session-brief turns.** When the user message asks you to run "the SESSION BRIEF for the X session", do NOT call surface_setup or surface_no_trade. Instead, call \`mcp__tv__surface_session_brief\` **once per symbol** at the end of the turn — for dual-symbol pair scans (e.g. MNQ + MES) call it TWICE (once with symbol="MNQ1!" and once with symbol="MES1!"), each carrying that symbol's structured payload. The user message will tell you which symbols. That's the only tool that surfaces the PREP panels.

**EXCEPTION — open-reaction phase turns.** When the per-bar message says "Phase: open_reaction": call \`mcp__tv__surface_open_reaction\` with the latest read (what NY just did, bias direction so far, what you're watching) — this persists to open-reaction.md as a running log. When \`minutes_into_phase\` >= 14 in the prompt context, ALSO call \`mcp__tv__surface_ltf_bias\` to finalize the bias before ending the turn. Either way, still end the turn with \`mcp__tv__surface_no_trade\` — no setup card during open-reaction.

**EXCEPTION — session-summary turns.** When the user message asks you to run "the SESSION SUMMARY for the X session", do NOT call surface_setup or surface_no_trade. Instead, call \`mcp__tv__surface_session_summary\` exactly once at the end with bias_picture, what_happened, watch_next_session.

Reason in prose first; surface last.

---

## ALERT GUIDANCE — managing TradingView price alerts on the trader's behalf

You manage TradingView price alerts via three tools:
- \`mcp__tv__tv_alert_create\` — \`{ price, label, condition? }\`. \`condition\` defaults to "crossing"; use "greater_than" / "less_than" for one-sided triggers. \`label\` is the string the trader sees when the alert fires on their phone — keep it short and self-explanatory.
- \`mcp__tv__tv_alert_list\` — read all current alerts. Use before deleting (to get \`alert_id\`s) or to avoid duplicating an existing alert.
- \`mcp__tv__tv_alert_delete\` — remove one alert by \`alert_id\`. If the trader names an alert by description ("the PDH alert"), call \`tv_alert_list\` first to find the matching id.

**Proactively propose alerts (in prose, during analysis turns) at these moments:**
- After a pre-session grade — primary HTF draw, untaken liquidity above/below price, level that would flip the bias.
- When a candidate setup forms — confirmation level and invalidation.
- After a confirmed setup — TP1, TP2, and invalidation.

Name the levels with cited prices ("Arm alerts at PDH 21487.25 (gates.engine.pillar1.session_levels.PDH.price) / Asia low 21450.50 (...) / bias-flip 21420.00 (...)?"). Don't arm during the analysis turn itself — wait for the trader's reply in the next chat turn. Analysis turns still end with the required surface tool (\`surface_setup\` / \`surface_no_trade\` / etc.).

**Reactive — when the trader brings up alerts:**
Three things matter:
1. **Price** — exact level. If they named it (PDH, AS_H, etc.), echo back the cited number from the bundle so they can confirm.
2. **Condition** — crossing (default), above-only (\`greater_than\`), or below-only (\`less_than\`).
3. **Label** — short string the trader sees when it fires. Suggest one from context if they didn't provide one.

Fill in what they already specified, pick sensible defaults for the rest, then ask only about the missing or ambiguous pieces in one short message — not a survey. If all three are already clear from the request, arm directly and confirm with a one-liner ("Armed at 21500 (PDH cross) — alert_id 4773…").

**Alert-management chat turns end with the alert tool call** (\`tv_alert_create\` / \`tv_alert_list\` / \`tv_alert_delete\`). They do NOT end with \`surface_setup\` / \`surface_no_trade\` — those are for analysis turns.`;

async function loadSystemPrompt() {
  if (_systemPrompt) return _systemPrompt;
  const base = await fs.readFile(PROMPT_PATH, "utf8");
  _systemPrompt = base + OUTPUT_PROTOCOL;
  return _systemPrompt;
}

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
          })),
        })).optional().describe("3-pillar alignment breakdown rendered in the LIVE PILLAR ALIGNMENT panel. Optional — panel is hidden when omitted."),
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
        brief: z.string().describe("Headline paragraph for the Morning Brief panel"),
        htf_bias: z.array(z.object({
          tf: z.enum(["DAILY", "4H", "1H"]),
          bias: z.enum(["BULLISH", "BEARISH", "MIXED", "NEUTRAL"]),
          note: z.string(),
        })).describe("HTF bias per timeframe — exactly DAILY / 4H / 1H"),
        overnight: z.array(z.object({
          k: z.string(),
          v: z.string(),
          tone: z.enum(["green", "red", "amber"]).optional(),
        })).describe("Overnight context rows: Asia range, London range, what was swept, direction overnight, etc."),
        key_levels: z.array(z.object({
          name: z.string().describe("PWH, PDH, ONH, ONL, PDL, PWL, AS_H, AS_L, LO_H, LO_L"),
          price: z.union([z.number(), z.string()]).describe("Numeric or pre-formatted price"),
          state: z.enum(["taken", "untaken"]),
        })).describe("Key levels for the session, sorted high → low"),
        pillar_grade: z.enum(["A+", "B", "no-trade"]).describe("Roll-up grade for Pillars 1+2 only (Pillar 3 is pending until LIVE)"),
        pillars: z.array(z.object({
          name: z.string(),
          status: z.enum(["pass", "weak", "fail", "pending"]),
          elements: z.array(z.object({
            name: z.string(),
            status: z.enum(["pass", "weak", "fail", "pending"]),
          })),
        })).describe("Three pillars: 'Draw & Bias', 'Price-Action Quality', 'Entry Model + Confirmation' (the third is pending until LIVE)"),
        plan: z.string().describe("Claude's written plan for the open — what scenario looks like A+, what flips it to retrace, the bias direction"),
        anchored_target: z.string().describe("e.g. '21 528.50 (PDH)'"),
        anchored_stop: z.string().describe("e.g. '21 462.75 (PDL)'"),
        sizing_note: z.string().describe("e.g. '0.75 R · Mon-reduced' — references the strategy sizing table"),
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
  ];

  // The SDK prefixes MCP tool names as mcp__<server>__<tool>; we whitelist
  // these names in allowedTools so Claude can call them without permission
  // prompts.
  const serverName = "tv";
  _allowedToolNames = tools.map((t) => `mcp__${serverName}__${t.name}`);
  // alwaysLoad: true forces the SDK MCP server to be available in turn 1
  // (per 0.3.142 release notes — by default MCP servers connect in the
  // background and may be "pending" during the first turn). Without this,
  // the first per-bar turn after restart can see tv_analyze_* as not
  // resolvable and fall back to a degraded "no data" no-trade.
  return createSdkMcpServer({ name: serverName, version: "0.1.0", tools, alwaysLoad: true });
}

export async function initSdk() {
  await loadSystemPrompt();
  _mcpServer = buildMcpServer();
  // eslint-disable-next-line no-console
  console.log("[sdk] init ok, prompt length", _systemPrompt.length, "tools", _allowedToolNames);
}

export function resetSession(purpose) {
  if (purpose) _sessionIds.delete(purpose);
  else _sessionIds.clear();
}

// Model config. Per Claude Code docs (code.claude.com/docs/en/model-config):
// the "opus" alias on Max/Team/Enterprise plans auto-resolves to Opus 4.7
// with 1M context — no [1m] suffix needed, no full model ID gymnastics.
// "sonnet" fallback (also auto-1M-context on Max) so the per-bar loop
// survives a transient Opus outage without losing session context.
//
// Pre-merge (PR #43 squash) used "claude-opus-4-6-fast" + a long comment
// arguing against 4.7. That decision was reversed during the day's work:
// the account doesn't have Fast Mode access, and 4.7's strict literal
// instruction-following turned out to be exactly what the dual-symbol
// brief needed to reliably emit surface_session_brief twice. Keeping the
// "opus" alias here so it tracks whatever current Opus the account has.
const MODEL = "opus";
const FALLBACK_MODEL = "sonnet";

// Effort level: how hard Claude thinks per turn.
//
// Started at "medium" (one notch below xhigh default) but observed Claude
// skipping the trailing surface_session_brief tool call — at medium effort,
// the docs note "fewer and more-consolidated tool calls". For our prompts
// that end with a mandatory surface_* call, that consolidation drops the
// final tool and we get streamed prose with no UI update.
//
// "high" is the docs' explicit minimum for intelligence-sensitive work and
// reliably honors multi-step prompts. Trade-off: more tokens per turn vs
// xhigh's max, but the brief / setup / pillar files actually get written.
//
// Levels: low | medium | high | xhigh | max.
const EFFORT = "high";

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
export async function userTurn({ text, purpose, onEvent, timeoutMs = DEFAULT_TURN_TIMEOUT_MS }) {
  if (!purpose) {
    const msg = "userTurn() requires a purpose (brief | wrap | bar-close | chat | catch-up)";
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
  await prev;

  try {
    await runOneTurn({ text, purpose, onEvent, timeoutMs });
  } finally {
    release();
  }
}

async function runOneTurn({ text, purpose, onEvent, timeoutMs }) {
  const systemPrompt = await loadSystemPrompt();
  const resumeId = _sessionIds.get(purpose);
  const opts = {
    systemPrompt,
    model: MODEL,
    fallbackModel: FALLBACK_MODEL,
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
    allowedTools: ["Read", "Glob", ..._allowedToolNames],
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

  try {
    await Promise.race([iterateMessages(q, purpose, onEvent, cancelToken), timeoutPromise]);
    if (timedOut) {
      const msg = `userTurn timed out after ${timeoutMs}ms (purpose=${purpose})`;
      // eslint-disable-next-line no-console
      console.warn("[sdk]", msg);
      onEvent?.({ type: "error", message: msg });
      onEvent?.({ type: "turn_complete" });
    }
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function iterateMessages(q, purpose, onEvent, cancelToken) {
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
      if (msg.session_id) _sessionIds.set(purpose, msg.session_id);
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
      onEvent?.({ type: "turn_complete" });
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

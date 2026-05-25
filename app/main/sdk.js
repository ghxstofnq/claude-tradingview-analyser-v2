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
let _sessionId = null;
let _mcpServer = null;
let _allowedToolNames = [];

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

**EXCEPTION — session-brief turns.** When the user message asks you to run "the SESSION BRIEF for the X session", do NOT call surface_setup or surface_no_trade. Instead, call \`mcp__tv__surface_session_brief\` exactly once at the end of the turn with the structured payload. That's the only tool that surfaces the PREP panels.

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
  return createSdkMcpServer({ name: serverName, version: "0.1.0", tools });
}

export async function initSdk() {
  await loadSystemPrompt();
  _mcpServer = buildMcpServer();
  // eslint-disable-next-line no-console
  console.log("[sdk] init ok, prompt length", _systemPrompt.length, "tools", _allowedToolNames);
}

export function resetSession() {
  _sessionId = null;
}

export async function userTurn({ text, onEvent }) {
  const systemPrompt = await loadSystemPrompt();
  const opts = {
    systemPrompt,
    // Disable built-in Claude Code tools (Read/Edit/Bash/etc) — only our
    // MCP tools below should be callable.
    tools: [],
    mcpServers: _mcpServer ? { tv: _mcpServer } : undefined,
    allowedTools: _allowedToolNames,
    includePartialMessages: true,      // emit SDKPartialAssistantMessage so chunks stream
    ...(_sessionId ? { resume: _sessionId } : {}),
  };
  // eslint-disable-next-line no-console
  console.log("[sdk] userTurn start", { textLen: text.length, resuming: !!_sessionId });

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

  let msgCount = 0;
  try {
    for await (const msg of q) {
      msgCount += 1;
      if (msg.session_id) _sessionId = msg.session_id;
      // eslint-disable-next-line no-console
      console.log("[sdk] msg", msg.type, msg.type === "stream_event" ? msg.event?.type : "");
      handleSdkMessage(msg, onEvent);
    }
    // eslint-disable-next-line no-console
    console.log("[sdk] userTurn done", { msgCount });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sdk] iteration threw", err);
    onEvent?.({ type: "error", message: String(err?.message || err) });
  } finally {
    onEvent?.({ type: "turn_complete" });
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
    console.log("[sdk system]", msg.subtype, msg.session_id);
    return;
  }
}

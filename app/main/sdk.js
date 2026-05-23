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
import { tvAlertCreate, tvAlertList } from "./tools/tv-alerts.js";
import { surfaceSetup, surfaceNoTrade, surfaceSessionBrief } from "./tools/surface.js";

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

1. If a valid setup is in play and you would call it \`A+\` or \`B\` — call \`mcp__tv__surface_setup\` with the full setup payload (grade, model, direction, entry, stop, tp1, tp2, invalidation, rr, confirmation_status). Do this AFTER your prose reasoning.

2. Otherwise (any reason you would have written "no-trade" in prose) — call \`mcp__tv__surface_no_trade\` with a short \`reason\` string. Examples:
   - "outside active session"
   - "no entry model in play"
   - "price quality weak — premium/discount unclear"
   - "HTF/LTF opposed — retrace day"

Writing "no trade" or "no setup" in prose without calling \`surface_no_trade\` is a bug — the UI will stay stuck on the previous state. Always end with one of the two surface tools.

To read the chart, use \`mcp__tv__tv_analyze_full\` (full multi-TF sweep) or \`mcp__tv__tv_analyze_fast\` (1-bar poll with a baseline path). To arm alerts, use \`mcp__tv__tv_alert_create\`.

**EXCEPTION — session-brief turns.** When the user message asks you to run "the SESSION BRIEF for the X session", do NOT call surface_setup or surface_no_trade. Instead, call \`mcp__tv__surface_session_brief\` exactly once at the end of the turn with the structured payload. That's the only tool that surfaces the PREP panels.

Reason in prose first; surface last.`;

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
      "Run the full multi-timeframe TradingView analysis sweep. Returns { path } pointing to the JSON bundle.",
      {},
      async () => {
        try {
          const res = await tvAnalyzeFull({});
          return ok(res);
        } catch (e) {
          return err(e?.message || String(e));
        }
      },
    ),
    tool(
      "tv_analyze_fast",
      "Run a fast pillar-3 analysis poll, optionally reusing a cached baseline. Returns { path }.",
      {
        baseline: z.string().optional().describe("Path to a previously captured baseline JSON; omit on first call"),
      },
      async (args) => {
        try {
          const res = await tvAnalyzeFast(args || {});
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
        pillar_breakdown: z.record(z.string(), z.unknown()).optional()
          .describe("Optional 6-element pillar breakdown {hint, bias, ...}"),
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
      "surface_session_brief",
      "Render the SESSION BRIEF in the PREP panels. Call this ONCE at the end of a session-brief turn (not from bar-close turns and not from chat turns). Persists to state/session/<date>/<session>/brief.json.",
      {
        session: z.enum(["london", "ny-am", "ny-pm"]).describe("Which session this brief is for"),
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

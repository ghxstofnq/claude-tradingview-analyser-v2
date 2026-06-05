#!/usr/bin/env node
import fs from "node:fs/promises";
import { tvAnalyzeFull, tvAnalyzeFast } from "./tools/tv-analyze.js";
import { tvAlertCreate, tvAlertList, tvAlertDeleteOne } from "./tools/tv-alerts.js";
import { runTvCapture } from "./tools/tv-process.js";
import {
  surfaceSetup,
  surfaceNoTrade,
  surfaceSessionBrief,
  surfaceOpenReaction,
  surfaceLtfBias,
  surfaceSessionSummary,
  surfaceLeaderDecision,
} from "./tools/surface.js";
import { getPersistentMemory } from "./persistent-memory.js";

const SERVER_NAME = "tv";
const PROTOCOL_VERSION = "2024-11-05";

const anyObject = {
  type: "object",
  additionalProperties: true,
  properties: {},
};

function normalizeTool(def) {
  return {
    ...def,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      ...(def.annotations || {}),
    },
  };
}

function tool(name, description, inputSchema, annotations = {}) {
  return normalizeTool({ name, description, inputSchema, annotations });
}

const RAW_CODEX_TV_MCP_TOOLS = [
  tool("tv_ping", "Diagnostic no-op tool proving Codex can reach the app-local tv MCP server.", { type: "object", additionalProperties: false, properties: {} }, { readOnlyHint: true }),
  tool(
    "tv_cli",
    "Run the project-owned ./bin/tv TradingView CLI directly. Use this when the user asks Codex to inspect or operate TradingView himself. Pass argv-style args such as ['status'], ['state'], ['symbol','MNQ1!'], ['timeframe','5'], ['ohlcv','--count','100','--summary'], ['screenshot','--region','chart'], ['pane','list'], ['tab','list'], ['ui-state'], ['draw','list'], ['pine','list']. Outputs parsed JSON when the CLI returns JSON. Do not use for long-running interactive commands.",
    {
      type: "object",
      required: ["args"],
      additionalProperties: false,
      properties: {
        args: { type: "array", minItems: 1, items: { type: "string" } },
        timeout_ms: { type: "number", description: "Optional timeout, clamped to 1000..180000ms. Default 60000." },
      },
    },
  ),
  {
    name: "tv_analyze_full",
    description: "Run the full multi-timeframe TradingView analysis sweep. Returns { path } pointing to the JSON bundle.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pair: { type: "string" },
        baseline_secondary: { type: "string" },
      },
    },
  },
  {
    name: "tv_analyze_fast",
    description: "Run a fast pillar-3 analysis poll, optionally reusing a cached baseline. Returns { path }.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        baseline: { type: "string" },
        pair: { type: "string" },
        baseline_secondary: { type: "string" },
      },
    },
  },
  {
    name: "tv_alert_create",
    description: "Create a TradingView price alert.",
    inputSchema: {
      type: "object",
      required: ["price", "label"],
      additionalProperties: false,
      properties: {
        price: { type: "number" },
        label: { type: "string" },
        condition: { type: "string" },
      },
    },
  },
  { name: "tv_alert_list", description: "List TradingView alerts and statuses.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  {
    name: "tv_alert_delete",
    description: "Remove one TradingView alert by alert_id.",
    inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" } } },
  },
  { name: "surface_setup", description: "Render/persist a graded trade setup card. Call once a setup is valid and this should be the final surface action for entry-hunt turns.", inputSchema: anyObject },
  { name: "surface_no_trade", description: "Persist/render an explicit no-trade reason for the current period.", inputSchema: anyObject },
  { name: "surface_open_reaction", description: "Persist an open-reaction read to the active session folder.", inputSchema: anyObject },
  { name: "surface_ltf_bias", description: "Persist finalized LTF bias at the end of open reaction.", inputSchema: anyObject },
  { name: "surface_session_summary", description: "Persist the session wrap summary.md/json. Call once at the end of wrap turns.", inputSchema: anyObject },
  { name: "surface_session_brief", description: "Persist/render the session brief. Dual-symbol turns call once per symbol.", inputSchema: anyObject },
  { name: "surface_leader_decision", description: "Persist dual-symbol leader decision for the session.", inputSchema: anyObject },
  {
    name: "memory",
    description: "Read/write durable trading memory. Keep writes compact and declarative; do not save one-off session outcomes.",
    inputSchema: {
      type: "object",
      required: ["action", "target"],
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["add", "replace", "remove"] },
        target: { type: "string", enum: ["memory", "user"] },
        content: { type: "string" },
        old_text: { type: "string" },
      },
    },
  },
];

export const CODEX_TV_MCP_TOOLS = RAW_CODEX_TV_MCP_TOOLS.map(normalizeTool);

const INTERACTIVE_TV_SUBCOMMANDS = new Set(["dash", "stream"]);

function parseJsonMaybe(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { ok: true, stdout: "" };
  try {
    return JSON.parse(trimmed);
  } catch {
    return { ok: true, stdout: trimmed };
  }
}

async function tvCli(args = {}) {
  const argv = Array.isArray(args.args) ? args.args.map(String) : [];
  if (argv.length === 0) throw new Error("tv_cli requires args, e.g. { args: ['chart', 'state'] }");
  if (INTERACTIVE_TV_SUBCOMMANDS.has(argv[0])) {
    throw new Error(`tv_cli '${argv[0]}' is interactive/long-running; use finite TradingView commands instead.`);
  }
  const timeoutMs = Number.isFinite(Number(args.timeout_ms)) ? Math.max(1000, Math.min(Number(args.timeout_ms), 180000)) : 60000;
  const stdout = await runTvCapture(argv, { timeoutMs, label: `codex tv_cli ${argv.slice(0, 2).join(" ")}` });
  return { success: true, args: argv, result: parseJsonMaybe(stdout) };
}

const toolHandlers = {
  tv_ping: () => ({ ok: true, server: SERVER_NAME }),
  tv_cli: tvCli,
  tv_analyze_full: (args = {}) => tvAnalyzeFull({ pair: args.pair, baselineSecondary: args.baseline_secondary }),
  tv_analyze_fast: (args = {}) => tvAnalyzeFast({ baseline: args.baseline, pair: args.pair, baselineSecondary: args.baseline_secondary }),
  tv_alert_create: (args = {}) => tvAlertCreate(args).then(() => ({ ok: true })),
  tv_alert_list: () => tvAlertList({}),
  tv_alert_delete: (args = {}) => tvAlertDeleteOne(args),
  surface_setup: (args = {}) => surfaceSetup(args),
  surface_no_trade: (args = {}) => surfaceNoTrade(args),
  surface_open_reaction: (args = {}) => surfaceOpenReaction(args),
  surface_ltf_bias: (args = {}) => surfaceLtfBias(args),
  surface_session_summary: (args = {}) => surfaceSessionSummary(args),
  surface_session_brief: (args = {}) => surfaceSessionBrief(args),
  surface_leader_decision: (args = {}) => surfaceLeaderDecision(args),
  memory: async (args = {}) => {
    const mem = getPersistentMemory();
    await mem.load();
    if (args.action === "add") return mem.add(args.target, args.content || "");
    if (args.action === "replace") return mem.replace(args.target, args.old_text || "", args.content || "");
    if (args.action === "remove") return mem.remove(args.target, args.old_text || "");
    return { success: false, error: `unknown memory action '${args.action}'` };
  },
};

async function appendCallLog(name, args) {
  const logPath = process.env.CODEX_TV_MCP_CALL_LOG;
  if (!logPath) return;
  const record = { ts: new Date().toISOString(), name, args: args || {} };
  await fs.appendFile(logPath, JSON.stringify(record) + "\n", "utf8").catch(() => {});
}

function okContent(data) {
  return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }) }] };
}

function errContent(message) {
  return { content: [{ type: "text", text: String(message) }], isError: true };
}

export async function handleMcpRequest(msg) {
  const { id, method, params } = msg || {};
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: "0.1.0" },
      },
    };
  }
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: CODEX_TV_MCP_TOOLS } };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    const handler = toolHandlers[name];
    if (!handler) return { jsonrpc: "2.0", id, result: errContent(`unknown tool '${name}'`) };
    await appendCallLog(name, args);
    try {
      const result = await handler(args);
      return { jsonrpc: "2.0", id, result: okContent(result) };
    } catch (err) {
      return { jsonrpc: "2.0", id, result: errContent(err?.message || String(err)) };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

function writeMessage(msg) {
  if (!msg) return;
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export function startStdioServer({ input = process.stdin } = {}) {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      Promise.resolve()
        .then(() => handleMcpRequest(JSON.parse(line)))
        .then(writeMessage)
        .catch((err) => writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32603, message: err?.message || String(err) } }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioServer();
}

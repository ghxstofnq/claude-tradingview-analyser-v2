import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CODEX_TV_MCP_TOOLS, handleMcpRequest } from "../app/main/codex-tv-mcp-server.js";

test("Codex tv MCP server lists the app-local surface/analyze tools", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = res.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("tv_cli"));
  assert.ok(names.includes("tv_analyze_full"));
  assert.ok(names.includes("surface_session_summary"));
  assert.ok(names.includes("surface_setup"));
  assert.ok(names.includes("memory"));
  assert.equal(CODEX_TV_MCP_TOOLS.length, names.length);
});

test("Codex tv MCP server exposes tv_cli as the direct TradingView operation tool", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const tvCli = res.result.tools.find((tool) => tool.name === "tv_cli");
  assert.ok(tvCli);
  assert.match(tvCli.description, /operate TradingView himself/);
  assert.deepEqual(tvCli.inputSchema.required, ["args"]);
  assert.equal(tvCli.annotations.destructiveHint, false);
  assert.equal(tvCli.annotations.openWorldHint, false);
});

test("Codex tv MCP server handles initialize handshake", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "test" } });
  assert.equal(res.id, 7);
  assert.equal(res.result.serverInfo.name, "tv");
  assert.deepEqual(res.result.capabilities, { tools: {} });
});

test("Codex tv MCP server rejects interactive tv_cli commands before spawning", async () => {
  const res = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "tv_cli", arguments: { args: ["dash"] } },
  });
  assert.equal(res.id, 3);
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /interactive/);
});

test("Codex tv MCP server appends a call log for post-turn tool-call validation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-tv-mcp-test-"));
  const log = path.join(dir, "calls.jsonl");
  const old = process.env.CODEX_TV_MCP_CALL_LOG;
  process.env.CODEX_TV_MCP_CALL_LOG = log;
  try {
    const res = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "tv_ping", arguments: {} },
    });
    assert.equal(res.id, 2);
    assert.match(res.result.content[0].text, /"ok":true/);
    const lines = (await fs.readFile(log, "utf8")).trim().split("\n");
    const record = JSON.parse(lines.at(-1));
    assert.equal(record.name, "tv_ping");
  } finally {
    if (old === undefined) delete process.env.CODEX_TV_MCP_CALL_LOG;
    else process.env.CODEX_TV_MCP_CALL_LOG = old;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

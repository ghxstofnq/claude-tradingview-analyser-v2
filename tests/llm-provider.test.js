import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodexInvocation, buildProviderSpawnEnv, envKeyForPurpose, normalizeProviderName, resolveLlmProvider, runCodexTextTurn } from '../app/main/llm-provider.js';

// Repo root resolved the same way llm-provider.js resolves it (relative to
// the module file) — a basename assertion breaks inside git worktrees.
const EXPECTED_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('LLM provider selection', () => {
  test('defaults to Claude from a clean environment; Codex is env opt-in', () => {
    const provider = resolveLlmProvider({ purpose: 'bar-close', env: {} });
    assert.equal(provider.name, 'claude');
    assert.equal(provider.supportsToolCalling, true);
    assert.equal(provider.toolRequired, true);
  });

  test('TV_LLM_PROVIDER=codex opts the whole app into Codex with MCP enabled', () => {
    const provider = resolveLlmProvider({ purpose: 'bar-close', env: { TV_LLM_PROVIDER: 'codex' } });
    assert.equal(provider.name, 'codex');
    assert.equal(provider.mcpEnabled, true);
    assert.match(provider.mcpServerPath, /codex-tv-mcp-server\.js$/);
  });

  test('still supports an explicit Claude override when a tool-calling purpose needs it', () => {
    const provider = resolveLlmProvider({ purpose: 'bar-close', providerOverride: 'claude', env: {} });
    assert.equal(provider.name, 'claude');
    assert.equal(provider.supportsToolCalling, true);
    assert.equal(provider.toolRequired, true);
  });

  test('can disable Codex MCP explicitly for text-only diagnostics', () => {
    const provider = resolveLlmProvider({ purpose: 'chat', env: { TV_LLM_PROVIDER_CHAT: 'codex', TV_CODEX_MCP_ENABLED: '0', CODEX_CLI_ARGS: 'exec --skip-git-repo-check' } });
    assert.equal(provider.name, 'codex');
    assert.equal(provider.supportsToolCalling, false);
    assert.equal(provider.toolRequired, false);
    assert.deepEqual(provider.args, ['exec', '--skip-git-repo-check']);
  });

  test('supports an explicit provider override for side-by-side Claude/Codex chat popovers', () => {
    const provider = resolveLlmProvider({ purpose: 'chat', providerOverride: 'codex', env: { TV_LLM_PROVIDER_CHAT: 'claude' } });
    assert.equal(provider.name, 'codex');
    assert.equal(provider.supportsToolCalling, true);
    assert.equal(provider.toolRequired, false);
  });

  test('marks automated surface-tool purposes as requiring tools when Codex is selected', () => {
    const provider = resolveLlmProvider({ purpose: 'bar-close', env: { TV_LLM_PROVIDER: 'codex' } });
    assert.equal(provider.name, 'codex');
    assert.equal(provider.supportsToolCalling, true);
    assert.equal(provider.toolRequired, true);
  });

  test('normalizes aliases and purpose env keys', () => {
    assert.equal(normalizeProviderName('openai-codex'), 'codex');
    assert.equal(envKeyForPurpose('bar-close'), 'TV_LLM_PROVIDER_BAR_CLOSE');
  });

  test('Codex spawn env prepends common Homebrew bin dirs so Electron can find codex', () => {
    const env = buildProviderSpawnEnv({ PATH: '/usr/bin:/bin' });
    const parts = env.PATH.split(':');
    assert.equal(parts[0], '/opt/homebrew/bin');
    assert.equal(parts[1], '/usr/local/bin');
    assert.ok(parts.includes('/usr/bin'));
  });

  test('Codex invocation runs from repo root, attaches tv MCP, captures final message, and sends prompt over stdin', () => {
    const provider = resolveLlmProvider({ purpose: 'chat', providerOverride: 'codex', env: {} });
    const invocation = buildCodexInvocation({ provider, prompt: 'hello codex', outputPath: '/tmp/final.md', mcpCallLogPath: '/tmp/mcp.jsonl' });
    assert.equal(invocation.args[0], 'exec');
    assert.ok(invocation.args.includes('-C'));
    assert.equal(invocation.args[invocation.args.indexOf('-C') + 1], invocation.cwd);
    assert.ok(invocation.args.includes('mcp_servers.tv.command="node"'));
    assert.ok(invocation.args.some((arg) => arg.includes('mcp_servers.tv.args=') && arg.includes('codex-tv-mcp-server.js')));
    assert.ok(invocation.args.includes(`mcp_servers.tv.env.CODEX_TV_MCP_CALL_LOG=${JSON.stringify('/tmp/mcp.jsonl')}`));
    assert.deepEqual(invocation.args.slice(-3), ['--output-last-message', '/tmp/final.md', '-']);
    assert.equal(invocation.stdin, 'hello codex');
    assert.equal(invocation.cwd, EXPECTED_REPO_ROOT);
  });

  test('Codex text turn emits MCP tool_call events recorded by the app-local tv server', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-codex-mcp-'));
    const fakeCodex = path.join(dir, 'codex');
    await fs.writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--output-last-message');
const cfgIdx = args.findIndex((a) => a.startsWith('mcp_servers.tv.env.CODEX_TV_MCP_CALL_LOG='));
if (cfgIdx >= 0) {
  const logPath = JSON.parse(args[cfgIdx].split('=').slice(1).join('='));
  fs.writeFileSync(logPath, JSON.stringify({ ts: '2026-06-04T00:00:00.000Z', name: 'surface_session_summary', args: { session: 'ny-am' } }) + '\\n');
}
if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], 'Wrapped through MCP.\\n');
process.exit(0);
`);
    await fs.chmod(fakeCodex, 0o755);
    const events = [];
    const provider = {
      name: 'codex',
      label: 'Codex',
      supportsToolCalling: true,
      toolRequired: true,
      command: fakeCodex,
      args: ['exec'],
      model: null,
      mcpEnabled: true,
      mcpServerPath: path.join(dir, 'server.js'),
    };

    try {
      await runCodexTextTurn({
        text: 'wrap',
        systemPrompt: 'system prompt',
        purpose: 'wrap',
        provider,
        timeoutMs: 5000,
        onEvent: (event) => events.push(event),
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }

    assert.equal(events.some((event) => event.type === 'tool_call' && event.name === 'mcp__tv__surface_session_summary'), true);
    assert.deepEqual(events.filter((event) => event.type === 'chunk').map((event) => event.text), ['Wrapped through MCP.']);
    assert.equal(events.at(-1).type, 'turn_complete');
  });
  test('Codex text turn emits only captured final assistant message, not raw CLI transcript', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-codex-'));
    const fakeCodex = path.join(dir, 'codex');
    await fs.writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--output-last-message');
process.stdout.write('OpenAI Codex banner\\nSYSTEM PROMPT SHOULD NOT STREAM\\n');
process.stderr.write('hook: Stop Completed\\n');
if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], 'Clean chat reply only.\\n');
process.exit(0);
`);
    await fs.chmod(fakeCodex, 0o755);
    const events = [];
    const provider = {
      name: 'codex',
      label: 'Codex',
      supportsToolCalling: false,
      toolRequired: false,
      command: fakeCodex,
      args: ['exec'],
      model: null,
    };

    try {
      await runCodexTextTurn({
        text: 'hello',
        systemPrompt: 'system prompt',
        purpose: 'chat',
        provider,
        timeoutMs: 5000,
        onEvent: (event) => events.push(event),
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }

    assert.deepEqual(events.filter((event) => event.type === 'chunk').map((event) => event.text), ['Clean chat reply only.']);
    assert.equal(events.some((event) => String(event.text || event.message || '').includes('SYSTEM PROMPT SHOULD NOT STREAM')), false);
    assert.equal(events.at(-1).type, 'turn_complete');
  });
});

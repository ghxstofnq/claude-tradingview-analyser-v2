import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCodexInvocation, buildProviderSpawnEnv, envKeyForPurpose, normalizeProviderName, resolveLlmProvider, runCodexTextTurn } from '../app/main/llm-provider.js';

describe('LLM provider selection', () => {
  test('defaults to Codex from a clean environment', () => {
    const provider = resolveLlmProvider({ purpose: 'bar-close', env: {} });
    assert.equal(provider.name, 'codex');
    assert.equal(provider.supportsToolCalling, false);
    assert.equal(provider.toolRequired, true);
  });

  test('still supports an explicit Claude override when a tool-calling purpose needs it', () => {
    const provider = resolveLlmProvider({ purpose: 'bar-close', providerOverride: 'claude', env: {} });
    assert.equal(provider.name, 'claude');
    assert.equal(provider.supportsToolCalling, true);
    assert.equal(provider.toolRequired, true);
  });

  test('supports Codex as text-only provider through purpose override', () => {
    const provider = resolveLlmProvider({ purpose: 'chat', env: { TV_LLM_PROVIDER_CHAT: 'codex', CODEX_CLI_ARGS: 'exec --skip-git-repo-check' } });
    assert.equal(provider.name, 'codex');
    assert.equal(provider.supportsToolCalling, false);
    assert.equal(provider.toolRequired, false);
    assert.deepEqual(provider.args, ['exec', '--skip-git-repo-check']);
  });

  test('supports an explicit provider override for side-by-side Claude/Codex chat popovers', () => {
    const provider = resolveLlmProvider({ purpose: 'chat', providerOverride: 'codex', env: { TV_LLM_PROVIDER_CHAT: 'claude' } });
    assert.equal(provider.name, 'codex');
    assert.equal(provider.supportsToolCalling, false);
    assert.equal(provider.toolRequired, false);
  });

  test('marks automated surface-tool purposes as requiring tools when Codex is selected', () => {
    const provider = resolveLlmProvider({ purpose: 'bar-close', env: { TV_LLM_PROVIDER: 'codex' } });
    assert.equal(provider.name, 'codex');
    assert.equal(provider.supportsToolCalling, false);
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

  test('Codex invocation runs from repo root, captures final message, and sends prompt over stdin', () => {
    const provider = resolveLlmProvider({ purpose: 'chat', providerOverride: 'codex', env: {} });
    const invocation = buildCodexInvocation({ provider, prompt: 'hello codex', outputPath: '/tmp/final.md' });
    assert.deepEqual(invocation.args.slice(0, 3), ['exec', '-C', invocation.cwd]);
    assert.deepEqual(invocation.args.slice(-3), ['--output-last-message', '/tmp/final.md', '-']);
    assert.equal(invocation.stdin, 'hello codex');
    assert.match(invocation.cwd, /claude-tradingview-analyser-v2$/);
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

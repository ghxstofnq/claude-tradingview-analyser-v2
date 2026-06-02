import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexInvocation, buildProviderSpawnEnv, envKeyForPurpose, normalizeProviderName, resolveLlmProvider } from '../app/main/llm-provider.js';

describe('LLM provider selection', () => {
  test('defaults to Claude with tool calling', () => {
    const provider = resolveLlmProvider({ purpose: 'bar-close', env: {} });
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

  test('Codex invocation runs from repo root and sends prompt over stdin', () => {
    const provider = resolveLlmProvider({ purpose: 'chat', providerOverride: 'codex', env: {} });
    const invocation = buildCodexInvocation({ provider, prompt: 'hello codex' });
    assert.deepEqual(invocation.args.slice(0, 3), ['exec', '-C', invocation.cwd]);
    assert.equal(invocation.args.at(-1), '-');
    assert.equal(invocation.stdin, 'hello codex');
    assert.match(invocation.cwd, /claude-tradingview-analyser-v2$/);
  });
});

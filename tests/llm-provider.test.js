import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { envKeyForPurpose, normalizeProviderName, resolveLlmProvider } from '../app/main/llm-provider.js';

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
});

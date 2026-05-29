import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_PROVIDER_CELLS,
  buildProviderPopoverTitle,
  buildProviderSubmitOptions,
  getExclusiveActiveProvider,
} from '../app/renderer/src/provider-popover-contract.js';

describe('provider popover contract', () => {
  test('renders Claude and Codex as same-functionality bottom-bar cells', () => {
    assert.deepEqual(CHAT_PROVIDER_CELLS.map((cell) => cell.provider), ['claude', 'codex']);
    assert.deepEqual(CHAT_PROVIDER_CELLS.map((cell) => cell.label), ['CLAUDE', 'CODEX']);
    assert.ok(CHAT_PROVIDER_CELLS.every((cell) => cell.popoverClassName === 'claude-popover'));
    assert.ok(CHAT_PROVIDER_CELLS.every((cell) => cell.feedComponent === 'ClaudeFeed'));
    assert.ok(CHAT_PROVIDER_CELLS.every((cell) => cell.placement === 'statusline'));
  });

  test('Codex popover title mirrors Claude title with provider name only', () => {
    assert.equal(buildProviderPopoverTitle('claude'), 'CLAUDE · CONVERSATION');
    assert.equal(buildProviderPopoverTitle('codex'), 'CODEX · CONVERSATION');
  });

  test('Codex submits chat turns with explicit provider override', () => {
    assert.deepEqual(buildProviderSubmitOptions('codex'), { provider: 'codex' });
    assert.deepEqual(buildProviderSubmitOptions('claude'), { provider: 'claude' });
  });

  test('only one provider can be active at a time', () => {
    assert.equal(getExclusiveActiveProvider('claude', 'codex'), 'codex');
    assert.equal(getExclusiveActiveProvider('codex', 'claude'), 'claude');
    assert.equal(getExclusiveActiveProvider('codex', 'codex'), 'codex');
    assert.equal(getExclusiveActiveProvider('bad-provider', 'openai-codex'), 'codex');
  });
});

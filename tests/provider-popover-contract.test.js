import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_PROVIDER_CELLS,
  DEFAULT_CHAT_PROVIDER,
  buildProviderPopoverTitle,
  buildProviderSubmitOptions,
  getExclusiveActiveProvider,
  getProviderChat,
  isProviderChatActive,
  normalizeChatProvider,
  shouldProviderHandleEvent,
} from '../app/renderer/src/provider-popover-contract.js';

describe('provider popover contract', () => {
  test('starts with Codex first and keeps Claude second as fallback', () => {
    assert.equal(DEFAULT_CHAT_PROVIDER, 'codex');
    assert.equal(normalizeChatProvider(), 'codex');
    assert.deepEqual(CHAT_PROVIDER_CELLS.map((cell) => cell.provider), ['codex', 'claude']);
    assert.deepEqual(CHAT_PROVIDER_CELLS.map((cell) => cell.label), ['CODEX', 'CLAUDE']);
  });

  test('renders Claude and Codex as same-functionality bottom-bar cells', () => {
    assert.ok(CHAT_PROVIDER_CELLS.every((cell) => ['claude', 'codex'].includes(cell.provider)));
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

  test('provider popovers use provider-specific chat history instead of shared Claude history', () => {
    const claude = { messages: [{ text: 'claude-only' }], typing: false, workingPurposes: new Set() };
    const codex = { messages: [{ text: 'codex-only' }], typing: true, workingPurposes: new Set(['chat']) };
    const chats = { claude, codex };

    assert.equal(getProviderChat(chats, 'claude'), claude);
    assert.equal(getProviderChat(chats, 'codex'), codex);
    assert.deepEqual(getProviderChat(chats, 'codex').messages, [{ text: 'codex-only' }]);
    assert.equal(isProviderChatActive(chats, 'claude'), false);
    assert.equal(isProviderChatActive(chats, 'codex'), true);
  });

  test('provider chat hooks ignore events emitted for the other provider', () => {
    assert.equal(shouldProviderHandleEvent('claude', { provider: 'claude' }), true);
    assert.equal(shouldProviderHandleEvent('claude', { provider: 'codex' }), false);
    assert.equal(shouldProviderHandleEvent('codex', { provider: 'codex' }), true);
    assert.equal(shouldProviderHandleEvent('openai-codex', { provider: 'codex' }), true);
  });

  test('untagged legacy chat events remain visible to Claude only', () => {
    assert.equal(shouldProviderHandleEvent('claude', {}), true);
    assert.equal(shouldProviderHandleEvent('codex', {}), false);
    assert.equal(shouldProviderHandleEvent('codex', null), false);
  });
});

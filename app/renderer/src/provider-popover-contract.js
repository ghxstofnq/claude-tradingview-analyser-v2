export const CHAT_PROVIDER_CELLS = Object.freeze([
  Object.freeze({
    provider: 'claude',
    label: 'CLAUDE',
    popoverClassName: 'claude-popover',
    feedComponent: 'ClaudeFeed',
    placement: 'statusline',
  }),
  Object.freeze({
    provider: 'codex',
    label: 'CODEX',
    popoverClassName: 'claude-popover',
    feedComponent: 'ClaudeFeed',
    placement: 'statusline',
  }),
]);

export function normalizeChatProvider(provider) {
  const raw = String(provider || 'claude').trim().toLowerCase();
  return raw === 'codex' || raw === 'openai-codex' ? 'codex' : 'claude';
}

export function buildProviderPopoverTitle(provider) {
  const normalized = normalizeChatProvider(provider);
  return `${normalized.toUpperCase()} · CONVERSATION`;
}

export function buildProviderSubmitOptions(provider) {
  return { provider: normalizeChatProvider(provider) };
}

export function getExclusiveActiveProvider(_currentProvider, requestedProvider) {
  return normalizeChatProvider(requestedProvider);
}

export function getProviderChat(chats, provider) {
  const normalized = normalizeChatProvider(provider);
  return chats?.[normalized] || null;
}

export function isProviderChatActive(chats, provider) {
  const chat = getProviderChat(chats, provider);
  return !!(chat?.typing || (chat?.workingPurposes?.size > 0));
}

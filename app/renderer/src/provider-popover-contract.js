// Default chat provider. Aligned with the backend DEFAULT_PROVIDER='claude'
// (2026-06-12) — Codex brief/wrap turns were timing out at 600s, so Claude is
// the default everywhere; Codex remains one explicit switch away.
export const DEFAULT_CHAT_PROVIDER = 'claude';

export const CHAT_PROVIDER_CELLS = Object.freeze([
  Object.freeze({
    provider: 'codex',
    label: 'CODEX',
    popoverClassName: 'claude-popover',
    feedComponent: 'ClaudeFeed',
    placement: 'statusline',
  }),
  Object.freeze({
    provider: 'claude',
    label: 'CLAUDE',
    popoverClassName: 'claude-popover',
    feedComponent: 'ClaudeFeed',
    placement: 'statusline',
  }),
]);

export function normalizeChatProvider(provider) {
  const raw = String(provider || DEFAULT_CHAT_PROVIDER).trim().toLowerCase();
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

export function shouldProviderHandleEvent(ownerProvider, event) {
  const owner = normalizeChatProvider(ownerProvider);
  if (!event || !event.provider) return owner === 'claude';
  return owner === normalizeChatProvider(event.provider);
}

export const CHAT_PROVIDER_CELLS = Object.freeze([
  Object.freeze({
    provider: 'claude',
    label: 'CLAUDE',
    popoverClassName: 'claude-popover',
    feedComponent: 'ClaudeFeed',
  }),
  Object.freeze({
    provider: 'codex',
    label: 'CODEX',
    popoverClassName: 'claude-popover',
    feedComponent: 'ClaudeFeed',
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

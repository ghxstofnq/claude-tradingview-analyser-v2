import { spawn } from 'node:child_process';

const TOOL_REQUIRED_PURPOSES = new Set(['brief', 'bar-close', 'catch-up', 'wrap']);

export function normalizeProviderName(value) {
  const raw = String(value || 'claude').trim().toLowerCase();
  if (raw === 'codex' || raw === 'openai-codex') return 'codex';
  return 'claude';
}

export function envKeyForPurpose(purpose) {
  return `TV_LLM_PROVIDER_${String(purpose || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function resolveLlmProvider({ purpose = 'chat', env = process.env, providerOverride = null } = {}) {
  const purposeOverride = env[envKeyForPurpose(purpose)];
  const globalProvider = env.TV_LLM_PROVIDER || env.LLM_PROVIDER || env.CLAUDE_TRADINGVIEW_LLM_PROVIDER;
  const name = normalizeProviderName(providerOverride || purposeOverride || globalProvider || 'claude');
  if (name === 'codex') {
    return {
      name,
      label: 'Codex',
      supportsToolCalling: false,
      toolRequired: TOOL_REQUIRED_PURPOSES.has(purpose),
      command: env.CODEX_CLI_COMMAND || 'codex',
      args: parseArgs(env.CODEX_CLI_ARGS || 'exec'),
      model: env.CODEX_MODEL || null,
    };
  }
  return {
    name: 'claude',
    label: 'Claude',
    supportsToolCalling: true,
    toolRequired: TOOL_REQUIRED_PURPOSES.has(purpose),
  };
}

function parseArgs(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) || [];
}

export function providerAuthBlockedMessage() {
  const provider = resolveLlmProvider({ purpose: 'bar-close' });
  if (provider.name === 'codex') {
    return 'Codex provider selected but tool-calling automated turns still require deterministic direct surface or Claude-compatible tools. Use TV_LLM_PROVIDER_CHAT=codex for text-only testing, or keep TV_LLM_PROVIDER=claude for live automation.';
  }
  return 'Claude Code not logged in — auto LLM turns paused. Run `claude /login` (or set ANTHROPIC_API_KEY) and restart the dashboard.';
}

export async function runCodexTextTurn({ text, systemPrompt, purpose, onEvent, timeoutMs = 300_000, provider = resolveLlmProvider({ purpose }) }) {
  if (provider.toolRequired && !provider.supportsToolCalling) {
    onEvent?.({
      type: 'error',
      kind: 'provider_capability',
      retryable: false,
      message: `Codex provider cannot run purpose=${purpose} because this turn requires MCP surface tools. Keep this purpose on Claude or use deterministic direct packet surfacing.`,
    });
    onEvent?.({ type: 'turn_complete', purpose, durationMs: 0 });
    return;
  }

  const startedAt = Date.now();
  const prompt = `${Array.isArray(systemPrompt) ? systemPrompt.join('\n\n') : String(systemPrompt || '')}\n\nUSER TURN:\n${text}`;
  const args = [...provider.args];
  if (provider.model) args.push('--model', provider.model);
  args.push(prompt);

  await new Promise((resolve) => {
    const child = spawn(provider.command, args, { env: process.env });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch {}
      onEvent?.({ type: 'error', message: `Codex turn timed out after ${timeoutMs}ms (purpose=${purpose})`, kind: 'timeout', retryable: true });
      onEvent?.({ type: 'turn_complete', purpose, durationMs: Date.now() - startedAt });
      resolve();
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => onEvent?.({ type: 'chunk', text: chunk.toString() }));
    child.stderr?.on('data', (chunk) => onEvent?.({ type: 'chunk', text: chunk.toString() }));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onEvent?.({ type: 'error', message: `Codex provider failed to start: ${err.message}`, kind: 'provider', retryable: false });
      onEvent?.({ type: 'turn_complete', purpose, durationMs: Date.now() - startedAt });
      resolve();
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) onEvent?.({ type: 'error', message: `Codex provider exited with code ${code}`, kind: 'provider', retryable: code !== 127 });
      onEvent?.({ type: 'turn_complete', purpose, durationMs: Date.now() - startedAt });
      resolve();
    });
  });
}

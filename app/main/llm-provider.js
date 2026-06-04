import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_REQUIRED_PURPOSES = new Set(['brief', 'bar-close', 'catch-up', 'wrap']);
const APP_MAIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(APP_MAIN_DIR, '..', '..');
const EXTRA_PATH_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
const DEFAULT_PROVIDER = 'codex';

export function normalizeProviderName(value) {
  const raw = String(value || DEFAULT_PROVIDER).trim().toLowerCase();
  if (raw === 'codex' || raw === 'openai-codex') return 'codex';
  return 'claude';
}

export function envKeyForPurpose(purpose) {
  return `TV_LLM_PROVIDER_${String(purpose || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function resolveLlmProvider({ purpose = 'chat', env = process.env, providerOverride = null } = {}) {
  const purposeOverride = env[envKeyForPurpose(purpose)];
  const globalProvider = env.TV_LLM_PROVIDER || env.LLM_PROVIDER || env.CLAUDE_TRADINGVIEW_LLM_PROVIDER;
  const name = normalizeProviderName(providerOverride || purposeOverride || globalProvider || DEFAULT_PROVIDER);
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

export function buildProviderSpawnEnv(env = process.env) {
  const existingPath = env.PATH || env.Path || '';
  const pathParts = existingPath.split(path.delimiter).filter(Boolean);
  const extras = EXTRA_PATH_DIRS.filter((dir) => !pathParts.includes(dir));
  return {
    ...env,
    PATH: [...extras, ...pathParts].join(path.delimiter),
  };
}

export function buildCodexInvocation({ provider, prompt, outputPath = null }) {
  const args = [...(provider?.args || ['exec'])];
  if (provider?.model) args.push('--model', provider.model);

  // Make Codex run from the repo root even though `npm run dev` is launched
  // from app/. This keeps git/project discovery stable and matches CLI tests.
  if (args[0] === 'exec' && !args.includes('-C') && !args.includes('--cd')) {
    args.push('-C', REPO_ROOT);
  }

  // Codex stdout is a CLI transcript (banner, plugin/skill reads, hooks,
  // logs). The chat UI should behave like Claude chat, so capture only the
  // final assistant message and keep raw stdout/stderr for diagnostics.
  if (args[0] === 'exec' && outputPath && !args.includes('-o') && !args.includes('--output-last-message')) {
    args.push('--output-last-message', outputPath);
  }

  // Feed the prompt through stdin instead of one huge argv item. This avoids
  // shell/argv-size edge cases and keeps multi-line system prompts unambiguous.
  args.push('-');
  return { args, stdin: String(prompt || ''), cwd: REPO_ROOT, outputPath };
}

function appendTail(prev, chunk, max = 2000) {
  const next = `${prev || ''}${chunk}`;
  return next.length > max ? next.slice(next.length - max) : next;
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
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-codex-chat-'));
  const outputPath = path.join(outputDir, 'last-message.md');
  const invocation = buildCodexInvocation({ provider, prompt, outputPath });

  try {
    await new Promise((resolve) => {
      const child = spawn(provider.command, invocation.args, {
        cwd: invocation.cwd,
        env: buildProviderSpawnEnv(process.env),
      });
      let settled = false;
      let outputTail = '';
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGTERM'); } catch {}
        onEvent?.({ type: 'error', message: `Codex turn timed out after ${timeoutMs}ms (purpose=${purpose})`, kind: 'timeout', retryable: true });
        onEvent?.({ type: 'turn_complete', purpose, durationMs: Date.now() - startedAt });
        resolve();
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        outputTail = appendTail(outputTail, chunk.toString());
      });
      child.stderr?.on('data', (chunk) => {
        outputTail = appendTail(outputTail, chunk.toString());
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        onEvent?.({ type: 'error', message: `Codex provider failed to start: ${err.message}`, kind: 'provider', retryable: false });
        onEvent?.({ type: 'turn_complete', purpose, durationMs: Date.now() - startedAt });
        resolve();
      });
      child.on('exit', async (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const detail = outputTail.trim() ? `: ${outputTail.trim()}` : '';
          onEvent?.({ type: 'error', message: `Codex provider exited with code ${code}${detail}`, kind: 'provider', retryable: code !== 127 });
        } else {
          try {
            const finalMessage = await fs.readFile(invocation.outputPath, 'utf8');
            const clean = finalMessage.trim();
            if (clean) onEvent?.({ type: 'chunk', text: clean });
          } catch (err) {
            const detail = outputTail.trim() ? ` Raw output tail: ${outputTail.trim()}` : '';
            onEvent?.({ type: 'error', message: `Codex completed but no final message was captured: ${err.message}.${detail}`, kind: 'provider', retryable: true });
          }
        }
        onEvent?.({ type: 'turn_complete', purpose, durationMs: Date.now() - startedAt });
        resolve();
      });
      child.stdin?.end(invocation.stdin);
    });
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}

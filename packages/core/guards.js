/**
 * Per-tool timeout + retry + circuit breaker for the MCP tool layer.
 *
 * The CDP eval that backs every core function does NOT support cancellation,
 * so on timeout we stop awaiting the in-flight promise but the underlying
 * Electron eval continues to run until it eventually resolves or the page
 * goes away. We accept that leak: the alternative (AbortController) is
 * silently ignored by chrome-remote-interface and gives a false sense of
 * safety. What matters here is unblocking the /walkers hot loop.
 *
 *   withGuards(toolName, fn, { timeoutMs })
 *     - timeoutMs defaults to TVMCP_TOOL_TIMEOUT_MS env (or 8000).
 *     - First timeout → 250ms backoff, retry once.
 *     - Second timeout → throw GuardError('timeout', ...).
 *     - 3 consecutive failures (timeout or rejection) → circuit opens for 60s.
 *     - While open, calls reject immediately with GuardError('circuit_open').
 *     - After cooldown, one trial call decides close (success) or re-open (fail).
 */

const DEFAULT_TIMEOUT_MS = parseInt(process.env.TVMCP_TOOL_TIMEOUT_MS || '8000', 10);
const RETRY_BACKOFF_MS = 250;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;

const TIMEOUT_SENTINEL = Symbol('TIMEOUT');
const circuits = new Map();

export class GuardError extends Error {
  constructor(code, hint) {
    super(hint);
    this.code = code;
    this.hint = hint;
    this.name = 'GuardError';
  }
}

function getCircuit(toolName) {
  let s = circuits.get(toolName);
  if (!s) {
    s = { failures: 0, openUntil: 0 };
    circuits.set(toolName, s);
  }
  return s;
}

function startTimer(ms) {
  let cancel;
  const promise = new Promise((resolve) => {
    const id = setTimeout(() => resolve(TIMEOUT_SENTINEL), ms);
    cancel = () => clearTimeout(id);
  });
  return { promise, cancel };
}

async function runOnce(fn, timeoutMs) {
  const timer = startTimer(timeoutMs);
  try {
    const result = await Promise.race([fn(), timer.promise]);
    if (result === TIMEOUT_SENTINEL) return { timedOut: true };
    return { value: result };
  } finally {
    timer.cancel();
  }
}

export async function withGuards(toolName, fn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const circuit = getCircuit(toolName);

  if (circuit.openUntil > Date.now()) {
    const remaining = Math.ceil((circuit.openUntil - Date.now()) / 1000);
    throw new GuardError(
      'circuit_open',
      `tool ${toolName} is degraded; cooling down for ${remaining}s`,
    );
  }

  const recordFailure = () => {
    circuit.failures += 1;
    if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    }
  };
  const recordSuccess = () => {
    circuit.failures = 0;
    circuit.openUntil = 0;
  };

  let attempt;
  try {
    attempt = await runOnce(fn, timeoutMs);
  } catch (err) {
    recordFailure();
    throw err;
  }

  if (attempt.timedOut) {
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    try {
      attempt = await runOnce(fn, timeoutMs);
    } catch (err) {
      recordFailure();
      throw err;
    }
    if (attempt.timedOut) {
      recordFailure();
      throw new GuardError(
        'timeout',
        `tool ${toolName} stalled (>${timeoutMs}ms x2)`,
      );
    }
  }

  recordSuccess();
  return attempt.value;
}

// Test/debug hooks — not part of the public API.
export function _resetCircuits() {
  circuits.clear();
}

export function _getCircuit(toolName) {
  return circuits.get(toolName) ?? null;
}

export function _setCircuit(toolName, state) {
  circuits.set(toolName, { failures: 0, openUntil: 0, ...state });
}

export const _internals = {
  DEFAULT_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_COOLDOWN_MS,
};

// error-classifier — categorize LLM and runtime errors so consumers can
// react differently per type.
//
// Modeled on Hermes Agent's error_classifier.py. Our needs are narrower
// (one provider, one model family) so the taxonomy is shorter.
//
// Categories (string enum on the returned `kind`):
//   rate_limit       — provider throttled us; retry with backoff
//   context_overflow — prompt + history exceeded the context window
//   content_filter   — Anthropic refused; do not retry
//   auth             — credential / OAuth issue; surface to user, do not retry
//   network          — transient connectivity; retry is reasonable
//   timeout          — our wall-clock killed the turn; not the provider's fault
//   tool_error       — an MCP tool threw; not the LLM's fault
//   unknown          — fallthrough; treat as transient by default
//
// Heuristics: pattern-match the error message + (optional) HTTP status.
// Conservative — when in doubt, classify as `unknown` (retryable).

const PATTERNS = [
  // Anthropic / Claude Agent SDK rate-limit signals.
  [/rate.?limit|429|too many requests|requests per (minute|second)|quota/i, "rate_limit"],
  // Context window exceeded — prompt too large, or model has a smaller window than expected.
  [/context.?(length|window)|exceeds? the|maximum context|too many tokens|prompt is too long/i, "context_overflow"],
  // Content moderation refusal.
  [/content filter|content policy|refused to respond|safety|moderation/i, "content_filter"],
  // Auth / credential issues. 401/403 + plain English equivalents.
  // Claude Code SDK returns plain text like "Not logged in · Please run /login"
  // when the local CLI/OAuth session is absent; classify it as non-retryable
  // auth, not unknown, or live schedulers will spam failed turns every bar.
  [/unauthori[sz]ed|invalid.?api.?key|forbidden|403|401|oauth|credential|expired token|not logged in|please run \/login|login required/i, "auth"],
  // Network errors — DNS, refused, reset, TLS handshake.
  [/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|TLS|fetch failed|network/i, "network"],
  // Our own timeout (wall-clock).
  [/userTurn timed out|cancelled by user/i, "timeout"],
  // MCP tool reported an error (the surface tools or memory tool returning isError).
  [/mcp tool|tool .* failed|surface_/i, "tool_error"],
];

/**
 * Classify an error message into a kind. Returns { kind, retryable, message }
 * — `retryable` is a hint, not a hard rule: rate_limit + network + timeout +
 * unknown are retryable; content_filter + context_overflow + auth + tool_error
 * are not (each for different reasons).
 *
 * @param {string|Error|object} err — error to classify. Strings, Error
 *   objects, or shapes like { message, status } all work.
 * @returns {{ kind: string, retryable: boolean, message: string }}
 */
export function classifyError(err) {
  const message = extractMessage(err);
  const lower = message.toLowerCase();
  for (const [pattern, kind] of PATTERNS) {
    if (pattern.test(lower)) {
      return { kind, retryable: isRetryable(kind), message };
    }
  }
  return { kind: "unknown", retryable: true, message };
}

function extractMessage(err) {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === "object") {
    if (typeof err.message === "string") return err.message;
    return JSON.stringify(err);
  }
  return String(err);
}

function isRetryable(kind) {
  switch (kind) {
    case "rate_limit":
    case "network":
    case "timeout":
    case "unknown":
      return true;
    case "context_overflow":
    case "content_filter":
    case "auth":
    case "tool_error":
      return false;
    default:
      return true;
  }
}

/**
 * Human-readable summary for the UI. Keep it tight — the dashboard's
 * error chip has limited space.
 */
export function describeError({ kind, message }) {
  switch (kind) {
    case "rate_limit": return "rate-limited by Anthropic; backing off";
    case "context_overflow": return "context window exceeded — start a new chat";
    case "content_filter": return "Claude refused this turn (safety filter)";
    case "auth": return "authentication failed — check credentials";
    case "network": return "network error — connection issue";
    case "timeout": return "turn timed out";
    case "tool_error": return `tool error: ${message.slice(0, 80)}`;
    default: return message.slice(0, 120) || "unknown error";
  }
}

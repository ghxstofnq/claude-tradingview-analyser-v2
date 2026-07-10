// app/main/explain-turn.js — on-demand anomaly explainer turn.
//
// Track 2 §2b item 5 (docs/intent/2026-07-10-unified-goal.md). When readiness
// goes red or an app:error fires, the operator clicks EXPLAIN on the System page.
// This fires ONE Claude turn (purpose "explain") that reads a DETERMINISTIC
// context block — the anomaly event + the current readiness rows + a health
// snapshot — and translates the terse technical event into plain language: what
// is wrong, what the system already did about it (fail-closed), and the
// operator's next action. It is deliberately:
//
//   • on-demand + v1 — no scheduler, no auto-fire; a click triggers it, so the
//     LLM cost is paid only when the operator asks (not on every error);
//   • read-only — the "explain" purpose maps to an empty tool list (no surface_*,
//     no trade, no alerts, no captures). The whole context arrives in the prompt
//     text; the turn only explains it. It is NOT a trade signal;
//   • one-shot — resetSession("explain") runs BEFORE every turn, so each
//     explanation is independent (no cross-anomaly accumulation);
//   • in-flight guarded — a second EXPLAIN while one is running is rejected
//     (one explanation at a time; no queue pileup);
//   • streamed — chunk / turn_complete events are forwarded to the caller (the
//     IPC handler), which relays them on the dedicated `explain:*` channel so the
//     chat / CLAUDE feed never sees them.
//
// The serialized context is bounded (explain-context.js) so a huge health/error
// payload can never blow the turn. Like analysis, it persists no file.

import { userTurn, resetSession } from "./sdk.js";
import { record as recordMetric } from "./metrics.js";
import { createInFlightGate } from "./coach-assist.js";
import { serializeExplainContext } from "./explain-context.js";

// An ops explanation is short — a tighter budget than the deep-read analysis turn
// (120s). A hung turn just means no explanation and a surfaced error; the gate is
// released on timeout so the next click works.
export const EXPLAIN_TURN_TIMEOUT_MS = 60_000;

// Module singleton in-flight gate — one explanation at a time in production.
// Injectable (`gate`) for tests.
const _gate = createInFlightGate();
export function isExplainInFlight() { return _gate.busy(); }

/**
 * runExplainTurn({ event, readiness, health, provider, onEvent, deps }) —
 * serialize the anomaly context, reset the explain session, fire one
 * explain-purpose turn, forward every event to `onEvent`, record metrics. Never
 * throws. Deps are injectable for tests.
 *
 *   { ok: true }                      on a clean turn
 *   { ok: false, error }              on a turn that errored / timed out / threw
 *   { ok: false, error, inFlight }    when one is already running (rejected, no turn)
 */
export async function runExplainTurn({
  event = {},
  readiness = null,
  health = null,
  provider,
  onEvent,
  turn = userTurn,
  reset = resetSession,
  metric = recordMetric,
  gate = _gate,
  serialize = serializeExplainContext,
  timeoutMs = EXPLAIN_TURN_TIMEOUT_MS,
} = {}) {
  // Reject a re-click while a turn is running — BEFORE acquiring anything else, so
  // we never release someone else's lock and never fire a second turn.
  if (!gate.tryAcquire()) {
    return { ok: false, error: "an explanation is already running", inFlight: true };
  }

  const startedAt = Date.now();
  const prov = provider || "claude";

  try {
    const text = serialize({ event, readiness, health });

    // One-shot: drop any prior explain session BEFORE the turn so this
    // explanation starts from a clean context. Independent anomalies.
    try { reset?.("explain", prov); } catch { /* best-effort */ }

    metric?.({ kind: "explain", event: "started" });

    let errored = false;
    let timedOut = false;
    let errMessage = null;
    let usage = null;

    try {
      await turn({
        text,
        purpose: "explain",
        providerOverride: provider,
        timeoutMs,
        onEvent: (ev) => {
          if (!ev) return;
          if (ev.type === "usage") { usage = ev.usage; }
          else if (ev.type === "error") {
            errored = true;
            errMessage = ev.message || errMessage;
            if (ev.kind === "timeout") timedOut = true;
          }
          onEvent?.(ev);
        },
      });
      const evt = timedOut ? "timeout" : (errored ? "failed" : "succeeded");
      metric?.({ kind: "explain", event: evt, durationMs: Date.now() - startedAt, usage });
      return errored
        ? { ok: false, error: errMessage || "the explanation failed — try again" }
        : { ok: true };
    } catch (err) {
      const message = String(err?.message || err);
      metric?.({ kind: "explain", event: "failed", durationMs: Date.now() - startedAt, reason: message });
      // userTurn itself rejected (never reached its own turn_complete). Mirror its
      // error→turn_complete convention: surface the error, THEN emit turn_complete
      // so the renderer always clears its running flag (otherwise EXPLAIN would
      // hang on RUNNING).
      onEvent?.({ type: "error", message });
      onEvent?.({ type: "turn_complete" });
      return { ok: false, error: message };
    }
  } finally {
    gate.release();
  }
}

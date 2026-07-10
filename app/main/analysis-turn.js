// app/main/analysis-turn.js — on-demand PREP/LIVE deep-read turn.
//
// Track 2 §2b item 3 (docs/intent/2026-07-10-unified-goal.md). When the trader
// opens the AI view on the PREP or LIVE panel, useAiAnalysis fires ONE Claude
// turn (purpose "analysis") that reads the CURRENT deterministic state and walks
// Lanto's three components in prose. It is deliberately isolated from the chat
// conversation:
//
//   • dedicated purpose — its own session id + its own phase prompt + its own
//     (empty) tool allow-list. Nothing it reads or writes touches the "chat"
//     session, so deep reads never pollute the chat context and vice-versa;
//   • one-shot — resetSession("analysis") runs BEFORE every turn, so each read
//     is an independent question about the state as it stands right now (no
//     cross-question accumulation);
//   • read-only — the purpose maps to an empty tool list (no surface_*, no
//     alerts, no captures). It reads the bundle already on disk and explains it;
//     it is NOT a trade signal (the walker chain is the only setup producer);
//   • streamed — chunk / turn_complete events are forwarded to the caller (the
//     IPC handler), which relays them on the dedicated `analysis:*` channel so
//     the useChat / CLAUDE feed never sees them.
//
// This mirrors the chat:send_message handler's streaming shape but under an
// isolated purpose; it persists no file (unlike coach / journal).

import { userTurn, resetSession } from "./sdk.js";
import { record as recordMetric } from "./metrics.js";

// Deep reads can be chunky; give them a generous but bounded budget. A hung turn
// just means no read and a surfaced error, and the mutex is released on timeout.
export const ANALYSIS_TURN_TIMEOUT_MS = 120_000;

/**
 * runAnalysisTurn({ text, provider, onEvent, deps }) — reset the analysis
 * session, fire one analysis-purpose turn, forward every event to `onEvent`, and
 * record metrics. Never throws. Deps are injectable for tests.
 *
 *   { ok: true }              on a clean turn
 *   { ok: false, error }      on a turn that errored / timed out / threw
 */
export async function runAnalysisTurn({
  text,
  provider,
  onEvent,
  turn = userTurn,
  reset = resetSession,
  metric = recordMetric,
  timeoutMs = ANALYSIS_TURN_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const prov = provider || "claude";

  // One-shot: drop any prior analysis session BEFORE the turn so this read starts
  // from a clean context. Independent questions — never resume the last read.
  try { reset?.("analysis", prov); } catch { /* best-effort */ }

  metric?.({ kind: "analysis", event: "started" });

  let errored = false;
  let timedOut = false;
  let errMessage = null;
  let usage = null;

  try {
    await turn({
      text,
      purpose: "analysis",
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
    const event = timedOut ? "timeout" : (errored ? "failed" : "succeeded");
    metric?.({ kind: "analysis", event, durationMs: Date.now() - startedAt, usage });
    return errored
      ? { ok: false, error: errMessage || "the analysis read failed — try again" }
      : { ok: true };
  } catch (err) {
    const message = String(err?.message || err);
    metric?.({ kind: "analysis", event: "failed", durationMs: Date.now() - startedAt, reason: message });
    // Surface it to the caller as an error event too (the IPC relay turns this
    // into app:error) so the renderer re-enables the AI button.
    onEvent?.({ type: "error", message });
    return { ok: false, error: message };
  }
}

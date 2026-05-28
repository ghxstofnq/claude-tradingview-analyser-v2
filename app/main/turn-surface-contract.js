// turn-surface-contract — post-turn guardrails for Claude tool-surface discipline.
//
// Prompts tell Claude to end every analysis turn with a surface_* tool call,
// but prompts are not enforcement. These pure helpers validate the observed
// tool-call timeline after a turn so the app can flag stuck/no-op turns (prose
// only), wrong phase tools, or ambiguous double surfaces in metrics/UI.

const SURFACE_TOOLS = new Set([
  "mcp__tv__surface_setup",
  "mcp__tv__surface_no_trade",
  "mcp__tv__surface_session_brief",
  "mcp__tv__surface_open_reaction",
  "mcp__tv__surface_ltf_bias",
  "mcp__tv__surface_session_summary",
  "mcp__tv__surface_leader_decision",
]);

function surfaceCalls(toolCalls) {
  return (toolCalls || []).filter((name) => SURFACE_TOOLS.has(name));
}

function count(calls, name) {
  return calls.filter((c) => c === name).length;
}

function has(calls, name) {
  return count(calls, name) > 0;
}

function label(calls) {
  return calls.length ? calls.join(", ") : "none";
}

function fail(message, calls) {
  return { ok: false, message: `${message}. surface_calls=${label(calls)}` };
}

/**
 * Validate surface tool contract for one completed Claude turn.
 *
 * @param {object} params
 * @param {string} params.purpose - userTurn purpose.
 * @param {string} params.text - user prompt sent to Claude (used to route bar-close phases).
 * @param {string[]} params.toolCalls - observed SDK tool_call names in assistant order.
 * @returns {{ok:true}|{ok:false,message:string}}
 */
export function validateTurnSurfaceContract({ purpose, text = "", toolCalls = [] }) {
  const calls = surfaceCalls(toolCalls);

  if (purpose === "brief") {
    if (count(calls, "mcp__tv__surface_session_brief") !== 1 || calls.length !== 1) {
      return fail("brief turn must call exactly one surface_session_brief and no setup/no_trade surface", calls);
    }
    return { ok: true };
  }

  if (purpose === "wrap") {
    if (count(calls, "mcp__tv__surface_session_summary") !== 1 || calls.length !== 1) {
      return fail("wrap turn must call exactly one surface_session_summary and no setup/no_trade surface", calls);
    }
    return { ok: true };
  }

  // Catch-up turns can choose leader + LTF bias, but must NOT surface a setup;
  // they end with no_trade so the LIVE card cannot remain stale.
  if (purpose === "catch-up" || /CATCH-UP TURN/i.test(text)) {
    if (has(calls, "mcp__tv__surface_setup")) {
      return fail("catch-up turn must not call surface_setup", calls);
    }
    if (!has(calls, "mcp__tv__surface_no_trade")) {
      return fail("catch-up turn must end with surface_no_trade", calls);
    }
    return { ok: true };
  }

  if (purpose === "bar-close") {
    if (/Phase:\s*open_reaction\b/.test(text)) {
      if (has(calls, "mcp__tv__surface_setup")) {
        return fail("open-reaction bar-close turn must not call surface_setup", calls);
      }
      if (!has(calls, "mcp__tv__surface_open_reaction")) {
        return fail("open-reaction bar-close turn must call surface_open_reaction", calls);
      }
      if (/minutes_into_phase >= 14|\(\+14m\)|\(\+15m\)/.test(text) && !has(calls, "mcp__tv__surface_ltf_bias")) {
        return fail("final open-reaction turn must call surface_ltf_bias", calls);
      }
      if (!has(calls, "mcp__tv__surface_no_trade")) {
        return fail("open-reaction bar-close turn must end with surface_no_trade", calls);
      }
      return { ok: true };
    }

    const setupCount = count(calls, "mcp__tv__surface_setup");
    const noTradeCount = count(calls, "mcp__tv__surface_no_trade");
    if (setupCount + noTradeCount !== 1) {
      return fail("entry-hunt bar-close turn must call exactly one of surface_setup or surface_no_trade", calls);
    }
    return { ok: true };
  }

  // Chat/review are advisory surfaces; don't hard-fail normal conversation.
  return { ok: true };
}

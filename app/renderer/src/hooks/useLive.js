// app/renderer/src/hooks/useLive.js
// State for the LIVE popover. The key derivation is `subState` — which of the
// five UI bodies to render (idle / open-reaction / entry-hunt / in-trade / done).
//
// This file exports the pure pieces (INITIAL, reducer, deriveSubState) for
// unit-testing, plus a useLive() hook that composes the existing data hooks
// (useActiveSetup, useTrades) and exposes the derived subState + actions.
//
// We deliberately DON'T re-subscribe to setups.current / trade.onAccepted
// here — that would duplicate work already done by useActiveSetup / useTrades.
// The popover passes the right values through to deriveSubState.

import { useCallback, useReducer } from "react";

export const INITIAL = {
  // 'idle' | 'open_reaction' | 'entry_hunt' | 'in_trade' | 'wrap'
  // (note: phase uses underscore form for ipc compat; subState below uses dash form for UI keys)
  phase: "idle",
  activeTrade: null,        // current open trade if any
  surfacedSetup: null,      // setup awaiting accept/reject (entry_hunt only)
  ltfBias: null,            // current LTF bias snapshot
  setupHistory: [],         // today's confirmed setups (read-only display)
  lastBarReadMessage: null, // latest 'bar-read' chat message for BRAIN narration
};

export function reducer(s, action) {
  switch (action.type) {
    case "PHASE_SET":          return { ...s, phase: action.phase };
    case "ACTIVE_TRADE_SET":   return { ...s, activeTrade: action.trade };
    case "ACTIVE_TRADE_CLEAR": return { ...s, activeTrade: null };
    case "SURFACED_SETUP":     return { ...s, surfacedSetup: action.setup };
    case "ACCEPT_SETUP":       return { ...s, surfacedSetup: null };
    case "REJECT_SETUP":       return { ...s, surfacedSetup: null };
    case "LTF_BIAS_SET":       return { ...s, ltfBias: action.bias };
    case "SETUP_HISTORY_SET":  return { ...s, setupHistory: action.setups };
    case "BAR_READ_MESSAGE":   return { ...s, lastBarReadMessage: action.message };
    default: return s;
  }
}

// Pure selector. Order matters: activeTrade wins outright (in-trade UI is
// the highest-priority view); 'wrap' phase wins over hunting; surfacedSetup
// forces entry-hunt; otherwise fall back to phase mapping.
export function deriveSubState({ phase, activeTrade, surfacedSetup }) {
  if (activeTrade) return "in-trade";
  if (phase === "wrap") return "done";
  if (surfacedSetup) return "entry-hunt";
  if (phase === "open_reaction") return "open-reaction";
  if (phase === "entry_hunt") return "entry-hunt";
  return "idle";
}

// useLive — composes external "what is happening" inputs into a single
// subState selector + action callbacks. Caller passes in:
//   { phase, activeTrade, surfacedSetup }
// usually from a useClock-derived phase + useTrades + useActiveSetup.
//
// Returns: { subState, actions }. Internal reducer (above) is exported
// separately for unit tests.
export function useLive({ phase = "idle", activeTrade = null, surfacedSetup = null } = {}) {
  const subState = deriveSubState({ phase, activeTrade, surfacedSetup });

  const acceptSetup = useCallback(async (setup) => {
    return window.api?.trade?.accept?.(setup);
  }, []);

  const rejectSetup = useCallback(async (setupId, reason) => {
    return window.api?.trade?.reject?.(setupId, reason);
  }, []);

  // TV handoff — no broker writes (CLAUDE.md #2). Fires a window event that
  // TvChart listens for (scrolls chart pane) + a toast for the trader.
  const tvHandoff = useCallback((kind, args = {}) => {
    window.dispatchEvent(new CustomEvent("live:tv-handoff", { detail: { kind, ...args } }));
  }, []);

  return {
    subState,
    actions: { acceptSetup, rejectSetup, tvHandoff },
  };
}

// Keep the reducer-imports exported for tests that want to exercise the
// state-transition table directly without the hook.
export function useLiveReducer() {
  return useReducer(reducer, INITIAL);
}

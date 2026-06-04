// useActiveSetup — the active setup card + no-trade reason state.
//
// #68 Split out of useChat so the setup card lifecycle isn't entangled
// with the chat stream. Was: clicking RESET cleared the chat AND the
// setup, even though they're conceptually separate. Each hook now
// owns one concern.
//
// State sources, in order:
//   1. setup:current IPC (main's mirror) — fetched on mount + on
//      setup:updated push.
//   2. chat:tool_call IPC for surface_setup / surface_no_trade.
//
// clearSetup() tells main to clear too, so a mode-flip remount doesn't
// re-hydrate a just-accepted/rejected setup.

import { useEffect, useState } from "react";
import { normalizeNoTradePayload } from "./useActiveSetup.helpers.js";

export function useActiveSetup() {
  const [activeSetup, setActiveSetup] = useState(null);
  const [noTrade, setNoTrade] = useState(null);
  const noTradeReason = noTrade?.reason ?? null;
  const noTradeReasonTs = noTrade?.receivedAtMs ?? null;

  useEffect(() => {
    // Rehydrate from main's mirror — survives mode flips.
    window.api?.setups?.current?.().then((res) => {
      if (!res?.ok) return;
      if (res.setup) setActiveSetup(res.setup);
      if (res.noTrade) setNoTrade(normalizeNoTradePayload(res.noTrade, Date.now()));
      else if (res.noTradeReason) setNoTrade(normalizeNoTradePayload({ reason: res.noTradeReason }, Date.now()));
    }).catch(() => {});

    // Subscribe to tool_call events for surface_setup / surface_no_trade.
    const offToolCall = window.api?.chat?.onToolCall?.((ev) => {
      if (ev?.name === "surface_setup" && ev.payload) {
        setActiveSetup(ev.payload);
        setNoTrade(null);
      } else if (ev?.name === "surface_no_trade" && ev.payload) {
        setActiveSetup(null);
        setNoTrade(normalizeNoTradePayload(ev.payload, Date.now()));
      }
    });

    return () => offToolCall?.();
  }, []);

  function clearSetup() {
    setActiveSetup(null);
    setNoTrade(null);
    window.api?.setups?.clear?.().catch(() => {});
  }

  return { activeSetup, noTrade, noTradeReason, noTradeReasonTs, clearSetup };
}

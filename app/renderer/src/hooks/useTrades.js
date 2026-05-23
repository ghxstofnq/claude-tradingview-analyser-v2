// useTrades — accept/reject + live outcome updates for the active session.
//
// Subscribes to trade:accepted / trade:outcome / trade:rejected IPC events
// and exposes a trades map keyed by id. Also hydrates from main on mount
// via window.api.trade.list().

import { useEffect, useState } from "react";

export function useTrades() {
  const [trades, setTrades] = useState({});         // { id: foldedTrade }
  const [rejected, setRejected] = useState([]);     // [{setup_id, reason, ts}]

  useEffect(() => {
    // Hydrate on mount.
    window.api?.trade?.list?.().then((res) => {
      if (!res?.ok) return;
      const map = {};
      for (const t of res.open || []) map[t.id] = t;
      setTrades(map);
    }).catch(() => {});

    const offAccepted = window.api?.trade?.onAccepted?.((ev) => {
      // ev is the accept event with the size info; mark trade as pending_entry.
      setTrades((prev) => ({
        ...prev,
        [ev.id]: { ...ev, state: "pending_entry" },
      }));
    });

    const offRejected = window.api?.trade?.onRejected?.((ev) => {
      setRejected((prev) => [{ ...ev }, ...prev].slice(0, 20));
    });

    const offOutcome = window.api?.trade?.onOutcome?.((ev) => {
      setTrades((prev) => {
        const cur = prev[ev.id];
        if (!cur) return prev;
        const next = { ...cur };
        if (ev.status === "FILLED") next.state = "filled";
        else if (ev.status === "TP1_HIT") {
          next.tp1_hit = true;
          next.stop = next.entry;
          next.last_r = ev.r_realized;
        } else if (["TP2_HIT", "STOPPED", "INVALIDATED"].includes(ev.status)) {
          next.state = "closed";
          next.outcome = ev.status;
          next.r_realized = ev.r_realized ?? next.r_realized;
        }
        return { ...prev, [ev.id]: next };
      });
    });

    return () => {
      offAccepted?.();
      offRejected?.();
      offOutcome?.();
    };
  }, []);

  async function accept(setup) {
    if (!window.api?.trade?.accept) return { ok: false };
    return window.api.trade.accept(setup);
  }
  async function reject(setupId, reason = "") {
    if (!window.api?.trade?.reject) return { ok: false };
    return window.api.trade.reject(setupId, reason);
  }

  // Active trade = the most recently accepted, non-closed one (v1 single-trade).
  const activeTrade = Object.values(trades)
    .filter((t) => t.state !== "closed")
    .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""))[0] || null;

  return { trades, activeTrade, rejected, accept, reject };
}

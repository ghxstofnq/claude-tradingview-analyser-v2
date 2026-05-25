// useTrades — accept/reject + live outcome updates for the active session.
//
// Subscribes to trade:accepted / trade:outcome / trade:rejected IPC events
// and exposes a trades map keyed by id. Also hydrates from main on mount
// via window.api.trade.list().

import { useEffect, useMemo, useState } from "react";

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
      // #10 Also hydrate the rejected list — reject events live in
      // trades.jsonl alongside accepts. Was: rejected stayed empty
      // until a new reject fired post-mount, so app restart blanked
      // the REJECTED panel.
      if (Array.isArray(res.events)) {
        const recentRejects = res.events
          .filter((e) => e?.type === "reject")
          .slice(-20)              // match the live cap
          .reverse();               // newest first
        if (recentRejects.length) setRejected(recentRejects);
      }
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

  // #24 Active trade selection — sort by ts then id as a tiebreaker so
  // millisecond-tied trades have a deterministic order. #49 memoize so
  // every consumer's render doesn't re-walk Object.values + sort.
  const activeTrade = useMemo(() => {
    const open = Object.values(trades).filter((t) => t.state !== "closed");
    if (!open.length) return null;
    open.sort((a, b) => {
      const c = (b.ts || "").localeCompare(a.ts || "");
      return c !== 0 ? c : (b.id || "").localeCompare(a.id || "");
    });
    return open[0];
  }, [trades]);

  // #46 Live P&L summary — totals across all trades in the current
  // in-memory map. Re-derives via useMemo so consumers only re-render
  // when trades actually change.
  const pnl = useMemo(() => {
    let totalR = 0;
    let wins = 0;
    let losses = 0;
    let openCount = 0;
    for (const t of Object.values(trades)) {
      const r = Number(t.r_realized);
      if (Number.isFinite(r)) totalR += r;
      if (t.state === "closed") {
        if (t.outcome === "TP1_HIT" || t.outcome === "TP2_HIT") wins += 1;
        else if (t.outcome === "STOPPED" || t.outcome === "INVALIDATED") losses += 1;
      } else {
        openCount += 1;
      }
    }
    return {
      totalR: Number(totalR.toFixed(2)),
      wins,
      losses,
      openCount,
      decided: wins + losses,
    };
  }, [trades]);

  return { trades, activeTrade, rejected, accept, reject, pnl };
}

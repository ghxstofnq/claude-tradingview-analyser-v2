// useExecutionState — polls the execution engine's read-only state from main
// (window.api.execution.state) so the UI can truthfully show whether a broker
// (Paper Trading) is connected and what the live position is. Read-only; never
// places an order. Returns { connected, position, workingOrders, balance,
// loading }. Polls every 5s while mounted (cheap — one CDP DOM read in main).
import { useEffect, useState } from "react";

const EMPTY = { connected: false, position: null, workingOrders: [], balance: null };

export function useExecutionState(intervalMs = 2000) {
  const [state, setState] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await window.api?.execution?.state?.();
        if (alive && res?.ok && res.state) setState(res.state);
      } catch { /* read-only; ignore transient CDP errors */ }
      finally { if (alive) setLoading(false); }
    };
    tick();
    const h = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(h); };
  }, [intervalMs]);

  return { ...state, loading };
}

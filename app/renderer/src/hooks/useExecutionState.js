// useExecutionState — polls the execution engine's read-only state from main
// (window.api.execution.state) so the UI can truthfully show whether a broker
// (Paper Trading) is connected and what the live position is. Read-only; never
// places an order. Returns the state fields plus { updated_at, error, stale,
// loading }. Keeps the LAST-KNOWN state on a failed read but flags error/stale
// so the UI never shows a stale position as fresh (Task C3/C5 — fail-closed).
// Polls every 2s while mounted (cheap — one CDP DOM read in main).
import { useEffect, useState } from "react";

const EMPTY = { connected: false, position: null, workingOrders: [], balance: null };

// A state read older than this (wall clock) is considered stale — the position
// / orders can no longer be trusted as live. 3× the 2s poll interval.
const STALE_MS = 6000;

// Pure — exported for tests. No successful read yet (updated_at null) is stale
// (fail-closed); otherwise stale once the last read ages past STALE_MS.
export function deriveExecStale(updated_at, now = Date.now(), staleMs = STALE_MS) {
  if (updated_at == null) return true;
  return (now - updated_at) > staleMs;
}

export function useExecutionState(intervalMs = 2000) {
  const [state, setState] = useState(EMPTY);
  const [meta, setMeta] = useState({ updated_at: null, error: null, loading: true });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await window.api?.execution?.state?.();
        if (!alive) return;
        if (res?.ok && res.state) {
          setState(res.state);
          setMeta({ updated_at: Date.now(), error: null, loading: false });
        } else {
          // Keep last-known state; flag the failure (fail-closed).
          setMeta((m) => ({ ...m, error: res?.error || "execution state read failed", loading: false }));
        }
      } catch (e) {
        if (alive) setMeta((m) => ({ ...m, error: String(e?.message || e), loading: false }));
      }
    };
    tick();
    const h = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(h); };
  }, [intervalMs]);

  const stale = deriveExecStale(meta.updated_at);
  return { ...state, updated_at: meta.updated_at, error: meta.error, loading: meta.loading, stale };
}

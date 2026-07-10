// useOrderIntent — polls the RAW durable order-intent journal from main
// (window.api.execution.orderIntents) for the LIVE order-lifecycle timeline
// (Task C3.2). Mirrors useReadiness: a slow safety poll plus event-driven
// refetches on the two fastest-moving inputs (an app:error, a trade outcome).
//
// It NEVER folds or derives a stage — that is the pure LiveTimeline.helpers job.
// It keeps the last-known records but flags `error`/`stale` so a transient IPC
// failure never blanks the rail or silently shows stale intent as fresh.

import { useEffect, useState, useCallback, useRef } from "react";

export function useOrderIntent({ pollMs = 2500 } = {}) {
  const [snap, setSnap] = useState({ records: [], dropped: 0, reconcile: null, updated_at: null, error: null, loading: true });
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await window.api?.execution?.orderIntents?.();
      if (!aliveRef.current) return;
      if (r?.ok) {
        setSnap({
          records: Array.isArray(r.records) ? r.records : [],
          dropped: Number(r.dropped) || 0,
          reconcile: r.reconcile ?? null,
          updated_at: Date.now(),
          error: null,
          loading: false,
        });
      } else {
        // Keep the last-known records; flag the failure (fail-closed — the rail
        // shows a stale-read badge rather than pretending to be fresh).
        setSnap((s) => ({ ...s, error: r?.error || "orderIntents read failed", loading: false }));
      }
    } catch (e) {
      if (aliveRef.current) setSnap((s) => ({ ...s, error: String(e?.message || e), loading: false }));
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    // Refetch on the two fastest-moving inputs: a broker/execution error event
    // and any trade outcome (fill / TP / stop) — the moments the intent chain
    // most likely just advanced.
    const offErr = window.api?.error?.onError?.(() => refresh());
    const offOutcome = window.api?.trade?.onOutcome?.(() => refresh());
    const h = setInterval(refresh, pollMs);
    return () => { aliveRef.current = false; offErr?.(); offOutcome?.(); clearInterval(h); };
  }, [refresh, pollMs]);

  return { ...snap, refresh };
}

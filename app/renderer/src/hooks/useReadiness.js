// useReadiness — fetches the one readiness object (Task C1) from main and keeps
// it fresh. On-demand + event-driven: re-fetch when health or version changes
// (the two fastest-moving inputs), plus a slow safety poll. Never computes
// readiness in the renderer — main is the single source of truth.

import { useEffect, useState, useCallback, useRef } from "react";

export function useReadiness(symbol = "MNQ1!", { pollMs = 15000 } = {}) {
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await window.api?.readiness?.get?.(symbol);
      if (aliveRef.current && r?.ok && r.readiness) setReadiness(r.readiness);
    } catch { /* transient — keep last-known, never blank */ }
    finally { if (aliveRef.current) setLoading(false); }
  }, [symbol]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    // Re-fetch on the two fastest inputs so a red state clears only when the
    // underlying read proves recovery.
    const offHealth = window.api?.health?.onUpdate?.(() => refresh());
    const offVersion = window.api?.version?.onUpdate?.(() => refresh());
    const h = setInterval(refresh, pollMs);
    return () => { aliveRef.current = false; offHealth?.(); offVersion?.(); clearInterval(h); };
  }, [refresh, pollMs]);

  return { readiness, loading, refresh };
}

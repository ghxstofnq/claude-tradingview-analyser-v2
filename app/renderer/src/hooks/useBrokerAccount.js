// useBrokerAccount — polls the main-process broker routing state
// (execution.account.get) so the UI can show the REAL account orders route to
// (active + confirmed), not the old ephemeral renderer flag. Read-only; never
// places an order. Returns { acct, loading } where acct is the raw
// { ok, active, confirmed, gate, autoResumed } payload (or null).
import { useEffect, useState } from "react";

export function useBrokerAccount(intervalMs = 3000) {
  const [acct, setAcct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await window.api?.execution?.account?.get?.();
        if (alive && r?.ok) setAcct(r);
      } catch { /* read-only; ignore transient errors */ }
      finally { if (alive) setLoading(false); }
    };
    tick();
    const h = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(h); };
  }, [intervalMs]);

  return { acct, loading };
}

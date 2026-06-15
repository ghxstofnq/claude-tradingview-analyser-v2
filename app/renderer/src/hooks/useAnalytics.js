// app/renderer/src/hooks/useAnalytics.js
// Loads every run's setups.jsonl (via backtest:get) and folds them into the
// AnalyticsBody `A` shape with the pure aggregator in cli/lib. Refetches only
// when the set of run ids changes. No fabricated numbers — every figure is
// code-derived from paired open/outcome rows (constraints #6/#7).

import { useEffect, useState } from "react";
import { buildAnalytics } from "../../../../cli/lib/backtest-analytics.js";

export function useAnalytics(runs = [], enabled = true) {
  const [A, setA] = useState(null);
  const [loading, setLoading] = useState(false);
  const ids = runs.map((r) => r.run_id).filter(Boolean);
  const key = ids.join(",");

  useEffect(() => {
    if (!enabled) return undefined;
    if (ids.length === 0) { setA(buildAnalytics([])); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    Promise.all(ids.map((runId) =>
      window.api?.backtest?.get?.({ runId }).catch(() => null),
    )).then((details) => {
      if (cancelled) return;
      setA(buildAnalytics((details || []).filter(Boolean)));
      setLoading(false);
    });
    return () => { cancelled = true; };
    // ids is encoded by `key`; re-run when the run set or enable flag changes.
  }, [key, enabled]);

  return { A, loading };
}

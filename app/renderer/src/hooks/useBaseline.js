// app/renderer/src/hooks/useBaseline.js
// Loads the faithful fold-week baseline (+ history) for one symbol and exposes
// a refold() action. The baseline carries buildAnalytics-ready run_details, so
// LibraryBody feeds it straight into the existing Analytics dashboard. refold()
// re-folds the corpus with current code (pure compute, ~15s/symbol) and also
// refreshes index.json behind the scenes.

import { useEffect, useState, useCallback } from "react";

export function useBaseline(symbol) {
  const [baseline, setBaseline] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refolding, setRefolding] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      window.api?.backtest?.baseline?.get?.(symbol).catch(() => ({})),
      window.api?.backtest?.baseline?.history?.(symbol).catch(() => ({})),
    ]).then(([g = {}, h = {}]) => {
      if (cancelled) return;
      setBaseline(g.baseline ?? null);
      setHistory(Array.isArray(h.history) ? h.history : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => load(), [load]);

  const refold = useCallback(async (reason) => {
    setRefolding(true);
    try {
      const { baseline: b } = await window.api?.backtest?.baseline?.refold?.(symbol, reason) ?? {};
      setBaseline(b ?? null);
      const { history: h } = await window.api?.backtest?.baseline?.history?.(symbol) ?? {};
      setHistory(Array.isArray(h) ? h : []);
      return b ?? null;
    } finally {
      setRefolding(false);
    }
  }, [symbol]);

  return { baseline, history, loading, refolding, refold };
}

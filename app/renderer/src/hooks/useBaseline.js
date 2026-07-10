// app/renderer/src/hooks/useBaseline.js
// Loads the faithful fold-week baseline (+ history) for one symbol and exposes
// a refold() action. The baseline carries buildAnalytics-ready run_details, so
// LibraryBody feeds it straight into the existing Analytics dashboard. refold()
// re-folds the corpus with current code (pure compute, ~15s/symbol) and also
// refreshes index.json behind the scenes.

import { useCallback, useEffect, useRef, useState } from "react";

export async function refoldBaselineRequest({ api, symbol, reason = null, isCurrent, onState }) {
  onState({ readiness: null, refolding: true });
  try {
    const folded = await api.refold(symbol, reason);
    if (!isCurrent()) return { ok: false, stale: true };
    if (!folded || typeof folded !== "object") throw new Error("refold response is malformed");
    onState({ baseline: folded.baseline ?? null, readiness: folded.readiness ?? null });
    const historyResult = await api.history(symbol);
    if (!isCurrent()) return { ok: false, stale: true };
    onState({ history: Array.isArray(historyResult?.history) ? historyResult.history : [] });
    return { ok: true, baseline: folded.baseline ?? null, readiness: folded.readiness ?? null };
  } catch (error) {
    if (isCurrent()) onState({ baseline: null, readiness: null });
    return { ok: false, error: error?.message || String(error) };
  } finally {
    if (isCurrent()) onState({ refolding: false });
  }
}

export function useBaseline(symbol) {
  const [baseline, setBaseline] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refolding, setRefolding] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestSeq.current;
    setLoading(true);
    setRefolding(false);
    setBaseline(null);
    setReadiness(null);
    setHistory([]);
    const api = window.api?.backtest?.baseline;
    Promise.all([
      api?.get?.(symbol).catch(() => ({})) ?? Promise.resolve({}),
      api?.history?.(symbol).catch(() => ({})) ?? Promise.resolve({}),
    ]).then(async ([g = {}, h = {}]) => {
      if (requestSeq.current !== requestId) return;
      setBaseline(g.baseline ?? null);
      setReadiness(g.readiness ?? null);
      setHistory(Array.isArray(h.history) ? h.history : []);
      if (!g.readiness && api?.readiness) {
        const r = await api.readiness(symbol).catch(() => ({}));
        if (requestSeq.current === requestId) setReadiness(r.readiness ?? null);
      }
    }).finally(() => {
      if (requestSeq.current === requestId) setLoading(false);
    });
    return () => { requestSeq.current += 1; };
  }, [symbol]);

  useEffect(() => load(), [load]);

  const refold = useCallback(async (reason) => {
    const requestId = ++requestSeq.current;
    const baselineApi = window.api?.backtest?.baseline;
    const result = await refoldBaselineRequest({
      api: {
        refold: baselineApi?.refold
          ? (selectedSymbol, selectedReason) => baselineApi.refold(selectedSymbol, selectedReason)
          : async () => { throw new Error("baseline refold API unavailable"); },
        history: baselineApi?.history
          ? (selectedSymbol) => baselineApi.history(selectedSymbol)
          : async () => ({ history: [] }),
      },
      symbol,
      reason,
      isCurrent: () => requestSeq.current === requestId,
      onState: (patch) => {
        if (Object.hasOwn(patch, "baseline")) setBaseline(patch.baseline);
        if (Object.hasOwn(patch, "readiness")) setReadiness(patch.readiness);
        if (Object.hasOwn(patch, "history")) setHistory(patch.history);
        if (Object.hasOwn(patch, "refolding")) setRefolding(patch.refolding);
      },
    });
    return result.ok ? result.baseline : null;
  }, [symbol]);

  return { baseline, readiness, history, loading, refolding, refold };
}

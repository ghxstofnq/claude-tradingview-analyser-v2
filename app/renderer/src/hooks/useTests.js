// app/renderer/src/hooks/useTests.js
// Loads fold-tests for one symbol (newest first, without the heavy
// treatment_run_details) and exposes verdict/get/delete actions. Tests are
// CREATED out-of-band by scripts/save-fold-test.mjs; the popover only reads them
// and records accept/reject + reason — never a code-swap.

import { useEffect, useState, useCallback } from "react";

export function useTests(symbol) {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastError, setLastError] = useState(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    window.api?.backtest?.tests?.list?.(symbol)
      .then(({ tests: t } = {}) => { if (!cancelled) { setTests(Array.isArray(t) ? t : []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => load(), [load]);

  const setVerdict = useCallback(async (id, status, reason) => {
    await window.api?.backtest?.tests?.verdict?.(id, status, reason);
    load();
  }, [load]);

  const getTest = useCallback(
    (id) => window.api?.backtest?.tests?.get?.(id).then((r) => r?.test ?? null),
    [],
  );

  const removeTest = useCallback(async (id) => {
    await window.api?.backtest?.tests?.delete?.(id);
    load();
  }, [load]);

  // Fold a treatment over the corpus from the UI (was CLI-only). env is an
  // optional { GATE_KEY: value } applied in the child process; blank folds the
  // current working tree. Returns { ok, id?, error? }.
  const runFoldTest = useCallback(async ({ label, env } = {}) => {
    setRunning(true);
    setLastError(null);
    try {
      const res = await window.api?.backtest?.tests?.run?.({ symbol, label, env });
      if (!res?.ok) setLastError(res?.error || "fold failed");
      load();
      return res;
    } catch (e) {
      setLastError(String(e?.message || e));
      return { ok: false, error: String(e?.message || e) };
    } finally {
      setRunning(false);
    }
  }, [symbol, load]);

  return { tests, loading, running, lastError, setVerdict, getTest, removeTest, runFoldTest, reload: load };
}

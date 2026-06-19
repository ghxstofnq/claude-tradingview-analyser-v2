// app/renderer/src/hooks/useTests.js
// Loads fold-tests for one symbol (newest first, without the heavy
// treatment_run_details) and exposes verdict/get/delete actions. Tests are
// CREATED out-of-band by scripts/save-fold-test.mjs; the popover only reads them
// and records accept/reject + reason — never a code-swap.

import { useEffect, useState, useCallback } from "react";

export function useTests(symbol) {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return { tests, loading, setVerdict, getTest, removeTest, reload: load };
}

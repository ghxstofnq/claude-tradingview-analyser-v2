// useFixtures — lists the regression fixtures (fixtures:list) and runs them via
// the read-only fixtures IPC. Per-row status is in-memory (resets on reload).
import { useCallback, useEffect, useState } from "react";

export function useFixtures() {
  const [fixtures, setFixtures] = useState([]);
  const [status, setStatus] = useState({}); // id → "pass"|"fail"|"skipped"|"running"
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api?.fixtures?.list?.().then((r) => { if (r?.ok) setFixtures(r.fixtures || []); }).catch(() => {});
  }, []);

  const run = useCallback(async (id) => {
    setStatus((s) => ({ ...s, [id]: "running" }));
    const r = await window.api?.fixtures?.run?.(id).catch(() => ({ status: "fail" }));
    setStatus((s) => ({ ...s, [id]: r?.status || "fail" }));
    return r;
  }, []);

  const runAll = useCallback(async () => {
    setBusy(true);
    const r = await window.api?.fixtures?.runAll?.().catch(() => ({ status: "fail" }));
    setBusy(false);
    return r;
  }, []);

  return { fixtures, status, busy, run, runAll };
}

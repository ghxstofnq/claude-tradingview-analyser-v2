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

  // Run each fixture through `run` so every row's pill reflects its real result
  // (the aggregate run_all IPC returns totals only, leaving rows blank). Returns
  // a { passed, total } aggregate; skipped (schema-only) fixtures don't count.
  const runAll = useCallback(async () => {
    setBusy(true);
    let passed = 0, total = 0;
    for (const f of fixtures) {
      const r = await run(f.id);
      if (r?.status && r.status !== "skipped") { total += 1; if (r.status === "pass") passed += 1; }
    }
    setBusy(false);
    return { ok: passed === total, passed, total };
  }, [fixtures, run]);

  return { fixtures, status, busy, run, runAll };
}

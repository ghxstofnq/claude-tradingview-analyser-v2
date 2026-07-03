// useFiles — lists the active session's on-disk files via window.api.files.list()
// (files:list → listSessionFiles). One-shot on mount + a slow refresh so files
// written mid-session appear. Returns { date, session, files, loading }.
import { useEffect, useState } from "react";

export function useFiles() {
  const [data, setData] = useState({ date: null, session: null, files: [] });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = () => window.api?.files?.list?.()
      .then((r) => { if (alive && r?.ok !== false) setData({ date: r?.date ?? null, session: r?.session ?? null, files: r?.files || [] }); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    load();
    const h = setInterval(load, 30000);
    return () => { alive = false; clearInterval(h); };
  }, []);
  return { ...data, loading };
}

// useSymbolCache — pulls state/symbol-cache.json on demand. Refreshes when
// the dropdown opens; that's frequent enough since the cache only changes
// when the user switches symbols (which triggers a tv analyze run).

import { useEffect, useState, useCallback } from "react";

export function useSymbolCache(open) {
  const [cache, setCache] = useState({});

  const reload = useCallback(() => {
    window.api?.quote?.cache?.().then((res) => {
      if (res?.ok) setCache(res.cache || {});
    }).catch(() => {});
  }, []);

  // First load.
  useEffect(() => { reload(); }, [reload]);
  // Re-load every time the consumer says it just opened.
  useEffect(() => { if (open) reload(); }, [open, reload]);

  return cache;
}

export function formatPx(n) {
  if (typeof n !== "number") return "—";
  const [whole, dec = ""] = String(n).split(".");
  const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
}

export function formatAgeShort(iso) {
  if (!iso) return null;
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

// useSessionBrief — pulls the active session's brief(s) from main + subscribes
// to updates pushed when surface_session_brief fires.
//
// Dual-symbol aware: returns `briefsBySymbol` (a map of {symbol → payload})
// and a `selectedSymbol` + `setSelectedSymbol` for tab-style UI. The legacy
// single `brief` returns whichever symbol is currently selected (so callers
// that ignore the symbol concept keep working).

import { useEffect, useMemo, useState } from "react";

export function useSessionBrief() {
  const [briefsBySymbol, setBriefsBySymbol] = useState({});
  const [legacyBrief, setLegacyBrief] = useState(null);
  const [session, setSession] = useState(null); // "london" | "ny-am" | "ny-pm" | null
  const [status, setStatus] = useState("idle"); // "idle" | "running" | "error" | "skipped"
  const [statusReason, setStatusReason] = useState(null); // tells the user WHY skipped/error
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  // ageTick re-renders this hook every 10s so the brief-age display
  // doesn't lie about freshness. Without it, "5m old" stays "5m old"
  // forever until some other state change triggers a render.
  const [, setAgeTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    window.api?.prep?.get?.().then((res) => {
      if (!mounted || !res?.ok) return;
      setSession(res.session);
      setLegacyBrief(res.brief || null);
      const map = res.briefsBySymbol || {};
      setBriefsBySymbol(map);
      // Default to first symbol in the map (alphabetic, so MES1! < MNQ1!
      // — MNQ wins by convention since the primary is listed first in
      // app/main/config.js but config isn't accessible here. The renderer
      // doesn't care about ordering; first available symbol is fine.)
      const firstAvailable = Object.keys(map)[0];
      if (firstAvailable) setSelectedSymbol((cur) => cur || firstAvailable);
    }).catch(() => {});

    const offUpdated = window.api?.prep?.onUpdated?.((record) => {
      if (!record) return;
      if (record.symbol) {
        setBriefsBySymbol((m) => ({ ...m, [record.symbol]: record }));
        setSelectedSymbol((cur) => cur || record.symbol);
      } else {
        setLegacyBrief(record);
      }
      if (record.session) setSession(record.session);
    });
    const offStatus = window.api?.prep?.onStatus?.((ev) => {
      setStatus(ev?.state || "idle");
      // Capture the reason for skipped/error so the UI can surface it
      // instead of silently ignoring the event.
      setStatusReason(ev?.reason || ev?.message || null);
      if (ev?.session) setSession(ev.session);
    });

    // 10-second age refresh. The brief panel header shows "Xm old"; this
    // makes that string actually count up instead of freezing.
    const ageInterval = setInterval(() => setAgeTick((n) => n + 1), 10_000);

    return () => {
      mounted = false;
      clearInterval(ageInterval);
      offUpdated?.();
      offStatus?.();
    };
  }, []);

  async function refresh() {
    setStatus("running");
    try {
      await window.api?.prep?.refresh?.();
    } catch (e) {
      setStatus("error");
    }
  }

  // Brief currently shown: prefer per-symbol selected, fall back to legacy.
  const brief = useMemo(() => {
    if (selectedSymbol && briefsBySymbol[selectedSymbol]) return briefsBySymbol[selectedSymbol];
    return legacyBrief;
  }, [selectedSymbol, briefsBySymbol, legacyBrief]);

  const availableSymbols = useMemo(() => Object.keys(briefsBySymbol), [briefsBySymbol]);

  // Age (ms) from the displayed brief's ts.
  const ageMs = brief?.ts ? (Date.now() - new Date(brief.ts).getTime()) : null;
  return {
    brief,
    briefsBySymbol,
    availableSymbols,
    selectedSymbol,
    setSelectedSymbol,
    session,
    status,
    statusReason,
    refresh,
    ageMs,
  };
}

export function formatAge(ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs)) return "—";
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 60) return `${s}s old`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m old`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m old`;
}

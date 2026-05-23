// useSessionBrief — pulls the active session's brief from main + subscribes
// to updates pushed when surface_session_brief fires.

import { useEffect, useState } from "react";

export function useSessionBrief() {
  const [brief, setBrief] = useState(null);     // payload from surface_session_brief
  const [session, setSession] = useState(null); // "london" | "ny-am" | "ny-pm" | null
  const [status, setStatus] = useState("idle"); // "idle" | "running" | "error" | "skipped"

  useEffect(() => {
    let mounted = true;
    window.api?.prep?.get?.().then((res) => {
      if (!mounted || !res?.ok) return;
      setSession(res.session);
      setBrief(res.brief || null);
    }).catch(() => {});

    const offUpdated = window.api?.prep?.onUpdated?.((record) => {
      setBrief(record);
      if (record?.session) setSession(record.session);
    });
    const offStatus = window.api?.prep?.onStatus?.((ev) => {
      setStatus(ev?.state || "idle");
      if (ev?.session) setSession(ev.session);
    });

    return () => {
      mounted = false;
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

  // Age (ms) from the brief's ts.
  const ageMs = brief?.ts ? (Date.now() - new Date(brief.ts).getTime()) : null;
  return { brief, session, status, refresh, ageMs };
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

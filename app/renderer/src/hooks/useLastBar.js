// useLastBar — single source for the status line's lastBar field.
//
// On mount: fetch the tail of bar-close-events.jsonl via IPC (so the line
// has a value before the first live bar fires). After that: every bar:close
// IPC push updates state in real time.
//
// Returns { ts, tf, age_seconds, age_label }. Null while seeding.

import { useEffect, useState, useRef } from "react";

function formatAge(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function hhmmFromIso(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      timeZone: "America/New_York",
    });
  } catch { return "—"; }
}

export function useLastBar() {
  const [lastBar, setLastBar] = useState(null);
  const tsRef = useRef(null);
  const [tick, setTick] = useState(0);     // forces age recompute every second

  // Seed from disk.
  useEffect(() => {
    let mounted = true;
    window.api?.status?.lastBar?.().then((res) => {
      if (!mounted || !res?.ok || !res.last_bar) return;
      tsRef.current = res.last_bar.ts;
      setLastBar({ ts: res.last_bar.ts, tf: res.last_bar.tf });
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Live updates: every bar:close event from main.
  useEffect(() => {
    const off = window.api?.bar?.onClose?.((ev) => {
      if (!ev?.ts) return;
      tsRef.current = ev.ts;
      setLastBar({ ts: ev.ts, tf: ev.tf || null });
    });
    return () => off?.();
  }, []);

  // Re-render every second so the age string updates.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!lastBar) return { ts: null, tf: null, age_seconds: null, age_label: "—", hhmm: "—" };

  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(lastBar.ts).getTime()) / 1000));
  return {
    ts: lastBar.ts,
    tf: lastBar.tf,
    age_seconds: ageSeconds,
    age_label: formatAge(ageSeconds),
    hhmm: hhmmFromIso(lastBar.ts),
  };
}

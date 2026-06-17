// useDeterministicBrain — subscribes to the deterministic chain's per-bar
// verdict (deterministic:packet) and keeps a short per-bar history for the BRAIN
// feed. Read-only; no Claude in the loop. Each entry: { t, ts, truth }.
import { useEffect, useState } from "react";

function nowStampET() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function useDeterministicBrain(max = 300) {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    const off = window.api?.deterministic?.onPacket?.((truth) => {
      setEntries((prev) => {
        const ts = truth?.eventTimeUtc ?? null;
        // De-dupe: a re-fold of the same bar replaces the last entry rather
        // than stacking a duplicate row.
        const last = prev[prev.length - 1];
        const entry = { t: nowStampET(), ts, truth };
        const next = (last && ts != null && last.ts === ts) ? [...prev.slice(0, -1), entry] : [...prev, entry];
        return next.length > max ? next.slice(-max) : next;
      });
    });
    return off;
  }, [max]);
  return entries;
}

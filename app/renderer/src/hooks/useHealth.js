// useHealth — listens for main's periodic health:update events and exposes
// the current loop state to the topbar pill, plus a derived `stale` flag
// (Task C5) so freshness surfaces can fail closed when the loop is unhealthy or
// the main→renderer bridge has gone quiet.

import { useEffect, useState } from "react";

// A health snapshot is stale when the loop is not healthy, OR the bridge has
// gone quiet (no health:update received in > 12s — ~2.5× the ~5s cadence), OR
// we've never received one. Pure — exported for tests.
export function deriveHealthStale(health, now = Date.now()) {
  if (!health) return true;
  if (health.loop === "stale" || health.loop === "down") return true;
  if (health._recv_at == null) return true;
  return (now - health._recv_at) > 12000;
}

export function useHealth() {
  const [health, setHealth] = useState({ loop: "off" });

  useEffect(() => {
    const off = window.api?.health?.onUpdate?.((ev) => {
      // Stamp when this event was received so the IPC-bridge probe (SystemPage)
      // can show a REAL round-trip age instead of a hardcoded "ok". A stalling
      // _recv_at means the main→renderer bridge (or the monitor) has died.
      setHealth((prev) => ({ ...prev, ...ev, _recv_at: Date.now() }));
    });
    return () => off?.();
  }, []);

  return { ...health, stale: deriveHealthStale(health) };
}

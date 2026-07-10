// useHealth — listens for main's periodic health:update events and exposes
// the current loop state to the topbar pill.

import { useEffect, useState } from "react";

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

  return health;
}

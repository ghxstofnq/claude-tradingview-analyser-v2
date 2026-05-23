// useHealth — listens for main's periodic health:update events and exposes
// the current loop state to the topbar pill.

import { useEffect, useState } from "react";

export function useHealth() {
  const [health, setHealth] = useState({ loop: "off" });

  useEffect(() => {
    const off = window.api?.health?.onUpdate?.((ev) => {
      setHealth((prev) => ({ ...prev, ...ev }));
    });
    return () => off?.();
  }, []);

  return health;
}

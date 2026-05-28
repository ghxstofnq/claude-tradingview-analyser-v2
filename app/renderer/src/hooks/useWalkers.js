// useWalkers — subscribes to walkers:state IPC and exposes the current
// session's walker list to the LIVE popover's WALKER STATUS panel.
// Spec: docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md

import { useEffect, useState } from 'react';

export function useWalkers() {
  const [walkers, setWalkers] = useState([]);
  useEffect(() => {
    const off = window.api?.walkers?.onState?.((ev) => {
      setWalkers(ev?.walkers ?? []);
    });
    return () => off?.();
  }, []);
  return walkers;
}

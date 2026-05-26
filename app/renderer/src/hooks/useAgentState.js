// useAgentState — reads the persistent memory contents + today's usage
// roll-up for the REVIEW page's AGENT STATE panels. Refreshes on every
// turn_complete so the memory + cost cards stay fresh while a session is
// active.
//
// Two IPC handlers back this:
//   memory:read   — { user: {entries, char_count, char_limit, pct},
//                     memory: {entries, char_count, char_limit, pct} }
//   usage:today   — { total_cost_usd, total_turns, total_input, total_output,
//                     by_purpose, by_model }

import { useCallback, useEffect, useState } from "react";

export function useAgentState() {
  const [memory, setMemory] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    // Don't flip loading on subsequent refreshes — keeps the UI from
    // flashing every turn_complete. The initial mount sets loading=true
    // until the first reload resolves.
    try {
      const [mres, ures] = await Promise.all([
        window.api?.memory?.read?.(),
        window.api?.usage?.today?.(),
      ]);
      if (mres?.ok) setMemory(mres);
      if (ures && !ures.error) setUsage(ures);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Refresh whenever a Claude turn completes — covers chat (manual
  // corrections), wrap (auto-fired review writes), and the post-wrap
  // review turn itself. Bar-close + brief don't write memory but firing
  // a reload anyway is cheap (~1ms disk read).
  useEffect(() => {
    const off = window.api?.chat?.onTurnComplete?.(() => reload());
    return () => {
      if (typeof off === "function") off();
    };
  }, [reload]);

  return { memory, usage, loading, reload };
}

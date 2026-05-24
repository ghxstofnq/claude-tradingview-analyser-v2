// useSetupsHistory — last N entries from setups.jsonl for the active session.
// Refreshes on every surface_setup tool call.

import { useEffect, useState, useCallback } from "react";

export function useSetupsHistory({ session, limit = 12 } = {}) {
  const [setups, setSetups] = useState([]);

  const reload = useCallback(() => {
    window.api?.setups?.list?.(session, limit).then((res) => {
      if (res?.ok) setSetups(res.setups || []);
    }).catch(() => {});
  }, [session, limit]);

  useEffect(() => {
    reload();
    const offTool = window.api?.chat?.onToolCall?.((ev) => {
      if (ev?.name === "surface_setup") setTimeout(reload, 80);
    });
    // Also refresh on trade outcomes — keeps the list in sync when a setup
    // is accepted/rejected and the per-row status changes downstream.
    const offOutcome = window.api?.trade?.onOutcome?.(() => setTimeout(reload, 80));
    return () => { offTool?.(); offOutcome?.(); };
  }, [reload]);

  return { setups, reload };
}

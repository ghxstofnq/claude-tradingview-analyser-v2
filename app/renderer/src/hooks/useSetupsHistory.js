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
    // #42 Use the tool_call event payload directly as the new top row
    // instead of trusting disk-write completion via setTimeout. Reload
    // afterwards to pick up any rows we don't have in payload form,
    // but the UI updates immediately.
    const offTool = window.api?.chat?.onToolCall?.((ev) => {
      if (ev?.name !== "surface_setup" || !ev.payload) return;
      setSetups((prev) => {
        const next = [ev.payload, ...prev.filter((s) => s.id !== ev.payload.id)];
        return next.slice(0, limit);
      });
      // Also reload from disk in the background to catch the canonical
      // record (with ts etc) — fire-and-forget, no setTimeout chase.
      reload();
    });
    const offOutcome = window.api?.trade?.onOutcome?.(reload);
    return () => { offTool?.(); offOutcome?.(); };
  }, [reload, limit]);

  return { setups, reload };
}

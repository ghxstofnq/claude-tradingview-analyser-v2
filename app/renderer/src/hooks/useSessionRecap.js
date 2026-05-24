// useSessionRecap — pulls the most-recently-closed session's summary.json.
// Refreshes when Claude calls surface_session_summary.

import { useEffect, useState, useCallback } from "react";

export function useSessionRecap() {
  const [session, setSession] = useState(null);
  const [recap, setRecap] = useState(null);

  const reload = useCallback(() => {
    window.api?.prep?.recap?.().then((res) => {
      if (res?.ok) {
        setSession(res.session);
        setRecap(res.recap);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    // The summary tool call is the signal that fresh data is on disk.
    const offTool = window.api?.chat?.onToolCall?.((ev) => {
      if (ev?.name === "surface_session_summary") {
        // Slight delay — give main's fs.writeFile a tick to flush.
        setTimeout(reload, 80);
      }
    });
    // Also poll every 30s as a fallback in case the IPC misses (catch-up
    // wraps fire on app open and may complete before we subscribed).
    const id = setInterval(reload, 30_000);
    return () => { offTool?.(); clearInterval(id); };
  }, [reload]);

  return { session, recap, reload };
}

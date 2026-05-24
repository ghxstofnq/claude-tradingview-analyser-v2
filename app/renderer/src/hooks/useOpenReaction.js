// useOpenReaction — pulls the open-reaction.json running log for the active
// session. Refreshes when Claude calls surface_open_reaction.

import { useEffect, useState, useCallback } from "react";

export function useOpenReaction(session) {
  const [reads, setReads] = useState([]);
  const [latest, setLatest] = useState(null);

  const reload = useCallback(() => {
    window.api?.prep?.openReaction?.(session).then((res) => {
      if (res?.ok) {
        setReads(res.reads || []);
        setLatest(res.latest || null);
      }
    }).catch(() => {});
  }, [session]);

  useEffect(() => {
    reload();
    const offTool = window.api?.chat?.onToolCall?.((ev) => {
      if (ev?.name === "surface_open_reaction") setTimeout(reload, 80);
      if (ev?.name === "surface_ltf_bias")      setTimeout(reload, 80);
    });
    // Fallback poll every 15s during open reaction — cheap, file is tiny.
    const id = setInterval(reload, 15_000);
    return () => { offTool?.(); clearInterval(id); };
  }, [reload]);

  return { reads, latest, reload };
}

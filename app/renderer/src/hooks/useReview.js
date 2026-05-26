// useReview — loads a single journal + the multi-session library for the
// REVIEW workstation. Pass `{date, session}` to load a specific session; omit
// to land on the most-recent populated one.
//
// Auto-refreshes on chat:turn_complete so a session wrap fired while the
// user is sitting on the REVIEW page doesn't leave them with stale data.
// Subsequent reloads do NOT flip `loading` — only the initial mount does —
// so the UI doesn't flash a spinner every minute when a bar-close finishes.

import { useEffect, useState, useCallback, useRef } from "react";

export function useReview({ date, session } = {}) {
  const [journal, setJournal] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const firstLoadRef = useRef(true);

  const reload = useCallback(async () => {
    if (firstLoadRef.current) setLoading(true);
    try {
      const [jres, sres, lres] = await Promise.all([
        window.api?.review?.journal?.(date, session),
        window.api?.review?.listSessions?.(),
        window.api?.review?.library?.(20),
      ]);
      if (jres?.ok) setJournal(jres.journal);
      if (sres?.ok) setSessions(sres.sessions || []);
      if (lres?.ok) setLibrary(lres.rows || []);
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
    }
  }, [date, session]);

  useEffect(() => { reload(); }, [reload]);

  // Refresh on any turn_complete — covers session-wrap, post-wrap review,
  // chat corrections. Saves the trader from a manual page reload when they
  // leave REVIEW open during an active session.
  useEffect(() => {
    const off = window.api?.chat?.onTurnComplete?.(() => reload());
    return () => {
      if (typeof off === "function") off();
    };
  }, [reload]);

  return { journal, sessions, library, loading, reload };
}

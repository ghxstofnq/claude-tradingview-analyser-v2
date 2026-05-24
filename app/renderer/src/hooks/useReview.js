// useReview — loads a single journal + the multi-session library for the
// REVIEW workstation. Pass `{date, session}` to load a specific session; omit
// to land on the most-recent populated one.

import { useEffect, useState, useCallback } from "react";

export function useReview({ date, session } = {}) {
  const [journal, setJournal] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
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
    }
  }, [date, session]);

  useEffect(() => { reload(); }, [reload]);

  return { journal, sessions, library, loading, reload };
}

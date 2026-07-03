// useCalendar — this week's ForexFactory USD events (calendar.thisWeek) with
// live refresh broadcasts. Returns the events array (empty until loaded).
import { useEffect, useState } from "react";

export function useCalendar() {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    let alive = true;
    window.api?.calendar?.thisWeek?.().then((r) => { if (alive && r?.ok) setEvents(r.events || []); }).catch(() => {});
    const off = window.api?.calendar?.onUpdate?.((p) => { if (alive) setEvents(p?.events || []); });
    return () => { alive = false; off?.(); };
  }, []);
  return events;
}

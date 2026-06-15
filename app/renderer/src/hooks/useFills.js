// useFills — loads real execution fill records (state/trades) from main.
// date: a "YYYY-MM-DD" string for one session, or "all" for the full
// cumulative history (TRACK RECORD). Refreshes on turn-complete + a slow
// interval so a fill written mid-session shows up without a manual reload.
import { useEffect, useState } from "react";

export function useFills(date = "all") {
  const [fills, setFills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => window.api?.execution?.fills?.(date)
      .then((res) => { if (alive && res?.ok) setFills(res.fills || []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    load();
    const off = window.api?.chat?.onTurnComplete?.(() => load());
    const h = setInterval(load, 15000);
    return () => { alive = false; clearInterval(h); off?.(); };
  }, [date]);

  return { fills, loading };
}

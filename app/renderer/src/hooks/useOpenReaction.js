// useOpenReaction — pulls the open-reaction.json running log for the active
// session. Refreshes when Claude calls surface_open_reaction.

import { useEffect, useState, useCallback } from "react";

// Poll while a session is live. Originally (#22) this was the 30-min open-reaction
// window only, to save disk I/O. The live LTF-bias strip now needs the per-bar
// resolver output through entry-hunt too (it earns/flips direction after the open
// window), so the gate widens to the full active session. Still session-scoped —
// no all-day or post-session polling.
function isWithinLiveSession() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const m = Number(get("hour")) * 60 + Number(get("minute"));
  // London 03:00-06:00; NY AM 09:30-12:00; NY PM 13:00-16:00 ET.
  if (m >= 3 * 60 && m < 6 * 60) return true;
  if (m >= 9 * 60 + 30 && m < 12 * 60) return true;
  if (m >= 13 * 60 && m < 16 * 60) return true;
  return false;
}

export function useOpenReaction(session) {
  const [reads, setReads] = useState([]);
  const [latest, setLatest] = useState(null);
  const [ltf, setLtf] = useState(null);

  const reload = useCallback(() => {
    window.api?.prep?.openReaction?.(session).then((res) => {
      if (res?.ok) {
        setReads(res.reads || []);
        setLatest(res.latest || null);
        setLtf(res.ltf || null);
      }
    }).catch(() => {});
  }, [session]);

  useEffect(() => {
    reload();
    const offTool = window.api?.chat?.onToolCall?.((ev) => {
      if (ev?.name === "surface_open_reaction") setTimeout(reload, 80);
      if (ev?.name === "surface_ltf_bias")      setTimeout(reload, 80);
    });
    // Poll every 15s ONLY during the open-reaction window. Re-check
    // window membership on every interval tick — if the window opened
    // mid-mount, polling kicks in.
    const id = setInterval(() => {
      if (isWithinLiveSession()) reload();
    }, 15_000);
    return () => { offTool?.(); clearInterval(id); };
  }, [reload]);

  return { reads, latest, ltf, reload };
}

// useOpenReaction — pulls the open-reaction.json running log for the active
// session. Refreshes when Claude calls surface_open_reaction.

import { useEffect, useState, useCallback } from "react";

// #22 Only poll during the open-reaction window. Was: polled every
// 15s for the whole entry-hunt + post-session phases, wasted disk I/O.
// Window is generous (open-reaction is ~15min but stretches if the
// system started late) — 30min covers it.
function isWithinOpenReactionWindow() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const m = Number(get("hour")) * 60 + Number(get("minute"));
  // NY AM open-reaction + lock: 09:30-10:00; NY PM: 13:30-14:00; London: 03:00-03:30
  if (m >= 9 * 60 + 30 && m < 10 * 60) return true;
  if (m >= 13 * 60 + 30 && m < 14 * 60) return true;
  if (m >= 3 * 60 && m < 3 * 60 + 30) return true;
  return false;
}

export function useOpenReaction(session) {
  const [reads, setReads] = useState([]);
  const [latest, setLatest] = useState(null);
  const [ltfBias, setLtfBias] = useState(null);
  const [lockDecision, setLockDecision] = useState(null);

  const reload = useCallback(() => {
    window.api?.prep?.openReaction?.(session).then((res) => {
      if (res?.ok) {
        setReads(res.reads || []);
        setLatest(res.latest || null);
        setLtfBias(res.ltfBias || null);
        setLockDecision(res.lockDecision || null);
      }
    }).catch(() => {});
  }, [session]);

  useEffect(() => {
    reload();
    const offTool = window.api?.chat?.onToolCall?.((ev) => {
      if (ev?.name === "surface_open_reaction") setTimeout(reload, 80);
      if (ev?.name === "surface_ltf_bias")      setTimeout(reload, 80);
    });
    const offLock = window.api?.prep?.onLockBriefDecision?.((ev) => {
      setLockDecision(ev || null);
      setTimeout(reload, 80);
    });
    // Poll every 15s ONLY during the open-reaction window. Re-check
    // window membership on every interval tick — if the window opened
    // mid-mount, polling kicks in.
    const id = setInterval(() => {
      if (isWithinOpenReactionWindow()) reload();
    }, 15_000);
    return () => { offTool?.(); offLock?.(); clearInterval(id); };
  }, [reload]);

  return { reads, latest, ltfBias, lockDecision, reload };
}

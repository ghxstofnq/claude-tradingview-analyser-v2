// NewsView — palette calendar view: ForexFactory USD events grouped by ET day.

import React from "react";

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function etParts(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { key: `${g("year")}-${g("month")}-${g("day")}`,
           weekday: (g("weekday") || "").toUpperCase().slice(0, 3),
           label: `${g("weekday")?.toUpperCase()?.slice(0,3)} · ${MONTHS[Number(g("month")) - 1]} ${Number(g("day"))}` };
}

function fmtTimeET(ts) {
  return new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }) + " ET";
}
function fmtCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const m = Math.floor(ms / 60000); const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export function NewsView({ events = [] }) {
  const now = Date.now();
  const todayKey = etParts(now)?.key;
  const groups = new Map();
  for (const ev of events) {
    const p = etParts(ev?.ts); if (!p) continue;
    if (!groups.has(p.key)) groups.set(p.key, { ...p, rows: [] });
    groups.get(p.key).rows.push(ev);
  }
  const ordered = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div className="cmd-news">
      {ordered.length === 0 && <div className="cmd-pal-empty">no events this week</div>}
      {ordered.map((g) => (
        <React.Fragment key={g.key}>
          <div className="day">
            <span>{g.label}</span>
            {g.key === todayKey && <span className="badge">TODAY</span>}
          </div>
          {g.rows.map((e, i) => {
            const dt = new Date(e.ts).getTime();
            const past = dt < now;
            const imminent = !past && dt - now <= 2 * 60 * 60 * 1000;
            const imp = (e.impact || "").toLowerCase();
            return (
              <div key={i} className={"cmd-nrow" + (imminent ? " hot" : "") + (past ? " past" : "")}>
                <span className="ts">{imminent ? `IN ${fmtCountdown(dt - now)}` : fmtTimeET(e.ts)}</span>
                <span className="ev">{e.event}
                  {e.forecast && <span className="fc"> · fcst {e.forecast}{e.previous ? ` · prev ${e.previous}` : ""}</span>}
                </span>
                <span className={"cmd-imp " + imp}>{(e.impact || "").toUpperCase().slice(0, 3)}</span>
              </div>
            );
          })}
        </React.Fragment>
      ))}
      <div className="rule">rule: no entries ±10 min around HIGH impact</div>
    </div>
  );
}

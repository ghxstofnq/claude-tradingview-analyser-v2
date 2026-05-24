// useClock — single source of truth for ET clock, current phase,
// killzone countdown, and market-open state. Ticks every second.
//
// Phase + killzone windows mirror app/main/sessions.js and bar-close.js
// phaseFor() — keep this file in sync if you change the windows there.
//
// CME futures closed windows:
//   - Fri 17:00 ET → Sun 18:00 ET (weekend break)
//   - Daily 17:00–18:00 ET (settlement break)

import { useEffect, useState } from "react";

function nyParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  }).formatToParts(date);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

function formatMinutes(mins) {
  if (mins == null || mins < 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function nextKillzone(m) {
  const slots = [
    { label: "LONDON 03:00", at: 3 * 60 },
    { label: "NY AM 09:30",  at: 9 * 60 + 30 },
    { label: "NY PM 13:00",  at: 13 * 60 },
  ];
  for (const s of slots) {
    if (m < s.at) return { label: s.label, inMinutes: s.at - m };
  }
  return { label: null, inMinutes: 0 };
}

function deriveMarketState(weekday, m) {
  // Friday 17:00 → Sun 18:00 is the weekend break.
  if (weekday === "Sat") return "closed-weekend";
  if (weekday === "Sun" && m < 18 * 60) return "closed-weekend";
  if (weekday === "Fri" && m >= 17 * 60) return "closed-weekend";
  // Daily 17:00–18:00 ET settlement break.
  if (m >= 17 * 60 && m < 18 * 60) return "closed-daily";
  return "open";
}

function deriveOpensIn(weekday, m, state) {
  if (state === "closed-daily") return 18 * 60 - m;
  if (state === "closed-weekend") {
    // Walk forward to Sun 18:00.
    if (weekday === "Sun") return 18 * 60 - m;
    if (weekday === "Sat") return 24 * 60 - m + 18 * 60;             // rest of Sat + 18h Sun
    if (weekday === "Fri") return 24 * 60 - m + 24 * 60 + 18 * 60;    // rest of Fri + Sat + 18h Sun
  }
  return 0;
}

function deriveOpensAt(state) {
  if (state === "closed-daily") return "opens 18:00 ET";
  if (state === "closed-weekend") return "opens Sun 18:00 ET";
  return "";
}

function deriveStatus(now = new Date()) {
  const { hour, minute, second, weekday, date } = nyParts(now);
  const m = hour * 60 + minute;
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const marketState = deriveMarketState(weekday, m);
  const opensIn = formatMinutes(deriveOpensIn(weekday, m, marketState));
  const opensAt = deriveOpensAt(marketState);

  if (marketState !== "open") {
    return {
      clock, date, weekday, m, second,
      phase: marketState === "closed-weekend" ? "MARKET CLOSED · WEEKEND" : "MARKET CLOSED · SETTLEMENT",
      killzone: "—",
      marketState, opensIn, opensAt,
    };
  }

  // Weekday sessions.
  let phase = "INTER-SESSION";
  let killzone = "—";

  if (weekday === "Sat" || weekday === "Sun") {
    phase = "MARKET CLOSED · WEEKEND";
  } else if (m >= 3 * 60 && m < 3 * 60 + 15) {
    phase = "OPEN REACTION";
    killzone = `LONDON · ${3 * 60 + 15 - m}m left in open`;
  } else if (m >= 3 * 60 + 15 && m < 6 * 60) {
    phase = "ENTRY HUNT";
    killzone = `LONDON · ${formatMinutes(6 * 60 - m)} left`;
  } else if (m >= 9 * 60 + 30 && m < 9 * 60 + 45) {
    phase = "OPEN REACTION";
    killzone = `NY AM · ${9 * 60 + 45 - m}m left in open`;
  } else if (m >= 9 * 60 + 45 && m < 12 * 60) {
    phase = "ENTRY HUNT";
    killzone = `NY AM · ${formatMinutes(12 * 60 - m)} left`;
  } else if (m >= 13 * 60 && m < 13 * 60 + 15) {
    phase = "OPEN REACTION";
    killzone = `NY PM · ${13 * 60 + 15 - m}m left in open`;
  } else if (m >= 13 * 60 + 15 && m < 16 * 60) {
    phase = "ENTRY HUNT";
    killzone = `NY PM · ${formatMinutes(16 * 60 - m)} left`;
  } else {
    const next = nextKillzone(m);
    if (next.label) {
      phase = "PRE-SESSION";
      killzone = `${next.label} in ${formatMinutes(next.inMinutes)}`;
    }
  }

  return { clock, date, weekday, m, second, phase, killzone, marketState, opensIn, opensAt };
}

export function useClock() {
  const [s, setS] = useState(() => deriveStatus());
  useEffect(() => {
    const id = setInterval(() => setS(deriveStatus()), 1000);
    return () => clearInterval(id);
  }, []);
  return s;
}

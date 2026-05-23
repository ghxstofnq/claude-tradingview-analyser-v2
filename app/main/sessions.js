// Active-session resolver — ET-clock based.
//
// Returns which trading session (ny-am / ny-pm / london / idle) is current,
// and where to write per-session state files.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function nyParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(date);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

export function currentSession() {
  const { date, hour, minute, weekday } = nyParts();
  let session = "idle";
  if (weekday !== "Sat" && weekday !== "Sun") {
    const m = hour * 60 + minute;
    if (m >= 9 * 60 + 30 && m < 12 * 60) session = "ny-am";
    else if (m >= 13 * 60 && m < 16 * 60) session = "ny-pm";
    else if (m >= 3 * 60 && m < 6 * 60) session = "london";
  }
  return { date, session, et_hour: hour, et_minute: minute, weekday };
}

export async function activeSessionDir() {
  const { date, session } = currentSession();
  const dir = path.join(
    REPO_ROOT,
    "state",
    "session",
    date,
    session === "idle" ? "ny-am" : session,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

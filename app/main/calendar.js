// app/main/calendar.js — ForexFactory weekly economic calendar.
//
// Pulls https://nfs.faireconomy.media/ff_calendar_thisweek.json (Faireconomy's
// JSON mirror of the ForexFactory red-folder calendar). Filters down to USD
// high + medium impact events, normalizes the shape, caches to disk at
// state/calendar/this-week.json, and refreshes:
//   - on app boot if the cache is missing or older than 24h
//   - every Monday at 06:00 ET via plain setTimeout (no LLM turn, so the
//     scheduled-turn factory would be overkill).
//
// Public surface:
//   bootstrap({ send })     — call once at app boot
//   readCache()             — returns { events, fetched_at } or { events: [] }
//   refreshNow()            — manual / scheduler-triggered re-fetch
//   filterEvents(raw)       — exported for tests
//   isImminent(ev, now)     — exported for tests + renderer logic
//   groupByDay(events)      — exported for tests + renderer logic
//   countRemaining(...)     — exported for tests + renderer logic

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CACHE_FILE = path.join(REPO_ROOT, "state", "calendar", "this-week.json");

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const STALE_MS = 24 * 60 * 60 * 1000; // 24h
const IMMINENT_MS = 2 * 60 * 60 * 1000; // 2h window for amber highlight

// ── filtering / normalization ───────────────────────────────────────────

// Filter raw ForexFactory rows down to USD high + medium events. Normalizes
// the shape so the renderer sees a stable schema:
//   { ts, currency, event, impact, forecast, previous, released }
//
// The Faireconomy feed uses fields:
//   country  ("USD" / "EUR" / ...)
//   title    ("CPI m/m")
//   date     ISO timestamp (UTC)
//   impact   ("High" / "Medium" / "Low" / "Holiday")
//   forecast (string)
//   previous (string)
export function filterEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && r.country === "USD")
    .filter((r) => {
      const i = String(r.impact || "").toLowerCase();
      return i === "high" || i === "medium";
    })
    .map((r) => ({
      ts: r.date,
      currency: r.country,
      event: r.title,
      impact: String(r.impact).toLowerCase(),
      forecast: r.forecast || "",
      previous: r.previous || "",
      released: false, // back-fill is done in the renderer by comparing to now
    }));
}

// Is an event imminent? True if the event hasn't released yet and starts
// within IMMINENT_MS from `now`.
export function isImminent(ev, now = new Date()) {
  if (!ev || !ev.ts) return false;
  const dt = new Date(ev.ts).getTime();
  if (!Number.isFinite(dt)) return false;
  const dtNow = now.getTime();
  return dt > dtNow && (dt - dtNow) <= IMMINENT_MS;
}

// Count events whose timestamp is strictly after `now`. Used by the topbar
// count badge to show "events remaining this week".
export function countRemaining(events, now = new Date()) {
  if (!Array.isArray(events)) return 0;
  const dtNow = now.getTime();
  return events.filter((e) => {
    const t = new Date(e?.ts).getTime();
    return Number.isFinite(t) && t > dtNow;
  }).length;
}

// Group events by ET weekday. Returns [{ weekday: "MON", date: "MAY 25",
// dateIso: "2026-05-25", events: [...] }] sorted chronologically.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function etParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday: (get("weekday") || "").toUpperCase().slice(0, 3),
  };
}

export function groupByDay(events) {
  if (!Array.isArray(events)) return [];
  const byKey = new Map();
  for (const ev of events) {
    if (!ev?.ts) continue;
    const d = new Date(ev.ts);
    if (!Number.isFinite(d.getTime())) continue;
    const p = etParts(d);
    const key = `${p.year}-${p.month}-${p.day}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        weekday: p.weekday,
        date: `${MONTHS[Number(p.month) - 1]} ${Number(p.day)}`,
        dateIso: key,
        events: [],
      });
    }
    byKey.get(key).events.push(ev);
  }
  // Sort by dateIso ascending so days are chronological.
  return [...byKey.values()].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

// ── cache I/O ────────────────────────────────────────────────────────────

async function writeCache(payload) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

export async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { events: [], fetched_at: null };
  }
}

async function cacheAgeMs() {
  try {
    const stat = await fs.stat(CACHE_FILE);
    return Date.now() - stat.mtimeMs;
  } catch {
    return Infinity;
  }
}

// ── fetcher ──────────────────────────────────────────────────────────────

export async function refreshNow({ send } = {}) {
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const events = filterEvents(raw);
    const payload = { events, fetched_at: new Date().toISOString() };
    await writeCache(payload);
    if (send) send("calendar:update", payload);
    // eslint-disable-next-line no-console
    console.log(`[calendar] refreshed ${events.length} USD high/medium events`);
    return payload;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[calendar] refresh failed", err?.message || err);
    return null;
  }
}

// ── scheduler ────────────────────────────────────────────────────────────

let _timer = null;

function msUntilNextMondaySixAmET(now = new Date()) {
  // Walk minute-by-minute (DST-correct because we ask the formatter for
  // ET hour/weekday each probe). Cap at 8d so the loop always terminates.
  const start = now.getTime();
  for (let off = 1; off < 8 * 24 * 60; off += 1) {
    const probe = new Date(start + off * 60_000);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(probe);
    const get = (t) => fmt.find((p) => p.type === t)?.value;
    if (get("weekday") === "Mon" && Number(get("hour")) === 6 && Number(get("minute")) === 0) {
      return Math.floor(probe.getTime() / 60_000) * 60_000 - start;
    }
  }
  return 7 * 24 * 60 * 60_000; // fallback — shouldn't reach
}

function scheduleNext({ send }) {
  if (_timer) clearTimeout(_timer);
  const ms = msUntilNextMondaySixAmET();
  _timer = setTimeout(async () => {
    await refreshNow({ send });
    scheduleNext({ send });
  }, ms);
  // eslint-disable-next-line no-console
  console.log(`[calendar] next Monday 06:00 ET refresh in ${Math.round(ms / 60_000)} min`);
}

// ── boot ─────────────────────────────────────────────────────────────────

export async function bootstrap({ send }) {
  const age = await cacheAgeMs();
  if (age === Infinity || age > STALE_MS) {
    // Fire-and-forget; don't block app boot.
    refreshNow({ send }).catch(() => {});
  }
  scheduleNext({ send });
}

export function stop() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

// cli/lib/market-calendar.js
// CME equity-index-futures (ES/NQ → MNQ/MES) holiday + early-close calendar,
// consulted by the session gate, the session resolver, and the supervisor so
// the bot does not arm or hunt on a closed or half-day market (audit C8 — the
// documented "Juneteenth broke recording" failure).
//
// Times are ET. Source: cmegroup.com/trading-hours (2026 schedule). CME
// finalizes each holiday ~2 weeks out and NYSE/SIFMA can shift it, so treat
// this as PRELIMINARY and re-verify before each holiday. Data-driven on purpose:
// a clone can replace these tables with its own market's calendar.
//
// Early-close days: the equity halt is ~12:15 CT (13:15 ET), 12:00 CT (13:00 ET)
// on July 3. We gate the market CLOSED from 13:00 ET on every early-close day —
// the NY-PM window (13:00–16:00) must not arm into a thin, closing/closed book,
// while London + NY-AM (both before noon ET) run normally.

// Full-day closures — no session trades at all.
const FULL_CLOSURES = new Set([
  "2026-01-01", // New Year's Day
  "2026-04-03", // Good Friday
  "2026-12-25", // Christmas Day
]);

// Early-close days → ET minute from which the market is treated as closed.
// Pinned to 13:00 ET so NY-PM never arms on a half-day (see header).
const EARLY_CLOSE_MIN = 13 * 60;
const EARLY_CLOSES = new Set([
  "2026-01-19", // Martin Luther King Jr. Day
  "2026-02-16", // Presidents' Day
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed; July 4 is a Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-11-27", // Black Friday (equities close 13:00 ET)
]);

// True on a full-day closure (all ET minutes).
export function isHolidayFullClose(date) {
  return FULL_CLOSURES.has(date);
}

// The ET minute an early-close day shuts, or null if not an early-close day.
export function earlyCloseMinuteET(date) {
  return EARLY_CLOSES.has(date) ? EARLY_CLOSE_MIN : null;
}

// True when the market is closed for a HOLIDAY reason at the given ET minute:
// a full-closure day (any minute) or an early-close day at/after its close.
export function isHolidayClosed(date, etMinutes) {
  if (FULL_CLOSURES.has(date)) return true;
  return EARLY_CLOSES.has(date) && Number(etMinutes) >= EARLY_CLOSE_MIN;
}

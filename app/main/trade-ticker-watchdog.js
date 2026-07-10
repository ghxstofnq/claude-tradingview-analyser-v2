// #64 Decoupled trade ticker watchdog.
//
// Before: tickOpenTrades was driven exclusively by bar-close detector
// events. Detector crash → no events → no outcome detection. A 1-30s
// restart window could silently miss a TP1 hit or stop-out.
//
// Now: this watchdog runs on its own timer. If we haven't seen a bar
// event in WATCHDOG_STALE_MS, it polls the chart quote directly and
// ticks open trades against the latest OHLC. Defense in depth — when
// the detector is healthy this is a no-op (recently-seen bar resets
// the timer). When the detector is dead, the watchdog keeps trades
// tracked.

import * as data from "@tvmcp/core/data";
import { tickOpenTrades } from "./trade-ticker.js";
import { eodDue, eodFlattenNow, readLastEodDate } from "./execution/reconciler.js";
import { earlyCloseMinuteET } from "../../cli/lib/market-calendar.js";

// Regular NY cash close (ET minutes). Early-close days shut earlier — resolved
// per-date via earlyCloseMinuteET so the EOD flatten fires at the real close.
const CASH_CLOSE_MIN = 16 * 60;

// Cadence: run every 30s. Polling more often would spam CDP; less
// often and we'd miss outcomes longer than necessary.
const WATCHDOG_INTERVAL_MS = 30_000;
// Stale threshold: if no bar event in the last 90s, we're past the
// expected 60s minute boundary AND the next minute's grace — kick in.
const WATCHDOG_STALE_MS = 90_000;

let _send = null;
let _timer = null;
let _lastBarTs = 0;
// B4: the ET date of the last CONFIRMED broker-clock EOD flatten. Seeded from
// reconciliation.jsonl on start so a restart doesn't re-flatten a closed day.
let _lastEodDate = null;

export function markBarReceivedForWatchdog() {
  _lastBarTs = Date.now();
}

// The last CONFIRMED EOD-flatten ET date (null until one fires). The supervisor
// reads this to avoid cold-arming a new live session after the day is closed.
export function getLastEodDate() { return _lastEodDate; }

// Wall-clock ET now → { minutes, date }. Same Intl pattern as trade-ticker.js.
export function etNow(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(nowMs));
  const g = (t) => parts.find((p) => p.type === t)?.value || "0";
  const minutes = (Number(g("hour")) % 24) * 60 + Number(g("minute"));
  const date = `${g("year")}-${g("month")}-${g("day")}`;
  return { minutes, date };
}

// B4 driver (extracted for tests). At/after 16:00 ET, once per ET date, run the
// authoritative broker flatten. Advances the per-day latch ONLY on a CONFIRMED
// flat — an unreadable / unconfirmed result leaves it open so the next tick
// retries. Independent of bar events (fires even when the detector is dead).
export async function runEodCheck({ now = Date.now(), lastEodDate, etNowFn = etNow, flatten = eodFlattenNow, send } = {}) {
  const { minutes, date } = etNowFn(now);
  // Respect the early-close calendar: on a half-day (e.g. 2026-07-03, 13:00 ET)
  // flatten at the real close, not 16:00 — otherwise the book is already shut and
  // the flatten can't confirm, carrying the position overnight.
  const eodMinute = earlyCloseMinuteET(date) ?? CASH_CLOSE_MIN;
  if (!eodDue({ nowEtMinutes: minutes, lastEodDate, todayEt: date, eodMinute })) {
    return { ran: false, lastEodDate };
  }
  const res = await flatten({ send, now, tradingDay: date });
  return {
    ran: true,
    confirmedFlat: res?.confirmedFlat === true,
    lastEodDate: res?.confirmedFlat === true ? date : lastEodDate,
    result: res,
  };
}

export function startTradeTickerWatchdog({ send }) {
  _send = send;
  if (_timer) clearInterval(_timer);
  // Seed the EOD latch from disk (best-effort; a restart mid-day must not
  // re-flatten a day already closed, and an unconfirmed prior result stays open).
  readLastEodDate({ send }).then((d) => { _lastEodDate = d ?? null; }).catch(() => {});
  _timer = setInterval(tick, WATCHDOG_INTERVAL_MS);
}

export function stopTradeTickerWatchdog() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function tick() {
  // ── B4: broker-clock EOD flatten — runs INDEPENDENT of bar events (the timer
  // fires even when the bar detector is dead). The authoritative broker flatten
  // closes the NET position (manual AND auto) at 16:00 ET cash close.
  try {
    const out = await runEodCheck({ lastEodDate: _lastEodDate, send: _send });
    if (out.ran && out.confirmedFlat) _lastEodDate = out.lastEodDate;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[trade-watchdog] eod check failed", err?.message || err);
  }

  // Skip the quote-poll if detector is healthy (recent bar event).
  if (Date.now() - _lastBarTs < WATCHDOG_STALE_MS) return;

  // Poll the chart's current quote — fast CDP call (~50ms). Synthesize
  // a bar event and feed it through trade-ticker's tickOpenTrades.
  // That path now owns the dedup logic — overlapping detector recovery
  // and watchdog polls can't double-write the same TP1_HIT.
  let quote;
  try {
    quote = await data.getQuote();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[trade-watchdog] quote failed", err?.message || err);
    return;
  }
  if (!quote?.ohlc) return;
  const ev = { ohlc: quote.ohlc, ts: new Date().toISOString() };
  try {
    await tickOpenTrades(ev, { source: "watchdog" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[trade-watchdog] tick failed", err?.message || err);
  }
}

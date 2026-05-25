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

// Cadence: run every 30s. Polling more often would spam CDP; less
// often and we'd miss outcomes longer than necessary.
const WATCHDOG_INTERVAL_MS = 30_000;
// Stale threshold: if no bar event in the last 90s, we're past the
// expected 60s minute boundary AND the next minute's grace — kick in.
const WATCHDOG_STALE_MS = 90_000;

let _send = null;
let _timer = null;
let _lastBarTs = 0;

export function markBarReceivedForWatchdog() {
  _lastBarTs = Date.now();
}

export function startTradeTickerWatchdog({ send }) {
  _send = send;
  if (_timer) clearInterval(_timer);
  _timer = setInterval(tick, WATCHDOG_INTERVAL_MS);
}

export function stopTradeTickerWatchdog() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function tick() {
  // Skip if detector is healthy (recent bar event).
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

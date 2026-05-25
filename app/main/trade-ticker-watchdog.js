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

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as data from "@tvmcp/core/data";
import { activeSessionDir } from "./sessions.js";
import { tickTrades, foldOpenTrades } from "../../cli/lib/trade-outcomes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

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

  // Need open trades to bother polling — if none, nothing to tick.
  let open = [];
  let tradesFile;
  try {
    const dir = await activeSessionDir();
    tradesFile = path.join(dir, "trades.jsonl");
    const txt = await fs.readFile(tradesFile, "utf8");
    const events = txt.trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    open = foldOpenTrades(events);
  } catch { return; }
  if (open.length === 0) return;

  // Poll the chart's current quote — fast CDP call (~50ms). Use the
  // ohlc.high/low so tickTrades sees the bar's full intra-bar range.
  let quote;
  try {
    quote = await data.getQuote();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[trade-watchdog] quote failed", err?.message || err);
    return;
  }
  if (!quote?.ohlc) return;
  // eslint-disable-next-line no-console
  console.log(`[trade-watchdog] detector stale — ticking ${open.length} trade(s) from polled quote`);

  const bar = {
    open: quote.ohlc.open,
    high: quote.ohlc.high,
    low: quote.ohlc.low,
    ts: new Date().toISOString(),
  };
  const { transitions } = tickTrades(open, bar);
  for (const tr of transitions) {
    try {
      await fs.appendFile(tradesFile, JSON.stringify({ type: "outcome", source: "watchdog", ...tr }) + "\n", "utf8");
      _send?.("trade:outcome", tr);
    } catch { /* best-effort */ }
  }
  if (transitions.length > 0) {
    _send?.("app:error", {
      source: "trade-watchdog",
      level: "info",
      message: `${transitions.length} outcome event(s) fired from polled quote (detector stale)`,
    });
  }
}

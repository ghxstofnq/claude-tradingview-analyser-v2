// app/main/execution/tradovate-fills.js
// Records completed Tradovate round-trips into the fills store so REVIEW shows
// them (the trading-feed's recordRoundTrip is TV-paper-WS-only). Tradovate has
// no position WS, so this polls /positions: when an open position transitions to
// flat, it records a fill with the closing execution price + realized $.
import { appendFill } from "./fills.js";
import { TRADES_DIR } from "./config.js";
import { activeBroker, getTradovate } from "./tradovate.js";
import { readTradovatePosition } from "./tradovate-adapter.js";

const pointValue = (sym) => (/MES/.test(sym || "") ? 5 : 2);
const today = () => new Date().toISOString().slice(0, 10);

// Realized $ for a round-trip (pure). Verified against Tradovate: buy 30374.75 →
// 30374.00 × 40 MNQ ($2/pt) = -$60.
export function roundTripUsd({ side, entry, exit, qty, symbol }) {
  const dir = side === "sell" || side === "short" ? -1 : 1;
  return Math.round((Number(exit) - Number(entry)) * Number(qty) * pointValue(symbol) * dir * 100) / 100;
}

// Most recent execution price for an instrument = the closing fill on a flat.
async function lastExecutionPrice(instrument) {
  const t = getTradovate();
  if (!t.host || !t.accountId || !t.token) return null;
  try {
    const r = await fetch(`${t.host}/accounts/${t.accountId}/executions?locale=en`, { headers: { authorization: `Bearer ${t.token}` } });
    const j = await r.json();
    const list = Array.isArray(j) ? j : (j?.d || []);
    const f = list.find((x) => (x.instrument || x.symbol) === instrument);
    return f ? Number(f.price) : null;
  } catch { return null; }
}

let openTrade = null;
let timer = null, stopped = false;

async function tick() {
  if (stopped) return;
  try {
    if (activeBroker() !== "tradovate") { openTrade = null; return; }
    const pos = await readTradovatePosition();
    if (pos) {
      if (!openTrade) openTrade = { instrument: pos.symbol, side: pos.side, qty: pos.qty, entry: pos.avgFill, openedMs: Date.now() };
      else { openTrade.qty = pos.qty; if (pos.avgFill != null) openTrade.entry = pos.avgFill; }
    } else if (openTrade) {
      const exit = await lastExecutionPrice(openTrade.instrument);
      const usd = exit != null && openTrade.entry != null
        ? roundTripUsd({ side: openTrade.side, entry: openTrade.entry, exit, qty: openTrade.qty, symbol: openTrade.instrument })
        : null;
      try {
        appendFill(TRADES_DIR, today(), {
          account: "tradovate",
          symbol: openTrade.instrument, side: openTrade.side, qty: openTrade.qty,
          planned: { entry: openTrade.entry, stop: null, tp: null },
          actual: { entry: openTrade.entry, exit, usd, r: null, heldMs: Date.now() - openTrade.openedMs },
        });
      } catch { /* fill record best-effort */ }
      openTrade = null;
    }
  } catch { /* poll best-effort */ }
}

export function startTradovateFillPoller({ intervalMs = 4000 } = {}) {
  stopped = false;
  if (timer) return;
  timer = setInterval(tick, intervalMs);
}
export function stopTradovateFillPoller() { stopped = true; if (timer) { clearInterval(timer); timer = null; } }
export function __resetTradovateFills() { openTrade = null; }

// app/main/execution/tradovate-fills.js
// Records completed Tradovate round-trips into the fills store so REVIEW shows
// them (the trading-feed's recordRoundTrip is TV-paper-WS-only). Tradovate has
// no position WS, so this polls /positions to DETECT an open→flat transition,
// then reconstructs the just-closed round-trip from /executions — sign-correct
// and side-correct from the actual fills (no position-poll race).
import { appendFill } from "./fills.js";
import { TRADES_DIR } from "./config.js";
import { activeBroker, getTradovate } from "./tradovate.js";
import { readTradovatePosition } from "./tradovate-adapter.js";

const pointValue = (sym) => (/MES/.test(sym || "") ? 5 : 2);
const today = () => new Date().toISOString().slice(0, 10);

// Reconstruct the most-recently-closed round-trip for `instrument` from the
// executions list (newest-first; each {instrument,price,qty,side,time}). Walks
// newest→oldest accumulating signed qty until the net returns to zero — those
// fills are the round-trip. Realized $ = (sell notional − buy notional) × point
// value (Tradovate-exact, sign-correct). Pure. Returns
//   { side, qty, entry, exit, usd, openMs, closeMs } | null
export function reconstructLastRoundTrip(executions, instrument, pv) {
  const fills = (executions || []).filter((f) => (f.instrument || f.symbol) === instrument);
  if (!fills.length) return null;
  let net = 0; const window = [];
  for (const f of fills) {
    net += (f.side === "buy" ? 1 : -1) * Number(f.qty);
    window.push(f);
    if (net === 0) break;
  }
  if (net !== 0 || !window.length) return null; // no closed round-trip boundary
  const opener = window[window.length - 1], closer = window[0];
  const side = opener.side;
  let buyN = 0, sellN = 0, openN = 0, openQ = 0, closeN = 0, closeQ = 0;
  for (const f of window) {
    const q = Number(f.qty), p = Number(f.price);
    if (f.side === "buy") buyN += q * p; else sellN += q * p;
    if (f.side === side) { openN += q * p; openQ += q; } else { closeN += q * p; closeQ += q; }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    side, qty: openQ,
    entry: openQ ? r2(openN / openQ) : Number(opener.price),
    exit: closeQ ? r2(closeN / closeQ) : Number(closer.price),
    usd: r2((sellN - buyN) * pv),
    openMs: opener.time ? opener.time * 1000 : null,
    closeMs: closer.time ? closer.time * 1000 : null,
  };
}

async function fetchExecutions() {
  const t = getTradovate();
  if (!t.host || !t.accountId || !t.token) return [];
  try {
    const r = await fetch(`${t.host}/accounts/${t.accountId}/executions?locale=en`, { headers: { authorization: `Bearer ${t.token}` } });
    const j = await r.json();
    return Array.isArray(j) ? j : (j?.d || []);
  } catch { return []; }
}

let openTrade = null;
let timer = null, stopped = false;

async function tick() {
  if (stopped) return;
  try {
    if (activeBroker() !== "tradovate") { openTrade = null; return; }
    const pos = await readTradovatePosition();
    if (pos) {
      if (!openTrade) openTrade = { instrument: pos.symbol, openedMs: Date.now() };
    } else if (openTrade) {
      const rt = reconstructLastRoundTrip(await fetchExecutions(), openTrade.instrument, pointValue(openTrade.instrument));
      if (rt) {
        try {
          appendFill(TRADES_DIR, today(), {
            account: "tradovate",
            symbol: openTrade.instrument, side: rt.side, qty: rt.qty,
            planned: { entry: rt.entry, stop: null, tp: null },
            actual: { entry: rt.entry, exit: rt.exit, usd: rt.usd, r: null, heldMs: rt.openMs && rt.closeMs ? rt.closeMs - rt.openMs : Date.now() - openTrade.openedMs },
          });
        } catch { /* fill record best-effort */ }
      }
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

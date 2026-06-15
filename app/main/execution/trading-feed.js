// app/main/execution/trading-feed.js
// Persistent, read-only listener on TradingView's trading WebSocket (via CDP
// Network on the 9223 webview). Paper mode exposes no REST reads and the DOM
// tables go stale when the panel is collapsed, so this is the source of truth
// for the LIVE position (IN-TRADE panel) + FILLS (REVIEW). Frame protocol
// (channel:"trading", text.content.{m,p}) discovered in the M0 spike:
//   position_update  → live position (side:"empty"/qty:0 = flat)
//   execution_update → real fill price
//   account_change_update → realized $ on close (after - before)
//   balance_update / journal_update → balance / human log
import http from "node:http";
import WebSocket from "ws";
import { rememberAccountId, TRADES_DIR } from "./config.js";
import { appendFill } from "./fills.js";

const PORT = 9223;
const RECONNECT_MS = 4000;

const state = { connected: false, position: null, balance: null, accountId: null, lastFillTs: null };
let openTrade = null;     // { symbol, side, qty, entry, sl, tp, openedMs }
let lastExecPrice = null; // most recent execution price (the exit, at close time)
let lastRealizedUsd = null;
const workingOrders = new Map(); // id → { id, type, side, price, symbol } (status:working)
let sock = null, reconnectTimer = null, stopped = false;

export function getTradingState() {
  return {
    connected: state.connected, position: state.position, balance: state.balance,
    accountId: state.accountId, workingOrders: [...workingOrders.values()],
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const pointValue = (sym) => (/MES/.test(sym || "") ? 5 : 2);

function recordRoundTrip() {
  if (!openTrade) return;
  const stopDist = Math.abs((openTrade.entry ?? 0) - (openTrade.sl ?? 0));
  const riskPerC = stopDist * pointValue(openTrade.symbol);
  const usd = lastRealizedUsd;
  const r = (riskPerC > 0 && usd != null && openTrade.qty > 0)
    ? Math.round((usd / (riskPerC * openTrade.qty)) * 100) / 100 : null;
  try {
    appendFill(TRADES_DIR, today(), {
      account: "paper",
      symbol: openTrade.symbol,
      side: openTrade.side,
      qty: openTrade.qty,
      planned: { entry: openTrade.entry, stop: openTrade.sl, tp: openTrade.tp },
      actual: { entry: openTrade.entry, exit: lastExecPrice, usd, r, heldMs: Date.now() - openTrade.openedMs },
    });
  } catch { /* fill record is best-effort */ }
  openTrade = null; lastExecPrice = null; lastRealizedUsd = null;
}

function handleContent(c) {
  if (!c || !c.m) return;
  const p = c.p || {};
  if (c.accountId) { state.accountId = String(c.accountId); rememberAccountId(c.accountId); }
  switch (c.m) {
    case "position_update":
      if (p.side === "empty" || p.qty === 0) {
        if (state.position || openTrade) recordRoundTrip();
        state.position = null;
      } else {
        state.position = { symbol: p.symbol, side: p.side, qty: p.qty, avgFill: p.avg_price, sl: p.sl, tp: p.tp };
        if (!openTrade) openTrade = { symbol: p.symbol, side: p.side, qty: p.qty, entry: p.avg_price, sl: p.sl, tp: p.tp, openedMs: Date.now() };
        else {
          if (p.sl != null) openTrade.sl = p.sl;
          if (p.tp != null) openTrade.tp = p.tp;
          // Scale-in (qty grew): the cost basis moved — re-anchor entry + qty
          // to the averaged values so the round-trip R is computed correctly.
          if (p.qty != null && openTrade.qty != null && p.qty > openTrade.qty) {
            if (p.avg_price != null) openTrade.entry = p.avg_price;
            openTrade.qty = p.qty;
          }
        }
      }
      break;
    case "balance_update": state.balance = p.balance; break;
    case "execution_update": if (p.price != null) { lastExecPrice = p.price; state.lastFillTs = Date.now(); } break;
    case "account_change_update": if (p.after != null && p.before != null) lastRealizedUsd = Math.round((p.after - p.before) * 100) / 100; break;
    case "order_update":
      // Track working orders so CANCEL can find them by id; drop on any
      // terminal status (filled / cancelled / inactive / rejected).
      if (p.id != null) {
        if (p.status === "working" || p.status === "pending") {
          workingOrders.set(p.id, { id: p.id, type: p.type, side: p.side, price: p.price, symbol: p.symbol });
        } else { workingOrders.delete(p.id); }
      }
      break;
    default: break;
  }
}

function onMessage(raw) {
  let o; try { o = JSON.parse(raw); } catch { return; }
  if (o.method !== "Network.webSocketFrameReceived") return;
  const payload = o.params?.response?.payloadData || "";
  if (!payload.includes('"trading"') && !payload.includes("_update")) return;
  let j; try { j = JSON.parse(payload); } catch { return; }
  if (j.channel === "trading" || j.text?.content?.m) handleContent(j.text?.content || j);
}

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}/json`, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function connect() {
  if (stopped) return;
  try {
    const ts = await listTargets();
    const t = ts.find((x) => x.type === "webview" && /tradingview\.com/.test(x.url || ""));
    if (!t) throw new Error("no webview target");
    sock = new WebSocket(t.webSocketDebuggerUrl);
    sock.on("open", () => { state.connected = true; sock.send(JSON.stringify({ id: 1, method: "Network.enable" })); });
    sock.on("message", onMessage);
    sock.on("close", () => { state.connected = false; scheduleReconnect(); });
    sock.on("error", () => { try { sock.close(); } catch { /* noop */ } });
  } catch { scheduleReconnect(); }
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, RECONNECT_MS);
}

export function startTradingFeed() { stopped = false; connect(); }
export function stopTradingFeed() { stopped = true; try { sock?.close(); } catch { /* noop */ } if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } }

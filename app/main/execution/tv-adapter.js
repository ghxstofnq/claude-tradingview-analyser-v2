// app/main/execution/tv-adapter.js
// Execution adapter against the in-app TradingView webview, paper-first.
// Placement uses the REST endpoint discovered in the M0 spike:
//   POST https://papertrading.tradingview.com/trading/place/<accountId>
//     body (JSON string, content-type application/x-www-form-urlencoded —
//     a CORS-simple type, NO preflight; application/json would be rejected):
//     {symbol,type,qty,side,sl,tp,outside_rth:false,outside_rth_tp:false}
//   POST .../trading/close_position/<accountId>  body {symbol}
// The fetch runs IN the webview page context (via CDP evaluate) so the
// TradingView session cookies ride along. Acks arrive over the trading WS.
import { evaluate } from "./cdp-webview.js";
import { rememberAccountId, readExecConfig } from "./config.js";
import { getActiveAccount } from "./active-account.js";
import { resolveAccountGate, targetFor } from "./account-gate.js";

const SYMBOL_MAP = { "MNQ1!": "CME_MINI:MNQ1!", "MES1!": "CME_MINI:MES1!" };

// Resolve the broker target (host + accountId) for the CONFIRMED active account.
// Throws a structured block when the active account isn't the confirmed one, or
// when a live account is confirmed but liveHost isn't configured (the discovery
// spike). This is THE routing gate — every order resolves its target here.
function resolveTarget() {
  const cfg = readExecConfig();
  const gate = resolveAccountGate({ active: getActiveAccount(), confirmed: cfg.confirmedAccount });
  if (!gate.route) { const e = new Error(gate.reason || "account_not_confirmed"); e.blocked = gate; throw e; }
  const t = targetFor(cfg.confirmedAccount, cfg);
  if (!t || !t.host) { const e = new Error("live_endpoint_not_configured"); e.blocked = { route: false, reason: "live_endpoint_not_configured" }; throw e; }
  return t;
}
const tvSymbol = (s) => SYMBOL_MAP[s] || s;
const tvSide = (side) => (side === "long" || side === "buy" ? "buy" : "sell");

export async function brokerConnected() {
  try {
    return await evaluate(`(() => {
      const am = document.querySelector('[class*="accountManager-"], .js-account-manager-header');
      const order = document.querySelector('[data-name="buy-order-button"], [data-name="sell-order-button"]');
      return !!(am && order);
    })()`);
  } catch { return false; }
}

// Read connection + open position from the account-manager DOM. The bottom
// panel only LIVE-updates when expanded (collapsed = stale), so a robust
// live position read needs the panel open or the WS tracker (M4); when the
// panel is open this returns the structured position. Columns (TV order):
// Symbol, Side, Qty, AvgFill, TakeProfit, StopLoss, Last, uPnL, uPnL%, ...
export async function readState() {
  try {
    const snap = await evaluate(`(() => {
      const am = document.querySelector('[class*="accountManager-"], .js-account-manager-header');
      const order = document.querySelector('[data-name="buy-order-button"], [data-name="sell-order-button"]');
      const connected = !!(am && order);
      const nameEl = document.querySelector('[class*="accountName-"]');
      const account = nameEl ? (nameEl.textContent || "").trim().slice(0, 40) : null;
      // Live mid-price from the buy/sell order buttons (update continuously,
      // even when the panel is collapsed) — feeds the IN-TRADE P&L grid.
      const btnNum = (sel) => { const m = ((document.querySelector(sel)||{}).textContent||"").match(/[\\d,]+\\.?\\d*/); return m ? Number(m[0].replace(/,/g,"")) : null; };
      const ask = btnNum('[data-name="buy-order-button"]'), bid = btnNum('[data-name="sell-order-button"]');
      const price = (ask != null && bid != null) ? (ask + bid) / 2 : (ask ?? bid ?? null);
      const tbl = document.querySelector('[data-name="Paper.positions-table"]');
      const rows = tbl ? [...tbl.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td,th')].map(c => (c.innerText||'').trim())) : [];
      const dataRows = rows.filter(c => c.length > 6 && /CME|MNQ|MES|:/.test(c[0] || ""));
      const c = dataRows[0];
      const num = (s) => { const n = Number(String(s || "").replace(/[, ]/g, "").replace(/[^0-9.+-]/g, "")); return Number.isFinite(n) ? n : null; };
      const position = c ? {
        symbol: c[0], side: (c[1] || "").toLowerCase(), qty: num(c[2]),
        avgFill: num(c[3]), tp: num(c[4]), sl: num(c[5]), last: num(c[6]), uPnlUsd: num(c[7]),
      } : null;
      return { connected, account, position, positionCount: dataRows.length, price };
    })()`);
    return {
      connected: !!snap?.connected,
      account: snap?.account ?? null,
      position: snap?.position ?? null,
      positionCount: snap?.positionCount ?? 0,
      price: snap?.price ?? null,
      workingOrders: [],
      balance: null,
    };
  } catch {
    return { connected: false, account: null, position: null, positionCount: 0, price: null, workingOrders: [], balance: null };
  }
}

// POST a trading action from the page context (cookies ride along). Returns
// { status, ok, body }. Throws if the webview/account isn't available.
async function postTrading(host, pathPart, payload) {
  const url = host + pathPart;
  const body = JSON.stringify(payload);
  const expr = `(async () => {
    try {
      const r = await fetch(${JSON.stringify(url)}, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: ${JSON.stringify(body)},
        credentials: "include",
      });
      return { status: r.status, ok: r.ok, body: (await r.text()).slice(0, 800) };
    } catch (e) { return { status: 0, ok: false, body: "fetch failed: " + String(e) }; }
  })()`;
  return evaluate(expr);
}

// Place entry + OCO SL/TP bracket. order: {symbol, side, type, contracts, entry, stop, tp}.
export async function placeOrder(order = {}) {
  const t = resolveTarget();
  const type = order.type === "limit" ? "limit" : "market";
  const payload = {
    symbol: tvSymbol(order.symbol),
    type,
    qty: order.contracts ?? order.qty ?? 1,
    side: tvSide(order.side),
    sl: order.stop ?? order.sl,
    tp: order.tp ?? order.tp1,
    outside_rth: false,
    outside_rth_tp: false,
  };
  // TradingView limit/stop orders take `price` (NOT limitPrice).
  if (type === "limit" && (order.entry != null || order.limitPrice != null)) {
    payload.price = order.limitPrice ?? order.entry;
  }
  const res = await postTrading(t.host, `/trading/place/${t.accountId}`, payload);
  return { ...res, sent: payload, accountId: t.accountId };
}

// Place a STANDALONE order (no bracket): market entry, or a per-tranche resting
// stop/limit. M0 spike (2026-06-15): multiple standalone stop/limit orders rest
// concurrently on a netted position, each reducing it when filled — this is how
// independent tranches are recreated on a netting account. order:
// {symbol, type:"market"|"stop"|"limit", side, contracts, price?}.
export async function placeStandalone(order = {}) {
  const t = resolveTarget();
  const payload = {
    symbol: tvSymbol(order.symbol),
    type: order.type === "stop" || order.type === "limit" ? order.type : "market",
    qty: order.contracts ?? order.qty ?? 1,
    side: tvSide(order.side),
    outside_rth: false,
  };
  if (payload.type !== "market" && order.price != null) payload.price = order.price;
  const res = await postTrading(t.host, `/trading/place/${t.accountId}`, payload);
  return { ...res, sent: payload, accountId: t.accountId };
}

// Modify the open position's bracket (move SL / TP). M0 spike: POST
// /trading/modify_position/<acct> {symbol, sl, tp} → 200 (new sl/tp ids).
export async function modifyPosition({ symbol, sl, tp } = {}) {
  const t = resolveTarget();
  const res = await postTrading(t.host, `/trading/modify_position/${t.accountId}`, { symbol: tvSymbol(symbol), sl, tp });
  return { ...res, accountId: t.accountId };
}

// Cancel a working order by id. M0 spike: POST /trading/cancel/<acct>
// {id:<NUMBER>} → 200 (id must be numeric, not a string).
export async function cancelOrder({ id } = {}) {
  const t = resolveTarget();
  const res = await postTrading(t.host, `/trading/cancel/${t.accountId}`, { id: Number(id) });
  return { ...res, accountId: t.accountId };
}

// Close the open position for the order's symbol (market). flatten == close.
export async function flatten(order = {}) {
  const t = resolveTarget();
  const symbol = tvSymbol(order.symbol);
  const res = await postTrading(t.host, `/trading/close_position/${t.accountId}`, { symbol });
  return { ...res, accountId: t.accountId };
}

// PANIC: close the symbol's position now. Full close-all (every symbol) +
// cancel-all is M5; for the thin slice this flattens the active position.
export async function panic(order = {}) { return flatten(order); }

// NOTE: the old averaging `addToPosition` (a bare same-side order that merged
// into one netted bracket) is retired. Scale-in adds now open as independent
// tranches with their OWN stop/target via `placeStandalone` (see tranche-exec
// + tranche-manager) — the netting workaround proven by the M0 spike.

export { rememberAccountId };
export const tvAdapter = { brokerConnected, readState, placeOrder, placeStandalone, flatten, panic, modifyPosition, cancelOrder };

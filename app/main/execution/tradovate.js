// app/main/execution/tradovate.js
// Tradovate broker integration — pure helpers + an in-memory token store.
// TradingView talks to Tradovate via its REST API (tradovateapi.com) with a
// Bearer token (not the cookie the TV paper API uses). We sniff the token +
// account id + host off the webview's OWN requests (trading-feed's CDP Network
// listener), then use them to read/route Tradovate. Demo today (tv-demo host).

const TRADOVATE_RE = /tradovateapi\.com/i;
const ACCOUNT_RE = /\/accounts\/([^/?]+)/;

// Parse a captured request → { host, accountId, token } or null if not Tradovate.
export function parseTradovateRequest(url, headers = {}) {
  if (!url || !TRADOVATE_RE.test(url)) return null;
  let host = null;
  try { host = new URL(url).origin; } catch { return null; }
  const acct = ACCOUNT_RE.exec(url);
  const accountId = acct ? acct[1] : null;
  const authKey = Object.keys(headers || {}).find((k) => k.toLowerCase() === "authorization");
  const auth = authKey ? String(headers[authKey]) : null;
  const token = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : null;
  return { host, accountId, token };
}

// Active broker: Tradovate polls its API every few seconds while it's the active
// account, so recent tradovate traffic ⇒ Tradovate active, else paper.
export function deriveActiveBroker({ tradovateLastSeenMs = null, now = Date.now(), thresholdMs = 12_000 } = {}) {
  if (tradovateLastSeenMs != null && now - tradovateLastSeenMs < thresholdMs) return "tradovate";
  return "paper";
}

// Pull the active Tradovate contract symbol from a /quotes?symbols=… request.
// TradingView quotes the contract the account is on (e.g. MESU6); that's the
// `instrument` an order POST needs — NOT the chart's "CME_MINI:MES1!".
function parseInstrument(url) {
  try {
    const sym = new URL(url).searchParams.get("symbols");
    if (!sym) return null;
    const first = sym.split(",")[0].trim();
    return first || null;
  } catch { return null; }
}

// Resolve the Tradovate contract for the CHART symbol. store.instrument is the
// LAST-quoted symbol sniffed from REST traffic — and the system quotes BOTH the
// pair's symbols (MNQ + MES), so it goes stale on the wrong product (orders
// opened on MES while the chart was MNQ). Keep the sniffed contract's MONTH
// (live, correct roll) but force the chart's ROOT, so the order always matches
// the chart. MNQ/MES are continuous front-month micros on the same roll → the
// month code is shared → a root swap is exact. Outside that known pair → null,
// and the caller blocks rather than guess.
export function tvRootOf(sym) {
  const m = String(sym || "").toUpperCase().match(/(MNQ|MES)/);
  return m ? m[1] : null;
}
export function instrumentForChart(chartSymbol, sniffed) {
  const chartRoot = tvRootOf(chartSymbol);
  const sniffedRoot = tvRootOf(sniffed);
  if (!chartRoot || !sniffedRoot) return null;
  if (sniffedRoot === chartRoot) return String(sniffed);   // sniff already correct
  const u = String(sniffed).toUpperCase();
  const month = u.slice(u.indexOf(sniffedRoot) + sniffedRoot.length);  // e.g. "U6"
  return month ? chartRoot + month : null;                 // root swap, same month
}

// In-memory store of the latest sniffed Tradovate values.
const store = { token: null, accountId: null, host: null, instrument: null, lastSeenMs: null };

export function noteTradovateRequest(url, headers) {
  const p = parseTradovateRequest(url, headers);
  if (!p) return false;
  if (p.accountId) store.accountId = p.accountId;
  if (p.host) store.host = p.host;
  if (p.token) store.token = p.token;
  const instr = parseInstrument(url);
  if (instr) store.instrument = instr;
  store.lastSeenMs = Date.now();
  return true;
}

// Build the form-urlencoded order body Tradovate expects (confirmed by live
// capture 2026-06-16). The SL/TP bracket rides in the entry POST as absolute
// price levels; one order, auto-bracketed (no orphan-order problem).
export function buildTradovateOrderBody({ instrument, qty, side, type = "market", currentAsk, currentBid, stopLoss, takeProfit, limitPrice, stopPrice, durationType = "Day" } = {}) {
  const p = new URLSearchParams();
  p.set("instrument", String(instrument));
  p.set("qty", String(qty));
  p.set("side", side === "sell" || side === "short" ? "sell" : "buy");
  p.set("type", type);
  p.set("durationType", durationType);
  if (currentAsk != null) p.set("currentAsk", String(currentAsk));
  if (currentBid != null) p.set("currentBid", String(currentBid));
  if (type === "limit" && limitPrice != null) p.set("limitPrice", String(limitPrice));
  if ((type === "stop" || type === "stoplimit") && stopPrice != null) p.set("stopPrice", String(stopPrice));
  if (stopLoss != null) p.set("stopLoss", String(stopLoss));
  if (takeProfit != null) p.set("takeProfit", String(takeProfit));
  return p.toString();
}

// Build the form body for a Tradovate order MODIFY (PUT /accounts/<id>/orders/
// <orderId>) — confirmed by live capture 2026-06-18: moving a stop sends
// currentAsk, currentBid, durationType, id, instrument, qty, stopPrice. Used by
// BE/TRAIL to reprice the protective stop in place (no re-bracket, no orphan).
export function buildTradovateModifyBody({ orderId, instrument, qty, stopPrice, currentAsk, currentBid, durationType = "Day" } = {}) {
  const p = new URLSearchParams();
  if (currentAsk != null) p.set("currentAsk", String(currentAsk));
  if (currentBid != null) p.set("currentBid", String(currentBid));
  p.set("durationType", durationType);
  p.set("id", String(orderId));
  if (instrument != null) p.set("instrument", String(instrument));
  if (qty != null) p.set("qty", String(qty));
  p.set("stopPrice", String(stopPrice));
  return p.toString();
}

export function getTradovate() { return { ...store }; }
export function activeBroker(now = Date.now()) {
  return deriveActiveBroker({ tradovateLastSeenMs: store.lastSeenMs, now });
}

// test-only reset
export function __resetTradovate() {
  store.token = null; store.accountId = null; store.host = null; store.instrument = null; store.lastSeenMs = null;
}

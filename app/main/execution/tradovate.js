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

// In-memory store of the latest sniffed Tradovate values.
const store = { token: null, accountId: null, host: null, lastSeenMs: null };

export function noteTradovateRequest(url, headers) {
  const p = parseTradovateRequest(url, headers);
  if (!p) return false;
  if (p.accountId) store.accountId = p.accountId;
  if (p.host) store.host = p.host;
  if (p.token) store.token = p.token;
  store.lastSeenMs = Date.now();
  return true;
}

export function getTradovate() { return { ...store }; }
export function activeBroker(now = Date.now()) {
  return deriveActiveBroker({ tradovateLastSeenMs: store.lastSeenMs, now });
}

// test-only reset
export function __resetTradovate() {
  store.token = null; store.accountId = null; store.host = null; store.lastSeenMs = null;
}

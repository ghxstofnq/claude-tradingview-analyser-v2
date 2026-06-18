// app/main/execution/tradovate-adapter.js
// Order placement against Tradovate via a fetch in the webview page context —
// the sniffed Bearer token rides in the Authorization header (cookies alone
// aren't enough, unlike the TV paper API). Order format confirmed by live
// capture 2026-06-16:
//   POST {host}/accounts/{id}/orders  (form-urlencoded, Bearer)
//     instrument,qty,side,type=market,durationType=Day,currentAsk,currentBid,
//     stopLoss?,takeProfit?  → {"s":"ok","d":{"orderId":"…"}}
//   DELETE {host}/accounts/{id}/positions/{positionId} → {"s":"ok"}
import { evaluate } from "./cdp-webview.js";
import { getTradovate, buildTradovateOrderBody, instrumentForChart, tvRootOf } from "./tradovate.js";

function requireConn() {
  const t = getTradovate();
  if (!t.host || !t.accountId || !t.token) {
    const e = new Error("tradovate_not_connected");
    e.detail = { host: !!t.host, accountId: !!t.accountId, token: !!t.token };
    throw e;
  }
  return t;
}

// Place a Tradovate order (market entry, optional SL/TP bracket in the same POST).
// order: { side, type?, contracts/qty, stopLoss?, takeProfit?, currentAsk?, currentBid?, instrument? }
export async function placeTradovateOrder(order = {}) {
  const t = requireConn();
  // Derive the contract from the CHART symbol — never the raw sniffed
  // instrument, which the pair's MES quotes pollute (orders were landing on MES
  // while the chart was MNQ). Block on any root mismatch so an order can never
  // hit the wrong product.
  let instrument = order.instrument;
  if (!instrument) instrument = order.symbol ? instrumentForChart(order.symbol, t.instrument) : t.instrument;
  if (!instrument) throw new Error(`tradovate_instrument_unresolved (chart=${order.symbol ?? "?"} sniffed=${t.instrument ?? "?"})`);
  if (order.symbol && tvRootOf(instrument) !== tvRootOf(order.symbol)) {
    const e = new Error(`tradovate_symbol_mismatch: would place ${instrument} but chart is ${order.symbol}`);
    e.blocked = { route: false, reason: "symbol_mismatch" };
    throw e;
  }
  const body = buildTradovateOrderBody({
    instrument,
    qty: order.contracts ?? order.qty ?? 1,
    side: order.side,
    type: order.type === "limit" ? "limit" : "market",
    currentAsk: order.currentAsk,
    currentBid: order.currentBid,
    stopLoss: order.stopLoss ?? order.stop,
    takeProfit: order.takeProfit ?? order.tp,
    limitPrice: order.limitPrice ?? order.entry,
  });
  const url = `${t.host}/accounts/${t.accountId}/orders`;
  const expr = `(async () => {
    try {
      const r = await fetch(${JSON.stringify(url)}, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "authorization": ${JSON.stringify("Bearer " + t.token)} },
        body: ${JSON.stringify(body)},
        credentials: "include",
      });
      return { status: r.status, body: (await r.text()).slice(0, 800) };
    } catch (e) { return { status: 0, body: "fetch failed: " + String(e) }; }
  })()`;
  const res = await evaluate(expr);
  let parsed = null; try { parsed = JSON.parse(res.body); } catch { /* non-JSON */ }
  return { ...res, ok: parsed?.s === "ok", orderId: parsed?.d?.orderId ?? null, sent: { url, body }, accountId: t.accountId, instrument };
}

// Flatten: GET open positions, DELETE each that has a non-zero net. Shape-
// tolerant (positions list may be bare or under `d`).
export async function closeTradovatePosition(/* { instrument } */ arg = {}) {
  const t = requireConn();
  const base = `${t.host}/accounts/${t.accountId}`;
  const want = arg.instrument || null;
  const expr = `(async () => {
    try {
      const auth = { headers: { "authorization": ${JSON.stringify("Bearer " + t.token)} }, credentials: "include" };
      const pr = await fetch(${JSON.stringify(base + "/positions?locale=en")}, auth);
      let positions = []; try { const j = await pr.json(); positions = Array.isArray(j) ? j : (j && j.d) || []; } catch (e) {}
      const want = ${JSON.stringify(want)};
      const targets = positions.filter(p => {
        const net = Number(p.netPos ?? p.qty ?? p.netPosition ?? 0);
        const sym = String(p.instrument || p.symbol || "");
        return net !== 0 && (!want || sym === want);
      });
      const out = [];
      for (const p of targets) {
        const dr = await fetch(${JSON.stringify(base)} + "/positions/" + (p.id), { method: "DELETE", ...auth });
        out.push({ id: p.id, status: dr.status, body: (await dr.text()).slice(0,200) });
      }
      return { status: 200, closed: out.length, results: out, found: positions.length };
    } catch (e) { return { status: 0, body: "fetch failed: " + String(e) }; }
  })()`;
  const res = await evaluate(expr);
  return { ...res, ok: (res.closed ?? 0) >= 0 && res.status !== 0 };
}

// Read the open Tradovate position (for the IN-TRADE / ORDERS display + to
// enable Flatten). Node-side fetch with the sniffed Bearer token — the
// position WS/feed is TV-paper-only, so Tradovate's position comes from its
// REST API. Returns { symbol, side, qty, avgFill, uPnlUsd, broker } | null.
export async function readTradovatePosition() {
  const t = getTradovate();
  if (!t.host || !t.accountId || !t.token) return null;
  try {
    const r = await fetch(`${t.host}/accounts/${t.accountId}/positions?locale=en`, { headers: { authorization: `Bearer ${t.token}` } });
    const j = await r.json();
    const list = Array.isArray(j) ? j : (j?.d || []);
    const p = list.find((x) => Number(x.netPos ?? x.qty ?? 0) !== 0);
    if (!p) return null;
    return {
      symbol: p.instrument || p.symbol || null,
      side: p.side || (Number(p.netPos ?? p.qty) < 0 ? "sell" : "buy"),
      qty: Math.abs(Number(p.netPos ?? p.qty)),
      avgFill: p.avgPrice ?? p.avg_price ?? null,
      uPnlUsd: p.unrealizedPl ?? p.openPl ?? null,
      broker: "tradovate",
    };
  } catch { return null; }
}

// Read the working orders on the Tradovate account (the position's bracket:
// the protective stop + the take-profit limit). Node-side fetch with the
// sniffed Bearer token, mirroring readTradovatePosition. Shape-tolerant — the
// TV-proxied order objects vary. Returns [{ id, side, kind, price }] for
// working orders only (so the IN-TRADE panel can show Stop / TP1, which the
// position object alone doesn't carry).
export async function readTradovateOrders() {
  const t = getTradovate();
  if (!t.host || !t.accountId || !t.token) return [];
  try {
    const r = await fetch(`${t.host}/accounts/${t.accountId}/orders?locale=en`, { headers: { authorization: `Bearer ${t.token}` } });
    const j = await r.json();
    const list = Array.isArray(j) ? j : (j?.d || []);
    const isWorking = (o) => {
      const s = String(o.ordStatus ?? o.status ?? o.orderStatus ?? "").toLowerCase();
      return s === "" || s.includes("work") || s.includes("pend") || s.includes("accept");
    };
    const kindOf = (o) => {
      const ty = String(o.orderType ?? o.type ?? "").toLowerCase();
      if (ty.includes("stop")) return "stop";
      if (ty.includes("limit")) return "limit";
      return "other";
    };
    return list.filter(isWorking).map((o) => ({
      id: o.id ?? o.orderId ?? null,
      side: String(o.action ?? o.side ?? "").toLowerCase().includes("sell") ? "sell" : "buy",
      kind: kindOf(o),
      price: Number(o.stopPrice ?? o.price ?? o.limitPrice ?? o.triggerPrice) || null,
    })).filter((o) => o.id != null);
  } catch { return []; }
}

// Cancel every working order on the account (the CANCEL button). DELETE per
// order id — same REST family as closeTradovatePosition's position DELETE.
export async function cancelTradovateOrders() {
  const t = getTradovate();
  if (!t.host || !t.accountId || !t.token) return { ok: false, error: "tradovate_not_connected" };
  const orders = await readTradovateOrders();
  const out = [];
  for (const o of orders) {
    try {
      const r = await fetch(`${t.host}/accounts/${t.accountId}/orders/${o.id}`, { method: "DELETE", headers: { authorization: `Bearer ${t.token}` } });
      out.push({ id: o.id, status: r.status });
    } catch (e) { out.push({ id: o.id, status: 0, error: String(e?.message || e) }); }
  }
  return { ok: true, cancelled: out.length, results: out };
}

export const tradovateAdapter = { placeTradovateOrder, closeTradovatePosition, readTradovatePosition, readTradovateOrders, cancelTradovateOrders };

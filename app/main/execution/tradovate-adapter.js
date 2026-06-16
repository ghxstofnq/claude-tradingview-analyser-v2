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
import { getTradovate, buildTradovateOrderBody } from "./tradovate.js";

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
  const instrument = order.instrument || t.instrument;
  if (!instrument) throw new Error("tradovate_instrument_unknown");
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

export const tradovateAdapter = { placeTradovateOrder, closeTradovatePosition };

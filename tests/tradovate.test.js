// tests/tradovate.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseTradovateRequest, deriveActiveBroker,
  noteTradovateRequest, getTradovate, __resetTradovate,
  buildTradovateOrderBody, buildTradovateModifyBody, instrumentForChart, tvRootOf,
  tradovateOrderArgsFromPayload,
} from "../app/main/execution/tradovate.js";
import { buildOrderRequest } from "../app/renderer/src/execution/orderRequest.js";
import { pickStopOrder } from "../app/main/execution/tradovate-adapter.js";

describe("pickStopOrder — move the RIGHT tranche's stop when several adds are open", () => {
  const orders = [
    { id: 1, kind: "limit", price: 110 },
    { id: 2, kind: "stop", price: 95 },   // tranche A's stop
    { id: 3, kind: "stop", price: 99 },   // tranche B's stop
    { id: 4, kind: "limit", price: 114 },
  ];
  it("explicit orderId wins", () => {
    assert.equal(pickStopOrder(orders, { orderId: 3 }).id, 3);
  });
  it("matchStopPrice selects the stop closest to that price (tranche B at 99)", () => {
    assert.equal(pickStopOrder(orders, { matchStopPrice: 99 }).id, 3);
    assert.equal(pickStopOrder(orders, { matchStopPrice: 95 }).id, 2);
  });
  it("matchStopPrice tolerates small drift — nearest still wins", () => {
    assert.equal(pickStopOrder(orders, { matchStopPrice: 98.9 }).id, 3);
  });
  it("falls back to the first stop with no hint (manual BE/TRAIL)", () => {
    assert.equal(pickStopOrder(orders, {}).id, 2);
  });
  it("returns null when there is no stop order", () => {
    assert.equal(pickStopOrder([{ id: 1, kind: "limit", price: 110 }], { matchStopPrice: 99 }), null);
  });
});

describe("buildTradovateModifyBody — BE/TRAIL stop reprice (endpoint+body captured 2026-06-18)", () => {
  it("builds the PUT body the panel sends: id + instrument + qty + stopPrice + quote", () => {
    const b = buildTradovateModifyBody({ orderId: 544915171722, instrument: "MESU6", qty: 14, stopPrice: 7543.25, currentAsk: 7536.5, currentBid: 7536.25 });
    const p = Object.fromEntries(new URLSearchParams(b));
    assert.equal(p.id, "544915171722");
    assert.equal(p.instrument, "MESU6");
    assert.equal(p.qty, "14");
    assert.equal(p.stopPrice, "7543.25");
    assert.equal(p.durationType, "Day");
    assert.equal(p.currentAsk, "7536.5");
    assert.equal(p.currentBid, "7536.25");
  });
});

describe("instrumentForChart — orders follow the CHART symbol, never the stale sniff", () => {
  it("keeps the sniffed contract when its root already matches the chart", () => {
    assert.equal(instrumentForChart("MNQ1!", "MNQU6"), "MNQU6");
    assert.equal(instrumentForChart("CME_MINI:MES1!", "MESU6"), "MESU6");
  });
  it("swaps a stale root onto the chart root, keeping the live month (the bug)", () => {
    // chart MNQ but sniff polluted to MESU6 → place MNQU6, not MES
    assert.equal(instrumentForChart("MNQ1!", "MESU6"), "MNQU6");
    assert.equal(instrumentForChart("MES1!", "MNQZ7"), "MESZ7");
  });
  it("returns null when it can't confidently resolve (caller then blocks)", () => {
    assert.equal(instrumentForChart("MNQ1!", null), null);
    assert.equal(instrumentForChart("MNQ1!", "ESZ7"), null);   // unknown root
    assert.equal(instrumentForChart(null, "MNQU6"), null);
  });
  it("tvRootOf extracts MNQ/MES from chart + contract forms", () => {
    assert.equal(tvRootOf("CME_MINI:MNQ1!"), "MNQ");
    assert.equal(tvRootOf("MESU6"), "MES");
    assert.equal(tvRootOf("ESZ7"), null);
  });
});

function parseForm(s) { return Object.fromEntries(new URLSearchParams(s)); }

const HDRS = { Authorization: "Bearer eyJabc.def.ghi", Accept: "application/json" };

describe("parseTradovateRequest", () => {
  it("pulls host, accountId, token from a tradovate request", () => {
    const r = parseTradovateRequest("https://tv-demo.tradovateapi.com/accounts/D54476869/orders?locale=en", HDRS);
    assert.equal(r.host, "https://tv-demo.tradovateapi.com");
    assert.equal(r.accountId, "D54476869");
    assert.equal(r.token, "eyJabc.def.ghi");
  });
  it("case-insensitive Authorization header", () => {
    const r = parseTradovateRequest("https://tv-demo.tradovateapi.com/accounts/D1/state", { authorization: "Bearer tok123" });
    assert.equal(r.token, "tok123");
  });
  it("quotes endpoint (no account in path) still parses host/token", () => {
    const r = parseTradovateRequest("https://tv-demo.tradovateapi.com/quotes?accountId=D1", HDRS);
    assert.equal(r.host, "https://tv-demo.tradovateapi.com");
    assert.equal(r.accountId, null);
    assert.equal(r.token, "eyJabc.def.ghi");
  });
  it("non-tradovate url → null", () => {
    assert.equal(parseTradovateRequest("https://papertrading.tradingview.com/trading/place/9256021", HDRS), null);
  });
});

describe("deriveActiveBroker", () => {
  it("recent tradovate traffic → tradovate", () => {
    assert.equal(deriveActiveBroker({ tradovateLastSeenMs: 1000, now: 5000, thresholdMs: 12000 }), "tradovate");
  });
  it("stale tradovate traffic → paper", () => {
    assert.equal(deriveActiveBroker({ tradovateLastSeenMs: 1000, now: 30000, thresholdMs: 12000 }), "paper");
  });
  it("never seen → paper", () => {
    assert.equal(deriveActiveBroker({ tradovateLastSeenMs: null }), "paper");
  });
});

describe("token store", () => {
  beforeEach(() => __resetTradovate());
  it("notes a tradovate request and exposes the latest values", () => {
    const ok = noteTradovateRequest("https://tv-demo.tradovateapi.com/accounts/D54476869/state", HDRS);
    assert.equal(ok, true);
    const t = getTradovate();
    assert.equal(t.accountId, "D54476869");
    assert.equal(t.token, "eyJabc.def.ghi");
    assert.equal(t.host, "https://tv-demo.tradovateapi.com");
    assert.ok(t.lastSeenMs > 0);
  });
  it("ignores non-tradovate requests", () => {
    assert.equal(noteTradovateRequest("https://example.com/x", HDRS), false);
    assert.equal(getTradovate().accountId, null);
  });
  it("keeps the last good accountId when a later quotes request lacks one", () => {
    noteTradovateRequest("https://tv-demo.tradovateapi.com/accounts/D9/orders", HDRS);
    noteTradovateRequest("https://tv-demo.tradovateapi.com/quotes?symbols=MES", HDRS);
    assert.equal(getTradovate().accountId, "D9");
  });
  it("captures the active instrument from the /quotes symbols param", () => {
    noteTradovateRequest("https://tv-demo.tradovateapi.com/quotes?locale=en&symbols=MESU6&accountId=D54476869", HDRS);
    assert.equal(getTradovate().instrument, "MESU6");
    noteTradovateRequest("https://tv-demo.tradovateapi.com/quotes?symbols=MNQU6,ESU6&accountId=D1", HDRS);
    assert.equal(getTradovate().instrument, "MNQU6"); // first symbol
  });
});

describe("buildTradovateOrderBody", () => {
  it("market order with bracket (matches the captured shape)", () => {
    const body = buildTradovateOrderBody({ instrument: "MESU6", qty: 1, side: "buy", type: "market", currentAsk: 7592.25, currentBid: 7592, stopLoss: 7589.25, takeProfit: 7604 });
    const f = parseForm(body);
    assert.equal(f.instrument, "MESU6");
    assert.equal(f.qty, "1");
    assert.equal(f.side, "buy");
    assert.equal(f.type, "market");
    assert.equal(f.durationType, "Day");
    assert.equal(f.currentAsk, "7592.25");
    assert.equal(f.currentBid, "7592");
    assert.equal(f.stopLoss, "7589.25");
    assert.equal(f.takeProfit, "7604");
  });
  it("omits bracket fields when not provided", () => {
    const f = parseForm(buildTradovateOrderBody({ instrument: "MNQU6", qty: 2, side: "sell", type: "market" }));
    assert.equal(f.stopLoss, undefined);
    assert.equal(f.takeProfit, undefined);
    assert.equal(f.qty, "2");
    assert.equal(f.side, "sell");
  });
  it("limit order carries limitPrice", () => {
    const f = parseForm(buildTradovateOrderBody({ instrument: "MESU6", qty: 1, side: "buy", type: "limit", limitPrice: 7580, stopLoss: 7570 }));
    assert.equal(f.type, "limit");
    assert.equal(f.limitPrice, "7580");
    assert.equal(f.stopLoss, "7570");
  });
});

// Regression: firing an accepted setup on Tradovate must place a bracket that
// carries the stop + tp. The bug was the fire path speaking paper-only, so the
// order (and its stop) never reached Tradovate. This locks the whole data path
// from the surfaced setup → execution:place payload → Tradovate order body.
describe("tradovateOrderArgsFromPayload — accepted setup keeps its stop/tp", () => {
  const setup = { side: "sell", entry: 30402, stop: 30483.75, tp1: 30092.25 };
  const sizing = { contracts: 2, withinTolerance: true };
  const guards = { perTradeMax: 400, dailyLimit: 6000 };

  it("maps the buildOrderRequest payload to placeTradovateOrder args (stop/tp/contracts preserved)", () => {
    const req = buildOrderRequest({ setup, sizing, guards, account: "tradovate", symbol: "MNQ1!", type: "market" });
    const args = tradovateOrderArgsFromPayload(req);
    assert.equal(args.side, "sell");
    assert.equal(args.type, "market");
    assert.equal(args.contracts, 2);
    assert.equal(args.stopLoss, 30483.75);
    assert.equal(args.takeProfit, 30092.25);
    assert.equal(args.symbol, "MNQ1!");
  });

  it("the resulting Tradovate order body still includes the stop bracket", () => {
    const req = buildOrderRequest({ setup, sizing, guards, account: "tradovate", symbol: "MNQ1!", type: "market" });
    const args = tradovateOrderArgsFromPayload(req);
    const f = parseForm(buildTradovateOrderBody({ instrument: "MNQU6", qty: args.contracts, ...args }));
    assert.equal(f.stopLoss, "30483.75");
    assert.equal(f.takeProfit, "30092.25");
    assert.equal(f.side, "sell");
  });

  it("carries limitPrice for a limit fire", () => {
    const req = buildOrderRequest({ setup, sizing, guards, account: "tradovate", symbol: "MNQ1!", type: "limit" });
    const args = tradovateOrderArgsFromPayload(req);
    assert.equal(args.type, "limit");
    assert.equal(args.limitPrice, 30402);
  });
});

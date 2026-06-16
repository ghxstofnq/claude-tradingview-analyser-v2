// tests/tradovate.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseTradovateRequest, deriveActiveBroker,
  noteTradovateRequest, getTradovate, __resetTradovate,
} from "../app/main/execution/tradovate.js";

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
});

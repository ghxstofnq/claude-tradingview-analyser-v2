import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountGate, autoFireAllowed, targetFor, deriveActiveAccount } from "../app/main/execution/account-gate.js";

const paper = { id: "9256021", type: "paper", name: "InnerCircleG" };
const live = { id: "L-1", type: "live", name: "Tradovate Live" };

describe("resolveAccountGate", () => {
  it("no active account → do not route", () => {
    assert.deepEqual(resolveAccountGate({ active: null, confirmed: paper }), { route: false, needsConfirm: false, level: null, reason: "no_active_account" });
  });
  it("active matches confirmed → route", () => {
    assert.deepEqual(resolveAccountGate({ active: paper, confirmed: paper }), { route: true, needsConfirm: false, level: null, reason: null });
  });
  it("paper switch → confirm at paper level", () => {
    const g = resolveAccountGate({ active: { ...paper, id: "9256099" }, confirmed: paper });
    assert.equal(g.route, false); assert.equal(g.needsConfirm, true); assert.equal(g.level, "paper");
  });
  it("switch into live → confirm at live level", () => {
    const g = resolveAccountGate({ active: live, confirmed: paper });
    assert.equal(g.route, false); assert.equal(g.needsConfirm, true); assert.equal(g.level, "live");
  });
  it("no confirmed yet → first active needs confirm", () => {
    const g = resolveAccountGate({ active: paper, confirmed: null });
    assert.equal(g.needsConfirm, true); assert.equal(g.level, "paper");
  });
  it("same id but type flips paper→live → re-confirm at live level (no silent live route)", () => {
    // deriveActiveAccount can re-type the SAME account id paper→live once a
    // liveHost is configured. Matching on id alone would route to live without
    // a deliberate confirm — close that with a type check.
    const g = resolveAccountGate({ active: { id: "9256021", type: "live", name: "X" }, confirmed: { id: "9256021", type: "paper", name: "X" } });
    assert.equal(g.route, false);
    assert.equal(g.needsConfirm, true);
    assert.equal(g.level, "live");
  });
});

describe("autoFireAllowed (boot live-auto-pause)", () => {
  it("paper auto always allowed", () => {
    assert.equal(autoFireAllowed({ confirmed: paper, autoResumed: false }), true);
  });
  it("live auto blocked until resumed", () => {
    assert.equal(autoFireAllowed({ confirmed: live, autoResumed: false }), false);
    assert.equal(autoFireAllowed({ confirmed: live, autoResumed: true }), true);
  });
  it("no confirmed → not allowed", () => {
    assert.equal(autoFireAllowed({ confirmed: null, autoResumed: true }), false);
  });
});

describe("targetFor", () => {
  it("paper → paper host + id", () => {
    assert.deepEqual(targetFor(paper, { paperHost: "https://papertrading.tradingview.com", liveHost: null }), { host: "https://papertrading.tradingview.com", accountId: "9256021" });
  });
  it("live with liveHost → live host + id", () => {
    assert.deepEqual(targetFor(live, { paperHost: "p", liveHost: "https://live.example" }), { host: "https://live.example", accountId: "L-1" });
  });
  it("live without liveHost → null (cannot route live)", () => {
    assert.equal(targetFor(live, { paperHost: "p", liveHost: null }), null);
  });
  it("no confirmed → null", () => {
    assert.equal(targetFor(null, { paperHost: "p", liveHost: "l" }), null);
  });
});

describe("deriveActiveAccount", () => {
  it("uses feed accountId + name; type paper when no liveHost", () => {
    const a = deriveActiveAccount({ feed: { accountId: "9256021", accountName: "InnerCircleG" }, config: { paperAccountId: "9256021", liveHost: null } });
    assert.deepEqual(a, { id: "9256021", type: "paper", name: "InnerCircleG", broker: "paper" });
  });
  it("falls back to configured paper id when feed has none", () => {
    const a = deriveActiveAccount({ feed: {}, config: { paperAccountId: "9256021", liveHost: null } });
    assert.equal(a.id, "9256021"); assert.equal(a.type, "paper");
  });
  it("type live only when liveHost set AND feed marks it live", () => {
    const a = deriveActiveAccount({ feed: { accountId: "L-1", accountType: "live" }, config: { liveHost: "https://live.example" } });
    assert.equal(a.type, "live");
    const b = deriveActiveAccount({ feed: { accountId: "L-1", accountType: "live" }, config: { liveHost: null } });
    assert.equal(b.type, "paper"); // no liveHost → still paper
  });
  it("returns null when no id anywhere", () => {
    assert.equal(deriveActiveAccount({ feed: {}, config: {} }), null);
  });
  it("active Tradovate broker takes precedence (live type + broker tag)", () => {
    const a = deriveActiveAccount({
      feed: { accountId: "9256021", activeBroker: "tradovate", tradovate: { accountId: "D54476869", host: "https://tv-demo.tradovateapi.com" } },
      config: { paperAccountId: "9256021", liveHost: null },
    });
    assert.equal(a.id, "D54476869");
    assert.equal(a.type, "live");
    assert.equal(a.broker, "tradovate");
    assert.equal(a.host, "https://tv-demo.tradovateapi.com");
  });
  it("paper when tradovate idle even if last id known", () => {
    const a = deriveActiveAccount({
      feed: { accountId: "9256021", accountName: "InnerCircleG", activeBroker: "paper", tradovate: { accountId: "D54476869" } },
      config: { paperAccountId: "9256021", liveHost: null },
    });
    assert.equal(a.id, "9256021");
    assert.equal(a.broker, "paper");
  });
});

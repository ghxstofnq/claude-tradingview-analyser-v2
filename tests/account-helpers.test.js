import { test } from "node:test";
import assert from "node:assert/strict";
import { bootAccount, loadGuards, validateOrder, armReady, GUARD_DEFAULTS, realAccountView } from "../app/renderer/src/Account.helpers.js";

test("realAccountView reflects the CONFIRMED account (what orders route to)", () => {
  const v = realAccountView({ confirmed: { id: "9256021", type: "paper", name: "InnerCircleG" }, active: { id: "9256021", type: "paper" } });
  assert.equal(v.type, "paper");
  assert.equal(v.live, false);
  assert.equal(v.name, "InnerCircleG");
});

test("realAccountView prefers confirmed over active (no lying LIVE badge)", () => {
  // active flips to live but it isn't confirmed → still paper (the old legacy
  // flag claimed LIVE here; the badge must show what actually routes).
  const v = realAccountView({ confirmed: { id: "9256021", type: "paper" }, active: { id: "L-1", type: "live" } });
  assert.equal(v.type, "paper");
  assert.equal(v.live, false);
});

test("realAccountView falls back to active when nothing confirmed, then paper", () => {
  assert.equal(realAccountView({ active: { id: "L-1", type: "live", name: "Live" } }).live, true);
  assert.equal(realAccountView(null).type, "paper");
  assert.equal(realAccountView({}).live, false);
});

test("bootAccount always returns paper and clears the stale key", () => {
  const removed = [];
  const store = { getItem: () => "live", removeItem: (k) => removed.push(k), setItem: () => {} };
  assert.equal(bootAccount(store), "paper");
  assert.deepEqual(removed, ["workstation:account"]);
});

test("loadGuards falls back to defaults when unset", () => {
  const g = loadGuards({ getItem: () => null });
  assert.equal(g.perTradeMax, GUARD_DEFAULTS.perTradeMax);
  assert.equal(g.dailyLimit, 600);
  assert.equal(g.defaultRisk, 120);
});

test("loadGuards merges persisted over defaults", () => {
  const g = loadGuards({ getItem: () => JSON.stringify({ perTradeMax: 400 }) });
  assert.equal(g.perTradeMax, 400);
  assert.equal(g.dailyLimit, 600); // default preserved
});

test("armReady only when typed exactly LIVE", () => {
  assert.equal(armReady("LIVE"), true);
  assert.equal(armReady("live"), false);
  assert.equal(armReady("LIVE "), false);
  assert.equal(armReady(""), false);
});

test("validateOrder: no-stop, over-max, and ok path", () => {
  assert.equal(validateOrder({ risk: 120, stopPts: 18.5, hasStop: true, perTradeMax: 250 }).ok, true);
  assert.equal(validateOrder({ risk: 120, stopPts: 18.5, hasStop: false, perTradeMax: 250 }).reason, "no_stop");
  assert.equal(validateOrder({ risk: 400, stopPts: 18.5, hasStop: true, perTradeMax: 250 }).reason, "over_max");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { bootAccount, loadGuards, validateOrder, armReady, GUARD_DEFAULTS } from "../app/renderer/src/Account.helpers.js";

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

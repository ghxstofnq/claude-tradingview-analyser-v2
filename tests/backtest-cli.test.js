import assert from "node:assert/strict";
import test from "node:test";
import { computeVerdict } from "../cli/commands/backtest.js";

// The go-live gate is the keystone output — one rule, deterministic. Lock it.
test("computeVerdict — no corpus", () => {
  const v = computeVerdict({ cum_r: 0, sessions: 0 });
  assert.equal(v.verdict, "NO_CORPUS");
  assert.equal(v.ready, false);
});

test("computeVerdict — thin corpus is NEEDS_MORE_DATA even when positive", () => {
  const v = computeVerdict({ cum_r: 40, sessions: 5, minSessions: 20 });
  assert.equal(v.verdict, "NEEDS_MORE_DATA");
  assert.equal(v.ready, false);
});

test("computeVerdict — enough sessions but not net-positive is NOT_READY", () => {
  const v = computeVerdict({ cum_r: -4.2, sessions: 31, minSessions: 20 });
  assert.equal(v.verdict, "NOT_READY");
  assert.equal(v.ready, false);
});

test("computeVerdict — zero R over a full window is NOT_READY (net-positive is strict >0)", () => {
  const v = computeVerdict({ cum_r: 0, sessions: 31, minSessions: 20 });
  assert.equal(v.verdict, "NOT_READY");
  assert.equal(v.ready, false);
});

test("computeVerdict — net-positive over a trusted window is the only green-light", () => {
  const v = computeVerdict({ cum_r: 22.66, sessions: 31, minSessions: 20 });
  assert.equal(v.verdict, "NET_POSITIVE");
  assert.equal(v.ready, true);
});

test("computeVerdict — min floor is honored (custom min)", () => {
  const v = computeVerdict({ cum_r: 12, sessions: 10, minSessions: 10 });
  assert.equal(v.verdict, "NET_POSITIVE");
  assert.equal(v.ready, true);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePnlR, pnlTickBucket } from "../renderer/src/Live.helpers.js";

// The TopBar P&L value tick (motion v1) must pulse only on a MEANINGFUL move —
// a sign flip or a 0.5R milestone — never on every 2s poll. parsePnlR + the
// pnlTickBucket key are the pure gate that guarantees that.

test("parsePnlR reads the signed R out of a pnl cell value", () => {
  assert.equal(parsePnlR("+1.5 R"), 1.5);
  assert.equal(parsePnlR("-0.75 R"), -0.75);
  assert.equal(parsePnlR("+0 R"), 0);
});

test("parsePnlR returns null for PENDING / placeholder / non-R strings", () => {
  assert.equal(parsePnlR("PENDING"), null);
  assert.equal(parsePnlR("—"), null);
  assert.equal(parsePnlR(""), null);
  assert.equal(parsePnlR("1.5"), null); // no R unit → not a P&L reading
  assert.equal(parsePnlR(null), null);
  assert.equal(parsePnlR(undefined), null);
});

test("bucket is stable within a 0.5R band (no tick storm on small polls)", () => {
  // 0.05R → 0.10R → 0.40R are all the same band → same bucket → no tick.
  assert.equal(pnlTickBucket(0.05), pnlTickBucket(0.1));
  assert.equal(pnlTickBucket(0.1), pnlTickBucket(0.4));
});

test("bucket changes on each 0.5R milestone", () => {
  assert.notEqual(pnlTickBucket(0.4), pnlTickBucket(0.5)); // crossing +0.5R
  assert.equal(pnlTickBucket(0.5), pnlTickBucket(0.9)); // still in the +0.5R band
  assert.notEqual(pnlTickBucket(0.9), pnlTickBucket(1.0)); // crossing +1.0R
});

test("bucket changes on a sign flip (profit↔loss) and the BE crossing", () => {
  assert.notEqual(pnlTickBucket(0.3), pnlTickBucket(-0.3)); // profit → loss
  assert.notEqual(pnlTickBucket(0.1), pnlTickBucket(-0.1)); // crossing break-even
});

test("negative milestones step too", () => {
  assert.equal(pnlTickBucket(-0.1), pnlTickBucket(-0.5)); // same -0.5R band
  assert.notEqual(pnlTickBucket(-0.5), pnlTickBucket(-0.6)); // crossing -1.0R
});

test("null / NaN R collapse to a single 'na' bucket (PENDING never distinguishes)", () => {
  assert.equal(pnlTickBucket(null), "na");
  assert.equal(pnlTickBucket(undefined), "na");
  assert.equal(pnlTickBucket(NaN), "na");
});

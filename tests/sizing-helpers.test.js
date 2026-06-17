import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeOrder } from "../app/renderer/src/Sizing.helpers.js";

test("MNQ: $120 risk, 18.5pt stop → 3 micros, $111, within tol, 44% of max", () => {
  const r = sizeOrder({ riskUsd: 120, stopPts: 18.5, pointValue: 2, perTradeMax: 250 });
  assert.equal(r.contracts, 3);
  assert.equal(r.actualRisk, 111);
  assert.equal(r.withinTolerance, true);
  assert.equal(r.pctOfMax, 44);
});

test("MES: $250 risk, 10pt stop, $5/pt → picks closest within tol", () => {
  const r = sizeOrder({ riskUsd: 250, stopPts: 10, pointValue: 5, perTradeMax: 500 });
  assert.equal(r.contracts, 5); // 5 × $50 = $250 exact
  assert.equal(r.actualRisk, 250);
  assert.equal(r.withinTolerance, true);
});

test("rounds down to floor when nothing lands within ±$50", () => {
  // $300 risk, $120/contract (60pt MNQ): 2c=$240, 3c=$360 — neither within $50.
  // Round DOWN to 2c rather than skipping. Off-tolerance but valid + under cap.
  const r = sizeOrder({ riskUsd: 300, stopPts: 60, pointValue: 2, perTradeMax: 400 });
  assert.equal(r.contracts, 2);
  assert.equal(r.actualRisk, 240);
  assert.equal(r.withinTolerance, false);
  assert.equal(r.blockReason, undefined);
});

test("clamps to 1 contract when the stop is wider than the whole target", () => {
  const r = sizeOrder({ riskUsd: 20, stopPts: 100, pointValue: 2, perTradeMax: 250 }); // 1c = $200
  assert.equal(r.contracts, 1);
  assert.equal(r.actualRisk, 200);
  assert.equal(r.withinTolerance, false);
});

test("bad stop blocks", () => {
  const r = sizeOrder({ riskUsd: 120, stopPts: 0, pointValue: 2, perTradeMax: 250 });
  assert.equal(r.withinTolerance, false);
  assert.equal(r.blockReason, "bad_stop");
});

test("picks the closer of floor/ceil within tolerance", () => {
  // $100 risk, $37/contract: 2c=$74 (|−26|), 3c=$111 (|+11|) → 3c closer
  const r = sizeOrder({ riskUsd: 100, stopPts: 18.5, pointValue: 2, perTradeMax: 250 });
  assert.equal(r.contracts, 3);
  assert.equal(r.actualRisk, 111);
});

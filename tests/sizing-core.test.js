// tests/sizing-core.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sizeFromStop, pointValue, tickSize } from "../app/main/execution/sizing-core.js";

// Oracle = the ORIGINAL tranche-manager.sizePacket formula, inlined.
function oracle({ symbol, entry, stop, target }) {
  const pv = String(symbol || "").startsWith("MES") ? 5 : 2;
  const stopPts = Math.abs(Number(entry) - Number(stop));
  if (!(stopPts > 0)) return { contracts: 0, riskUsd: 0, withinTolerance: false };
  const riskPerC = stopPts * pv;
  const contracts = Math.max(1, Math.round(target / riskPerC));
  const riskUsd = Math.round(contracts * riskPerC);
  return { contracts, riskUsd, withinTolerance: Math.abs(riskUsd - target) <= 50 };
}

describe("sizing-core", () => {
  it("pointValue + tickSize", () => {
    assert.equal(pointValue("MNQ1!"), 2);
    assert.equal(pointValue("MES1!"), 5);
    assert.equal(tickSize("MNQ1!"), 0.25);
  });

  it("MNQ: 60pt stop, $120 risk → 1 contract @ $120, within tolerance", () => {
    const s = sizeFromStop({ symbol: "MNQ1!", entry: 21000, stop: 20940, riskUsd: 120 });
    assert.equal(s.contracts, 1);
    assert.equal(s.actualRiskUsd, 120);
    assert.equal(s.withinTolerance, true);
  });

  it("MNQ: tight 10pt stop, $120 risk → 6 contracts ($120)", () => {
    const s = sizeFromStop({ symbol: "MNQ1!", entry: 21000, stop: 20990, riskUsd: 120 });
    assert.equal(s.contracts, 6);
    assert.equal(s.actualRiskUsd, 120);
    assert.equal(s.withinTolerance, true);
  });

  it("MNQ: huge 500pt stop → 1 contract, $1000 risk, NOT within tolerance", () => {
    const s = sizeFromStop({ symbol: "MNQ1!", entry: 21000, stop: 20500, riskUsd: 120 });
    assert.equal(s.contracts, 1);
    assert.equal(s.actualRiskUsd, 1000);
    assert.equal(s.withinTolerance, false);
  });

  it("zero/invalid stop distance → 0c, not tradable", () => {
    const s = sizeFromStop({ symbol: "MNQ1!", entry: 21000, stop: 21000, riskUsd: 120 });
    assert.deepEqual(s, { contracts: 0, stopPts: 0, actualRiskUsd: 0, withinTolerance: false });
  });

  it("parity: matches the original sizePacket formula across a grid", () => {
    for (const symbol of ["MNQ1!", "MES1!"]) {
      for (const stopPts of [3, 7, 10, 25, 60, 120, 333, 500]) {
        for (const target of [120, 240, 60]) {
          const entry = 21000, stop = entry - stopPts;
          const got = sizeFromStop({ symbol, entry, stop, riskUsd: target });
          const exp = oracle({ symbol, entry, stop, target });
          assert.equal(got.contracts, exp.contracts, `${symbol} ${stopPts} ${target} contracts`);
          assert.equal(got.actualRiskUsd, exp.riskUsd, `${symbol} ${stopPts} ${target} risk`);
          assert.equal(got.withinTolerance, exp.withinTolerance, `${symbol} ${stopPts} ${target} tol`);
        }
      }
    }
  });
});

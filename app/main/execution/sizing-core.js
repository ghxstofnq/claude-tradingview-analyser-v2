// app/main/execution/sizing-core.js
// One source of truth for size-from-stop math, shared by the manual ORDERS
// ticket and the tranche manager. Pure, no IO. The Math.max(1) floor +
// withinTolerance (±$50, whole contract) reproduce the original
// tranche-manager.sizePacket exactly — see tests/sizing-core.test.js parity.

export function pointValue(symbol) {
  // Match MES anywhere — the analyze bundle's chart.symbol is exchange-prefixed
  // ("CME_MINI:MES1!"), so startsWith would miss it (same /MES/ test as the
  // trading feed). MES $5/pt, MNQ $2/pt.
  return /MES/.test(String(symbol || "")) ? 5 : 2;
}
export function tickSize(/* symbol */) {
  return 0.25; // MNQ / MES tick
}

export function sizeFromStop({ symbol, entry, stop, riskUsd } = {}) {
  const pv = pointValue(symbol);
  const stopPts = Math.abs(Number(entry) - Number(stop));
  const target = Number(riskUsd);
  if (!(stopPts > 0) || !(target > 0)) {
    return { contracts: 0, stopPts: 0, actualRiskUsd: 0, withinTolerance: false };
  }
  const contracts = Math.max(1, Math.round(target / (stopPts * pv)));
  const actualRiskUsd = Math.round(contracts * stopPts * pv);
  return {
    contracts,
    stopPts,
    actualRiskUsd,
    withinTolerance: contracts >= 1 && Math.abs(actualRiskUsd - target) <= 50,
  };
}

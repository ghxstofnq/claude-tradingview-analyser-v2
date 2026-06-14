// Sizing.helpers — pure deterministic $-risk → micro-contracts read-out for the
// order ticket. No LLM math (constraint #7). Mirrors cli/lib/sizing.js for the
// execution engine. Point values: MNQ $2/pt, MES $5/pt.

export function sizeOrder({ riskUsd, stopPts, pointValue, perTradeMax, tol = 50 }) {
  const perContract = stopPts * pointValue;
  if (!(perContract > 0)) {
    return { contracts: 0, actualRisk: 0, withinTolerance: false, blockReason: "bad_stop" };
  }
  const floorN = Math.floor(riskUsd / perContract);
  const candidates = [floorN, floorN + 1].filter((n) => n >= 1);
  let best = null;
  for (const n of candidates) {
    const risk = n * perContract;
    if (Math.abs(risk - riskUsd) <= tol) {
      if (!best || Math.abs(risk - riskUsd) < Math.abs(best.actualRisk - riskUsd)) {
        best = { contracts: n, actualRisk: risk };
      }
    }
  }
  if (!best) {
    return { contracts: 0, actualRisk: 0, withinTolerance: false, blockReason: "no_size_within_tolerance" };
  }
  const pctOfMax = perTradeMax > 0 ? Math.round((best.actualRisk / perTradeMax) * 100) : null;
  return { ...best, withinTolerance: true, pctOfMax };
}

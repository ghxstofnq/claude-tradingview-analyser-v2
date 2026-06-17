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
  const withinTolerance = best != null;
  if (!best) {
    // Nothing lands within ±$50 — round DOWN to the largest whole contract that
    // stays at/under target (clamp to 1 when the stop is wider than the whole
    // target). The per-trade cap is enforced by the caller, not here.
    const n = Math.max(1, floorN);
    best = { contracts: n, actualRisk: n * perContract };
  }
  const pctOfMax = perTradeMax > 0 ? Math.round((best.actualRisk / perTradeMax) * 100) : null;
  return { ...best, withinTolerance, pctOfMax };
}

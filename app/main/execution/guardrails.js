// app/main/execution/guardrails.js
// Pure pre-fire gate. Orders fire immediately on accept (no per-order
// confirm), so this is THE safety gate. Returns {ok:true} or
// {ok:false, code, message}. No I/O — caller passes sizing + day state.
export function checkOrder({ hasStop, sizing, guards, dayState } = {}) {
  const G = guards || {};
  if (!hasStop) {
    return { ok: false, code: "NO_STOP", message: "No valid stop — cannot size or bracket the order." };
  }
  // SIZE only blocks when nothing can be sized at all (contracts < 1). An
  // off-target size that rounded DOWN is allowed — the per-trade cap below is
  // the real upper bound. (Without this, setups whose stop didn't divide
  // cleanly into the target were skipped — e.g. a 105pt MNQ stop = $210/c.)
  if (!sizing || (sizing.contracts ?? 0) < 1) {
    return { ok: false, code: "SIZE", message: "No whole micro-contract size could be computed for this stop." };
  }
  // Risk field name varies by caller (manual ticket: actualRisk; sizing-core:
  // actualRiskUsd; tranche sizePacket: riskUsd) — accept any so the cap fires
  // on every path. This is the bound that makes round-down safe.
  const risk = Number(sizing.actualRisk ?? sizing.actualRiskUsd ?? sizing.riskUsd ?? 0);
  if (G.perTradeMax != null && risk > G.perTradeMax) {
    return { ok: false, code: "OVER_MAX", message: `Computed risk $${risk} exceeds the $${G.perTradeMax} per-trade ceiling.` };
  }
  if (G.dailyLimit != null && (dayState?.realizedLossUsd ?? 0) >= G.dailyLimit) {
    return { ok: false, code: "DAILY_HALT", message: `Daily loss limit $${G.dailyLimit} reached — new entries locked until next session.` };
  }
  return { ok: true };
}

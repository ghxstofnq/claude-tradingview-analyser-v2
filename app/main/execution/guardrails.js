// app/main/execution/guardrails.js
// Pure pre-fire gate. Orders fire immediately on accept (no per-order
// confirm), so this is THE safety gate. Returns {ok:true} or
// {ok:false, code, message}. No I/O — caller passes sizing + day state.
export function checkOrder({ hasStop, sizing, guards, dayState } = {}) {
  const G = guards || {};
  if (!hasStop) {
    return { ok: false, code: "NO_STOP", message: "No valid stop — cannot size or bracket the order." };
  }
  if (!sizing || sizing.withinTolerance !== true || (sizing.contracts ?? 0) < 1) {
    return { ok: false, code: "SIZE", message: "No whole micro-contract count lands within $50 of the target risk." };
  }
  if (G.perTradeMax != null && sizing.actualRisk > G.perTradeMax) {
    return { ok: false, code: "OVER_MAX", message: `Computed risk $${sizing.actualRisk} exceeds the $${G.perTradeMax} per-trade ceiling.` };
  }
  if (G.dailyLimit != null && (dayState?.realizedLossUsd ?? 0) >= G.dailyLimit) {
    return { ok: false, code: "DAILY_HALT", message: `Daily loss limit $${G.dailyLimit} reached — new entries locked until next session.` };
  }
  return { ok: true };
}

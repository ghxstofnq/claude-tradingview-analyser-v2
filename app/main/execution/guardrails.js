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
  if (G.dailyLimit != null) {
    const realized = Number(dayState?.realizedLossUsd ?? 0);
    // Already at/over the limit on realized losses alone — hard halt.
    if (realized >= G.dailyLimit) {
      return { ok: false, code: "DAILY_HALT", message: `Daily loss limit $${G.dailyLimit} reached — new entries locked until next session.` };
    }
    // Predictive gate (audit Phase 3): would THIS order's worst-case loss,
    // stacked on realized loss + current open drawdown, breach the daily limit?
    // Positive drawdown fields count directly; signed PnL aliases convert via
    // openLossFromUpnl so an open loss (negative PnL) increases the projection
    // while open profit does not shrink it.
    const openLoss = openLossFromDayState(dayState);
    const projectedDailyLoss = realized + openLoss + risk;
    if (projectedDailyLoss >= G.dailyLimit) {
      return { ok: false, code: "DAILY_HALT", message: `Order blocked — projected day loss $${projectedDailyLoss} would reach the $${G.dailyLimit} daily limit (realized $${realized} + open $${openLoss} + risk $${risk}).` };
    }
  }
  return { ok: true };
}

// Open drawdown ($, positive) from a signed unrealized PnL. Profit → 0 so it
// never shrinks the daily-loss projection; non-finite/missing → 0 (fail-safe).
// Used by the IPC pre-fire path to fill dayState.openLossUsd. (audit Phase 3)
export function openLossFromUpnl(uPnlUsd) {
  const u = Number(uPnlUsd);
  return Number.isFinite(u) ? Math.max(0, -u) : 0;
}

function positiveLossUsd(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function openLossFromDayState(dayState = {}) {
  if (dayState?.openLossUsd != null) return positiveLossUsd(dayState.openLossUsd);
  if (dayState?.openDrawdownUsd != null) return positiveLossUsd(dayState.openDrawdownUsd);
  if (dayState?.uPnlUsd != null) return openLossFromUpnl(dayState.uPnlUsd);
  if (dayState?.unrealizedPnlUsd != null) return openLossFromUpnl(dayState.unrealizedPnlUsd);
  if (dayState?.unrealizedLossUsd != null) return positiveLossUsd(dayState.unrealizedLossUsd);
  return 0;
}

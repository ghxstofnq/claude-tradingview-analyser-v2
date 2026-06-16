// Account.helpers — pure account/guardrail logic for the ACCOUNT & EXECUTION
// settings. NOTE: the source of truth for which account orders route to is now
// the MAIN-process exec config (`confirmedAccount`, persisted) + the BROKER
// ROUTING panel (active-account follow + confirm-on-switch + boot live-auto-
// pause). The renderer `account` mode below is display-only legacy and no longer
// drives routing (the adapter routes by the confirmed account, not this flag).
// `armReady` is reused for the live confirm gate; guardrails still persist here.

export const GUARD_DEFAULTS = { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 };

// Always boot to PAPER and clear any stale persisted account — arming LIVE must
// never survive a reload/restart.
export function bootAccount(store = localStorage) {
  try { store.removeItem("workstation:account"); } catch {}
  return "paper";
}

export function loadGuards(store = localStorage) {
  try {
    const v = JSON.parse(store.getItem("workstation:guards"));
    if (v && v.perTradeMax) return { ...GUARD_DEFAULTS, ...v };
  } catch {}
  return { ...GUARD_DEFAULTS };
}

export function saveGuards(g, store = localStorage) {
  try { store.setItem("workstation:guards", JSON.stringify(g)); } catch {}
}

// The LIVE arm gate only enables when the user types exactly "LIVE".
export const armReady = (typed) => typed === "LIVE";

// Pre-fire order gate (orders fire immediately on accept, so this is the gate):
// require a valid stop, then enforce the per-trade $ max.
export function validateOrder({ risk, stopPts, hasStop, perTradeMax }) {
  if (!hasStop) return { ok: false, reason: "no_stop" };
  if (risk > perTradeMax) return { ok: false, reason: "over_max" };
  return { ok: true };
}

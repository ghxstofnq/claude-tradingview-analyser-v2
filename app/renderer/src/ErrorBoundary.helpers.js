// Pure helpers for ErrorBoundary (Task C5) — extracted so the containment
// contract (which affordances each variant offers, when a boundary resets,
// when retries are exhausted) is unit-testable with `node --test`. No React,
// no side effects.

export const MAX_RETRIES = 3;

// Action affordances a boundary's fallback offers, by variant.
//   page      — a non-money panel crash: RETRY only.
//   emergency — a money-path region (LIVE / ORDERS): RETRY + OPEN SYSTEM +
//               broker-confirmed FLATTEN, so a crashed trade surface can still
//               be flattened and diagnosed without a full app restart.
export const BOUNDARY_ACTIONS = Object.freeze({
  page: Object.freeze(["retry"]),
  emergency: Object.freeze(["retry", "open_system", "flatten"]),
});

export function boundaryActions(variant) {
  return BOUNDARY_ACTIONS[variant] || BOUNDARY_ACTIONS.page;
}

export function isEmergency(variant) {
  return variant === "emergency";
}

// A boundary resets its caught error when its resetKey identity changes — this
// is how a per-page boundary clears on a page switch (key={page}).
export function shouldReset(prevKey, nextKey) {
  return prevKey !== nextKey;
}

export function retriesExhausted(retries, max = MAX_RETRIES) {
  return retries >= max;
}

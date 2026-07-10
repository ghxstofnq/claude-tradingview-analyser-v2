// app/main/execution/auto-resume.js
// In-memory per-session flag for the boot live-auto-pause. Defaults false on
// every process start, so after a restart a confirmed LIVE account's AUTO modes
// stay paused until the user taps "resume auto" once (paper auto is unaffected —
// see account-gate.autoFireAllowed). Manual entries never consult this.
let autoResumed = false;
export function getAutoResumed() { return autoResumed; }
export function setAutoResumed(v) { autoResumed = v === true; }

// Boot broker/journal reconciliation gate (Task B2). Defaults false on every
// process start, so paper AUTO is held until the boot reconciler confirms a
// HEALTHY state (journal ≡ broker). Set true only by the reconciler; ANDed into
// autoAllowed alongside the live-auto-pause. Fail-closed: only an explicit true.
let reconciliationHealthy = false;
export function getReconciliationHealthy() { return reconciliationHealthy; }
export function setReconciliationHealthy(v) { reconciliationHealthy = v === true; }

// Continuous protection-watchdog gate (Task B3). Unlike the two flags above this
// defaults TRUE: a no-position boot (the common case) must not block manual
// trading, and the reconciliation flag above already gates AUTO at boot. The
// always-on watchdog flips this false the moment it sees an unprotected /
// breached / unreadable / auth-lost position, and back true on a clear read. It
// is ANDed into autoAllowed and checked at the manual/auto entry handler layer.
// A never-STARTED watchdog leaves this true; the health staleness blocker covers
// that case. Coerces to a strict boolean so an odd value can only ever OPEN the
// gate via an explicit true (fail-closed on anything non-boolean-false).
let protectionOk = true;
export function getProtectionOk() { return protectionOk; }
export function setProtectionOk(v) { protectionOk = v !== false; }

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

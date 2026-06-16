// app/main/execution/auto-resume.js
// In-memory per-session flag for the boot live-auto-pause. Defaults false on
// every process start, so after a restart a confirmed LIVE account's AUTO modes
// stay paused until the user taps "resume auto" once (paper auto is unaffected —
// see account-gate.autoFireAllowed). Manual entries never consult this.
let autoResumed = false;
export function getAutoResumed() { return autoResumed; }
export function setAutoResumed(v) { autoResumed = v === true; }

// mode — the app's PREP / LIVE / REVIEW state, owned in one place.
//
// Before: each background task (detector, alert poller, schedulers) had its
// own ad-hoc dispatch via direct start/stop calls or a private `_mode` var.
// IPC mode:switch hardcoded the side effects. Adding a new mode-aware
// behavior meant editing the IPC handler.
//
// After: a single value with a change emitter. Background tasks subscribe.
// Adding a new mode-aware behavior is one subscriber, not one more case.

import { EventEmitter } from "node:events";

const VALID = new Set(["prep", "live", "review"]);
const DEFAULT_MODE = "prep";

let _mode = DEFAULT_MODE;
const _emitter = new EventEmitter();
// Bump max listeners — bar-close, alerts, future schedulers, the IPC layer.
// Default 10 is fine today but cheap insurance.
_emitter.setMaxListeners(20);

export function getMode() {
  return _mode;
}

/**
 * setMode — change the current mode. Validates the value and only emits
 * change when the mode actually moves (idempotent). Returns true if the
 * value changed, false if it was already at `next`.
 */
export function setMode(next) {
  if (!VALID.has(next)) {
    throw new Error(`invalid mode: ${next} (expected ${[...VALID].join(" | ")})`);
  }
  if (next === _mode) return false;
  const prev = _mode;
  _mode = next;
  _emitter.emit("change", { mode: next, prev });
  return true;
}

/**
 * onModeChange — subscribe to mode changes. Returns an unsubscribe fn so
 * callers can clean up listeners predictably.
 */
export function onModeChange(cb) {
  _emitter.on("change", cb);
  return () => _emitter.off("change", cb);
}

export function isLive() { return _mode === "live"; }
export function isPrep() { return _mode === "prep"; }
export function isReview() { return _mode === "review"; }

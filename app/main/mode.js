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
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID = new Set(["prep", "live", "review"]);
const DEFAULT_MODE = "prep";

// #15 Persist mode to disk on every change; read on boot. Was: app
// always started in PREP. If the app crashed mid-LIVE, the trader
// came back in PREP and might not notice — no setups, no tracking.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const MODE_FILE = path.join(REPO_ROOT, "state", "last-mode.json");

let _mode = DEFAULT_MODE;
const _emitter = new EventEmitter();
// Bump max listeners — bar-close, alerts, future schedulers, the IPC layer.
// Default 10 is fine today but cheap insurance.
_emitter.setMaxListeners(20);

/**
 * loadPersistedMode — call once at boot before anything reads getMode().
 * Restores the last-saved mode from disk. Silently falls back to DEFAULT
 * if file is missing / unreadable / contains an invalid value.
 */
export async function loadPersistedMode() {
  try {
    const txt = await fs.readFile(MODE_FILE, "utf8");
    const parsed = JSON.parse(txt);
    if (VALID.has(parsed?.mode)) {
      _mode = parsed.mode;
      // eslint-disable-next-line no-console
      console.log(`[mode] restored ${_mode} from disk`);
    }
  } catch { /* first boot, or file corrupted — start in default */ }
  return _mode;
}

async function persistMode(mode) {
  try {
    await fs.mkdir(path.dirname(MODE_FILE), { recursive: true });
    await fs.writeFile(MODE_FILE, JSON.stringify({ mode, ts: new Date().toISOString() }, null, 2), "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[mode] persist failed", err?.message || err);
  }
}

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
  // Fire-and-forget persistence so we don't block the IPC ack.
  persistMode(next).catch(() => {});
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

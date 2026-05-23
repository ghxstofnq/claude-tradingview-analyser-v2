// Loop health monitor.
//
// Computes the overall "loop" state every 2s based on:
//   - the bar-close detector's heartbeat file age
//   - the lag between the last bar event and the last Claude turn complete.
//
// Pushes health:update {loop, heartbeat_age_s, ...} to the renderer.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const HEARTBEAT = path.join(REPO_ROOT, "state", "session", "detector-heartbeat.json");

let _send = null;
let _interval = null;
let _lastTurnCompleteAt = 0;
let _lastBarAt = 0;

export function startHealthMonitor(send) {
  _send = send;
  if (_interval) clearInterval(_interval);
  _interval = setInterval(tick, 2000);
  tick();
}

export function stopHealthMonitor() {
  if (_interval) clearInterval(_interval);
  _interval = null;
}

export function markBarReceived() { _lastBarAt = Date.now(); }
export function markTurnComplete() { _lastTurnCompleteAt = Date.now(); }

async function tick() {
  let hbAge = Infinity;
  try {
    const stat = await fs.stat(HEARTBEAT);
    hbAge = (Date.now() - stat.mtimeMs) / 1000;
  } catch { /* missing — leave Infinity */ }

  const turnLagSec = _lastBarAt > 0
    ? Math.max(0, (Date.now() - Math.max(_lastTurnCompleteAt, _lastBarAt)) / 1000)
    : 0;

  let state = "healthy";
  if (hbAge > 90 || hbAge === Infinity) state = "down";
  else if (hbAge > 30 || turnLagSec > 90) state = "stale";

  _send?.("health:update", {
    loop: state,
    heartbeat_age_s: hbAge === Infinity ? null : Math.round(hbAge),
    turn_lag_s: Math.round(turnLagSec),
  });
}

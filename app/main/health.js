// Loop health monitor.
//
// Computes the overall "loop" state every 2s based on:
//   - the bar-close detector's heartbeat file age
//   - the lag between the last bar event and the last Claude turn complete
//   - TV Desktop CDP reachability (probed every 5th tick — the heartbeat
//     alone lies: the detector keeps heartbeating while blind when TV runs
//     without --remote-debugging-port=9225, as on 2026-07-07→09).
//
// Pushes health:update {loop, heartbeat_age_s, turn_lag_s, cdp} to the renderer.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeCdp } from "./tv-launcher.js";
import { getReconciliationHealthy, getProtectionOk } from "./execution/auto-resume.js";
import { getLastReconcileState } from "./execution/reconciler.js";
import { getLastProtectionState, getLastWatchdogTickMs, protectionReadiness, PROTECTION_INTERVAL_MS } from "./execution/protection-watchdog.js";
import { getTradingState } from "./execution/trading-feed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const HEARTBEAT = path.join(REPO_ROOT, "state", "session", "detector-heartbeat.json");

let _send = null;
let _interval = null;
let _lastTurnCompleteAt = 0;
let _lastBarAt = 0;
let _cdpUp = null; // null until the first probe resolves
let _tick = 0;
let _probing = false;
let _lastHealth = null; // last pushed health:update payload + its push time

// Snapshot of the most recent health:update payload, stamped with when it was
// pushed (as_of). The readiness collector reads this instead of subscribing —
// one shared truth, no second monitor. Null until the first tick completes.
export function getLastHealth() {
  return _lastHealth;
}

export function startHealthMonitor(send) {
  _send = send;
  if (_interval) clearInterval(_interval);
  _tick = 0;
  _interval = setInterval(tick, 2000);
  tick();
}

export function stopHealthMonitor() {
  if (_interval) clearInterval(_interval);
  _interval = null;
}

export function markBarReceived() { _lastBarAt = Date.now(); }
export function markTurnComplete() { _lastTurnCompleteAt = Date.now(); }

// Pure — exported for tests. A dead CDP backend outranks a fresh heartbeat:
// the loop is functionally down when the chart can't be read.
export function deriveLoop({ hbAge, turnLagSec, cdpUp }) {
  if (cdpUp === false) return "down";
  if (hbAge > 90 || hbAge === Infinity) return "down";
  if (hbAge > 30 || turnLagSec > 90) return "stale";
  return "healthy";
}

async function tick() {
  let hbAge = Infinity;
  try {
    const stat = await fs.stat(HEARTBEAT);
    hbAge = (Date.now() - stat.mtimeMs) / 1000;
  } catch { /* missing — leave Infinity */ }

  // CDP probe every 5th tick (10s) — plain HTTP, never a CDP driver attach.
  if (_tick % 5 === 0 && !_probing) {
    _probing = true;
    probeCdp().then((up) => { _cdpUp = up; }).catch(() => {}).finally(() => { _probing = false; });
  }
  _tick += 1;

  const turnLagSec = _lastBarAt > 0
    ? Math.max(0, (Date.now() - Math.max(_lastTurnCompleteAt, _lastBarAt)) / 1000)
    : 0;

  const payload = {
    loop: deriveLoop({ hbAge, turnLagSec, cdpUp: _cdpUp }),
    heartbeat_age_s: hbAge === Infinity ? null : Math.round(hbAge),
    turn_lag_s: Math.round(turnLagSec),
    cdp: _cdpUp === null ? "unknown" : _cdpUp ? "up" : "down",
    // Boot broker/journal reconciliation (B2): whether paper auto is gated open
    // (HEALTHY) + the last reconciler verdict, for the dashboard.
    reconciliation: { healthy: getReconciliationHealthy(), state: getLastReconcileState() },
    // Continuous protection watchdog (B3): the entry gate + last verdict, plus a
    // readiness blocker. protectionOk===false is a block; so is a watchdog that
    // has gone quiet (> 2× interval) while a position is open — a watchdog
    // failure is itself a readiness blocker (a live position left unwatched).
    protection: (() => {
      const tickMs = getLastWatchdogTickMs();
      let journalOpen = false;
      try { journalOpen = !!getTradingState().position; } catch { /* feed optional */ }
      const r = protectionReadiness({
        protectionOk: getProtectionOk(),
        state: getLastProtectionState(),
        tickAgeMs: tickMs ? Date.now() - tickMs : null,
        intervalMs: PROTECTION_INTERVAL_MS,
        journalOpen,
      });
      return { healthy: getProtectionOk(), state: getLastProtectionState(), blocked: r.blocked, blocker: r.blocker };
    })(),
  };
  _lastHealth = { ...payload, as_of: Date.now() };
  _send?.("health:update", payload);
}

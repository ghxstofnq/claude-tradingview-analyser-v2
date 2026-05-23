// Fired-alert detection.
//
// Polls `tv alert list` on a mode-aware cadence (5s LIVE, 30s PREP, off
// otherwise). Diffs each alert's status against a remembered snapshot;
// any armed → triggered transition emits an alert:fired IPC event.
//
// At app start, snapshots the current list WITHOUT firing — already-triggered
// alerts at boot are history, not new signals.

import { tvAlertList } from "./tools/tv-alerts.js";

let _send = null;
let _snapshot = null;      // Map<id, status>; null until initial snapshot
let _timer = null;
let _mode = "prep";

const CADENCE_MS = {
  live: 5_000,
  prep: 30_000,
  // review / idle / other → off
};

export function setAlertMode(mode) {
  _mode = mode;
  scheduleNext();
}

export function startAlertPolling({ send }) {
  _send = send;
  // First tick populates _snapshot without firing.
  scheduleNext();
}

export function stopAlertPolling() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _send?.("health:update", { alerts: "off" });
}

function scheduleNext() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  const ms = CADENCE_MS[_mode];
  if (!ms) {
    _send?.("health:update", { alerts: "off" });
    return;
  }
  _timer = setTimeout(tick, ms);
}

async function tick() {
  try {
    const list = await tvAlertList({});
    const items = Array.isArray(list) ? list : (list?.alerts || list?.items || []);
    if (_snapshot === null) {
      _snapshot = new Map();
      for (const a of items) _snapshot.set(a.id, a.status);
    } else {
      for (const a of items) {
        const prev = _snapshot.get(a.id);
        if (prev === "armed" && a.status === "triggered") {
          _send?.("alert:fired", {
            id: a.id,
            price: a.price,
            label: a.message || a.label,
            fired_at: new Date().toISOString(),
          });
        }
        _snapshot.set(a.id, a.status);
      }
    }
    _send?.("health:update", { alerts: "healthy" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[alerts] poll failed", err?.message || err);
    _send?.("health:update", { alerts: "down" });
  } finally {
    scheduleNext();
  }
}

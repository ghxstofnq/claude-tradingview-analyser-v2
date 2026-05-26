// Fired-alert detection.
//
// Polls `tv alert list` on a mode-aware cadence (5s LIVE, 30s PREP, off
// otherwise). Diffs each alert's status against a remembered snapshot;
// any armed → triggered transition emits an alert:fired IPC event.
//
// At app start, snapshots the current list WITHOUT firing — already-triggered
// alerts at boot are history, not new signals.

import { tvAlertList } from "./tools/tv-alerts.js";
import { getMode, onModeChange } from "./mode.js";

let _send = null;
let _snapshot = null;      // Map<id, status>; null until initial snapshot
let _timer = null;
let _unsubscribeMode = null;
// Overlap guard. A live poll fires every 5s but each `tv alert list` can
// take ~20s with a large alert list. Without this, mode changes (which call
// scheduleNext) could race with an in-flight tick and spawn a second tick
// before the first finishes. Also any external trigger (manual ipc poke,
// etc.) that calls tick() directly would compound. Cheap insurance.
let _inFlight = false;

// Normalize a single alert from `tv alert list`. TV's REST shape:
//   { alert_id, message, active: true|false, last_fired: null|<iso>,
//     condition: { series: [{type:'barset'}, {type:'value', value: <n>}] } }
// We expose: { id, status: 'armed'|'triggered'|'inactive', price, label }.
function normalizeAlert(raw) {
  const id = raw.alert_id ?? raw.id;
  const fired = raw.last_fired != null;
  const active = typeof raw.active === "boolean"
    ? raw.active
    : raw.status === "armed";
  const status = fired ? "triggered" : (active ? "armed" : "inactive");
  let price = raw.price;
  if (price == null && Array.isArray(raw.condition?.series)) {
    const v = raw.condition.series.find((s) => s && s.type === "value");
    if (v && Number.isFinite(v.value)) price = v.value;
  }
  return { id, status, price, label: raw.message || raw.label || "" };
}

const CADENCE_MS = {
  live: 5_000,
  // PREP was 30s — manually-armed alerts in TV took that long to appear
  // in the panel. 10s is enough to feel responsive during pre-session
  // planning without spamming CDP.
  prep: 10_000,
  // review / idle / other → off
};

export function startAlertPolling({ send }) {
  _send = send;
  // Subscribe to mode changes — replaces the prior setAlertMode plumbing
  // through IPC. Reschedule on every mode change so the cadence adapts.
  _unsubscribeMode = onModeChange(() => scheduleNext());
  // First tick populates _snapshot AND pushes the initial alerts:state so
  // the renderer panel reflects TV state immediately, not 30s into PREP.
  tick();
}

export function stopAlertPolling() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (_unsubscribeMode) { _unsubscribeMode(); _unsubscribeMode = null; }
  _send?.("health:update", { alerts: "off" });
}

function scheduleNext() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  const ms = CADENCE_MS[getMode()];
  if (!ms) {
    _send?.("health:update", { alerts: "off" });
    return;
  }
  _timer = setTimeout(tick, ms);
}

async function tick() {
  if (_inFlight) {
    // Previous tick still running — let it finish; its `finally` will
    // schedule the next one. Skipping silently is fine: alerts polling is
    // a heartbeat, missing one cycle doesn't lose data (the next tick
    // catches up). What we MUST avoid is overlapping tv-process queue
    // entries, which would amplify the 20s problem indefinitely.
    return;
  }
  _inFlight = true;
  try {
    const list = await tvAlertList({});
    const raw = Array.isArray(list) ? list : (list?.alerts || list?.items || []);
    const items = raw.map(normalizeAlert).filter((a) => a.id != null);
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
            label: a.label,
            fired_at: new Date().toISOString(),
          });
        }
        _snapshot.set(a.id, a.status);
      }
    }
    // Push the current armed list so the renderer panel can reflect TV
    // state regardless of how the alert got there (UI / Claude / phone).
    _send?.("alerts:state", {
      armed: items
        .filter((a) => a.status === "armed")
        .map((a) => ({ id: a.id, price: a.price, label: a.label })),
    });
    _send?.("health:update", { alerts: "healthy" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[alerts] poll failed", err?.message || err);
    _send?.("health:update", { alerts: "down" });
  } finally {
    _inFlight = false;
    scheduleNext();
  }
}

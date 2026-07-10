// anomalies.helpers.js — pure view model for the System page ANOMALIES card
// (Track 2 §2b item 5, docs/intent/2026-07-10-unified-goal.md). An "anomaly" is
// either a RED readiness blocker (a critical gate failed) or a captured
// app:error (a runtime error fired). This module turns those two sources into one
// ordered list the card renders, plus the capped ring buffer for app:error
// events. No React, no IPC — node --test'd directly.
//
// INJECTION-INERT: every field here is DATA (plain strings copied verbatim from
// the source event/row). The card renders each as a React text node — it never
// builds HTML — so an error message containing markup is shown literally, never
// interpreted. These helpers do no escaping precisely because the render path
// treats them as text, not markup.

// A red readiness row is one that failed hard — fail or unavailable (the "bad"
// tone the card shows red). warn / pending are amber, not red, so they are not
// anomalies (they don't block and don't need an explanation).
const RED_STATUSES = new Set(["fail", "unavailable"]);

// Keep the last N app:error events. Small — the card is a triage surface, not a
// log; older errors scroll off. Newest first.
export const MAX_ERRORS = 6;

// Append an app:error event to the capped ring buffer (newest first). Pure: the
// new record's id is derived from the existing list (max + 1), so it is stable
// and unique for React keys without any module-level counter or clock.
export function pushAppError(list, ev, cap = MAX_ERRORS) {
  const prev = Array.isArray(list) ? list : [];
  const message = typeof ev?.message === "string" && ev.message ? ev.message : String(ev?.message ?? "unknown error");
  const source = typeof ev?.source === "string" && ev.source ? ev.source : "app";
  const level = ev?.level === "warn" ? "warn" : "error";
  const id = prev.reduce((m, e) => Math.max(m, Number(e?.id) || 0), 0) + 1;
  const rec = { id, source, message, level, ts: ev?.ts ?? null };
  return [rec, ...prev].slice(0, Math.max(1, cap));
}

// buildAnomalies({ readiness, errors }) — the ordered anomaly list. App errors
// first (most-recent runtime events), then the red readiness blockers (in row
// order). Each item is self-contained: a stable `key`, its `kind`, a short
// `label`, the `detail` prose, `tone`, and the fields buildExplainEvent needs
// (code / source / status / action / level). Pure.
export function buildAnomalies({ readiness = null, errors = [] } = {}) {
  const out = [];

  for (const e of Array.isArray(errors) ? errors : []) {
    if (!e) continue;
    out.push({
      key: `err:${e.id}`,
      kind: "app_error",
      label: String(e.source || "app"),
      detail: String(e.message || ""),
      source: e.source ? String(e.source) : null,
      code: e.source ? String(e.source) : null,
      status: null,
      action: null,
      level: e.level === "warn" ? "warn" : "error",
      tone: e.level === "warn" ? "warn" : "bad",
    });
  }

  const rows = Array.isArray(readiness?.rows) ? readiness.rows : [];
  for (const r of rows) {
    if (!r || !RED_STATUSES.has(r.status)) continue;
    out.push({
      key: `rdy:${r.id}`,
      kind: "readiness",
      label: String(r.label || r.id || "readiness"),
      detail: String(r.reason || "readiness evidence unavailable"),
      source: r.source ? String(r.source) : (r.id ? String(r.id) : null),
      code: r.id ? String(r.id) : null,
      status: r.status || null,
      action: typeof r.action === "string" && r.action ? r.action : null,
      level: null,
      tone: "bad",
    });
  }

  return out;
}

// buildExplainEvent(anomaly) — map an anomaly view-model item to the compact
// event payload the explain turn serializes (main-side serializeExplainContext).
// Pure; defensive against a missing anomaly.
export function buildExplainEvent(anomaly = {}) {
  if (anomaly?.kind === "readiness") {
    return {
      kind: "readiness",
      code: anomaly.code || null,
      source: anomaly.source || anomaly.code || null,
      status: anomaly.status || null,
      action: anomaly.action || null,
      message: anomaly.detail || anomaly.label || "",
    };
  }
  return {
    kind: "app_error",
    code: anomaly?.code || anomaly?.source || null,
    source: anomaly?.source || null,
    level: anomaly?.level === "warn" ? "warn" : "error",
    message: anomaly?.detail || "",
  };
}

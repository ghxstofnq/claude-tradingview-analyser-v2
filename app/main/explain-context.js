// app/main/explain-context.js — deterministic context serializer for the
// on-demand anomaly explainer (Track 2 §2b item 5, docs/intent/2026-07-10-unified-goal.md).
//
// When the operator clicks EXPLAIN on a red readiness blocker or a captured
// app:error, this turns the raw {event, readiness, health} into ONE bounded,
// deterministic user-message string for the explain turn. It is pure (no clock,
// no randomness) so the same anomaly always serializes to the same text, and it
// is BOUNDED — every free-text field is length-capped and health is projected to
// a fixed scalar whitelist, so a huge health/error payload can never blow the
// turn's context. No React, no IPC — node --test'd directly.

// Per-field caps. Generous enough to carry a real error/reason, tight enough
// that a runaway blob (a stack trace, a serialized bundle in a message) is
// truncated rather than shipped whole.
const MAX_FIELD = 500; // one message / reason
const MAX_ROWS = 14; // readiness rows listed (there are 11 pinned; cap defensively)
const MAX_TOTAL = 4000; // hard ceiling on the whole serialized block

// A bounded, single-line scalar. Non-strings coerce; strings are collapsed to a
// single line and truncated with an ellipsis marker so truncation is visible.
export function boundedText(v, max = MAX_FIELD) {
  if (v == null) return "";
  let s = typeof v === "string" ? v : (() => {
    try { return typeof v === "object" ? JSON.stringify(v) : String(v); }
    catch { return String(v); }
  })();
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return s;
}

// The fixed scalar whitelist for the health snapshot — anything outside this set
// (including a giant unexpected blob) is ignored, so the health section is
// inherently bounded regardless of what health.js grows to emit.
function healthLines(health) {
  if (!health || typeof health !== "object") return ["  (health snapshot unavailable)"];
  const lines = [];
  const push = (label, val) => { if (val !== undefined && val !== null && val !== "") lines.push(`  ${label}: ${boundedText(val, 80)}`); };
  push("loop", health.loop);
  push("cdp", health.cdp);
  push("heartbeat_age_s", health.heartbeat_age_s);
  push("turn_lag_s", health.turn_lag_s);
  const r = health.reconciliation;
  if (r && typeof r === "object") push("reconciliation", `${boundedText(r.state, 60)} (healthy=${r.healthy === true})`);
  const p = health.protection;
  if (p && typeof p === "object") {
    const bits = [`${boundedText(p.state, 60)}`, `healthy=${p.healthy === true}`, `blocked=${p.blocked === true}`];
    if (p.blocker) bits.push(`blocker=${boundedText(p.blocker, 60)}`);
    push("protection", bits.join(" · "));
  }
  return lines.length ? lines : ["  (health snapshot empty)"];
}

// The readiness rows section — non-pass rows first (the actual blockers), then a
// tally of the green ones. Reads the RAW readiness object (shape from
// collectSystemReadiness / readiness:get): { rows: [{id,status,reason,action}], summary }.
function readinessLines(readiness) {
  const rows = Array.isArray(readiness?.rows) ? readiness.rows : [];
  if (!rows.length) return { header: "READINESS: (unavailable)", lines: [] };
  const nonPass = rows.filter((r) => r && r.status && r.status !== "pass");
  const greens = rows.length - nonPass.length;
  const mode = boundedText(readiness?.summary?.mode, 40) || "unknown";
  const shown = nonPass.slice(0, MAX_ROWS);
  const lines = shown.map((r) => {
    const act = r.action ? ` [action: ${boundedText(r.action, 40)}]` : "";
    return `  ${boundedText(r.id, 40)} — ${boundedText(r.status, 20)} — ${boundedText(r.reason, 200)}${act}`;
  });
  if (nonPass.length > shown.length) lines.push(`  …and ${nonPass.length - shown.length} more non-pass row(s)`);
  const header = `READINESS (mode ${mode}; ${greens}/${rows.length} gates green, ${nonPass.length} not green):`;
  return { header, lines };
}

// The ANOMALY event section. `event` is normalized upstream by buildExplainEvent
// (renderer) into { kind, code, source, level?, status?, message, action? } but
// this stays defensive — any missing field just drops its line.
function eventLines(event = {}) {
  const lines = [];
  const kind = boundedText(event.kind, 40) || "unknown";
  lines.push(`  kind: ${kind}`);
  if (event.code) lines.push(`  code: ${boundedText(event.code, 80)}`);
  if (event.source) lines.push(`  source: ${boundedText(event.source, 80)}`);
  if (event.status) lines.push(`  status: ${boundedText(event.status, 40)}`);
  if (event.level) lines.push(`  level: ${boundedText(event.level, 20)}`);
  if (event.action) lines.push(`  suggested_action: ${boundedText(event.action, 40)}`);
  lines.push(`  message: ${boundedText(event.message, MAX_FIELD) || "(none)"}`);
  return lines;
}

/**
 * serializeExplainContext({ event, readiness, health }) — pure, deterministic,
 * bounded. Returns the user-message string the explain turn reads. Same input →
 * byte-identical output. The whole block is capped at MAX_TOTAL as a final guard.
 */
export function serializeExplainContext({ event = {}, readiness = null, health = null } = {}) {
  const rdy = readinessLines(readiness);
  const parts = [
    "ANOMALY — explain in plain language for the operator.",
    "",
    "ANOMALY EVENT:",
    ...eventLines(event),
    "",
    rdy.header,
    ...rdy.lines,
    "",
    "HEALTH:",
    ...healthLines(health),
    "",
    "Explain in 2-5 plain sentences: (1) what is wrong, (2) what the system already",
    "did about it (fail-closed — the affected path is paused, not traded through),",
    "and (3) the operator's next action. Name only recovery actions that exist:",
    "retry reconcile · protect · flatten · restart detector · re-auth by opening the",
    "Tradovate panel · re-run verification — or describe the real step in plain words.",
    "No invented buttons. No numbers that are not shown above. Not a trade signal.",
  ];
  let out = parts.join("\n");
  if (out.length > MAX_TOTAL) out = out.slice(0, MAX_TOTAL - 1).trimEnd() + "…";
  return out;
}

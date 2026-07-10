// Readiness.helpers.js — pure renderer-side view model for the unified
// readiness card (Task C1). Sanitizes the readiness object main sends, fail-
// closed: any malformed row/summary renders `unavailable` + blocks arming,
// mirroring the A3 backtest-readiness sanitizer. No React here — node --test'd.

// The expected rows, in render order, with their human labels + PINNED severity.
// Kept in lock-step with app/main/readiness.js READINESS_ROWS via a copy-contract
// test. Severity is pinned HERE (id → severity) and the payload's severity is
// IGNORED during sanitization — otherwise a forged {status:"fail",
// severity:"warning"} on a critical row would drop out of the arm gate and read
// as READY while rendering red (proven arm-gate defeat).
export const READINESS_ROW_META = Object.freeze([
  { id: "tests", label: "Tests / build", severity: "critical" },
  { id: "running_code", label: "Running code", severity: "critical" },
  { id: "pine", label: "TradingView / Pine", severity: "critical" },
  { id: "detector", label: "Detector bar-data", severity: "critical" },
  { id: "corpus", label: "Corpus certification", severity: "critical" },
  { id: "parity", label: "Parity certificate", severity: "critical" },
  { id: "strategy_approval", label: "Strategy approval", severity: "critical" },
  { id: "broker_account", label: "Broker / account", severity: "critical" },
  { id: "broker_reconciliation", label: "Broker reconciliation", severity: "critical" },
  { id: "protective_stop", label: "Protective stop", severity: "critical" },
  { id: "automation", label: "Automation mode", severity: "warning" },
]);
const EXPECTED_IDS = READINESS_ROW_META.map((m) => m.id);
const LABELS = Object.fromEntries(READINESS_ROW_META.map((m) => [m.id, m.label]));
const SEVERITY = Object.fromEntries(READINESS_ROW_META.map((m) => [m.id, m.severity]));

const VALID_STATUSES = new Set(["pass", "warn", "fail", "pending", "unavailable"]);

// One tone per status. pending is amber (awaiting a real action); unavailable is
// red (no proven source — treated as not-safe, not neutral grey).
export const STATUS_TONE = Object.freeze({
  pass: "ok", warn: "warn", pending: "warn", fail: "bad", unavailable: "bad",
});

// Direct actions the card can fire — only where a real backend action exists.
export const READINESS_ACTIONS = Object.freeze({
  restart_detector: "RESTART",
  retry_reconcile: "RETRY",
  revert_sim: "REVERT SIM",
});

export function statusTone(status) {
  return STATUS_TONE[status] || "bad";
}

export function formatAge(age_s) {
  if (!Number.isFinite(age_s) || age_s < 0) return "";
  if (age_s < 60) return `${age_s}s`;
  if (age_s < 3600) return `${Math.floor(age_s / 60)}m`;
  return `${Math.floor(age_s / 3600)}h`;
}

function sanitizeRow(row, id) {
  const label = LABELS[id];
  // Severity is PINNED from the renderer-side map, never read from the payload.
  const severity = SEVERITY[id] || "critical";
  const valid = row
    && typeof row === "object"
    && row.id === id
    && VALID_STATUSES.has(row.status)
    && typeof row.reason === "string"
    && row.reason.trim().length > 0;
  if (!valid) {
    return { id, label, source: null, status: "unavailable", severity, reason: "readiness evidence unavailable", evidence: null, age_s: null, action: null, tone: "bad" };
  }
  const action = typeof row.action === "string" && READINESS_ACTIONS[row.action] ? row.action : null;
  return {
    id,
    label,
    source: typeof row.source === "string" ? row.source : null,
    status: row.status,
    severity,
    reason: row.reason,
    evidence: row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence) ? row.evidence : null,
    age_s: Number.isFinite(row.age_s) ? row.age_s : null,
    action,
    tone: statusTone(row.status),
  };
}

// readinessView — the sanitized model the card renders. `trusted` is false when
// the payload shape is wrong; in that case every row is unavailable and arm is
// forced false (fail-closed — a broken bridge must never read as "ready").
export function readinessView(readiness) {
  const suppliedRows = Array.isArray(readiness?.rows) ? readiness.rows : [];
  const byId = new Map(suppliedRows.map((r) => [r?.id, r]));
  const rows = EXPECTED_IDS.map((id) => sanitizeRow(byId.get(id), id));

  const shapeOk = !!(readiness && typeof readiness === "object"
    && suppliedRows.length === EXPECTED_IDS.length
    && rows.every((r) => r.status !== "unavailable" || byId.get(r.id)?.status === "unavailable"));

  // Re-derive the gate summary from the sanitized rows — never trust a summary
  // that disagrees with its own rows.
  const critical = rows.filter((r) => r.severity === "critical");
  const armReady = shapeOk && critical.every((r) => r.status === "pass");
  const safetyRed = rows.some((r) => r.id === "protective_stop" && r.status === "fail");
  const paperManual = shapeOk && !safetyRed;

  const worst = rows.some((r) => r.status === "fail" || r.status === "unavailable") ? "fail"
    : rows.some((r) => r.status === "warn" || r.status === "pending") ? "warn"
      : "pass";

  const blockers = critical.filter((r) => r.status !== "pass").map((r) => ({ id: r.id, status: r.status, reason: r.reason }));
  const mode = armReady ? "auto_ready" : paperManual ? "paper_manual" : "locked";
  const reason = !shapeOk ? "readiness bridge unavailable"
    : armReady ? "all readiness gates green — safe to arm"
      : (blockers[0]?.reason ?? "readiness incomplete");

  return {
    trusted: !!shapeOk,
    rows,
    summary: { arm: armReady, paper: paperManual, manual: paperManual, mode, worst, reason, blockers, safety_red: safetyRed },
  };
}

// A compact badge for the card header / hero: the single word + tone.
export function readinessBadge(view) {
  if (!view?.trusted) return { text: "UNKNOWN", tone: "bad" };
  const s = view.summary;
  if (s.arm) return { text: "READY", tone: "ok" };
  if (s.paper) return { text: "PAPER / MANUAL", tone: "warn" };
  return { text: "BLOCKED", tone: "bad" };
}

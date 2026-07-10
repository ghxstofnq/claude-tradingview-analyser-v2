// app/main/execution/order-intent.js
// Durable order-intent lifecycle (Task B1). Every auto/manual order gets a
// deterministic decision_id and an append-only chain of state transitions in
// `order-intents.jsonl` (beside trades.jsonl in the active session dir). A crash
// between "I decided to place" and "the broker acknowledged" no longer loses the
// intent: on restart the fold reveals the last state and planIntentAction decides
// whether to resume, skip, or hold for reconciliation. Fail-closed everywhere —
// an ambiguous submit is held for recovery, never silently invalidated.
//
// Pure logic only in this file's top half (no IO, no electron, no CDP); the DI
// runtime at the bottom lazy-imports fs/sessions so unit tests inject fakes.

// ── Lifecycle states ──────────────────────────────────────────────────────
export const INTENT_STATES = Object.freeze({
  INTENT_CREATED: "INTENT_CREATED",         // we decided to place; nothing sent yet
  SUBMITTING: "SUBMITTING",                 // POST in flight (or about to be)
  BROKER_ACKNOWLEDGED: "BROKER_ACKNOWLEDGED", // broker returned an order id / ok
  POSITION_CONFIRMED: "POSITION_CONFIRMED", // a matching position is live at the broker
  STOP_CONFIRMED: "STOP_CONFIRMED",         // position + protective stop confirmed (terminal-happy)
  REJECTED: "REJECTED",                     // broker rejected / no position (terminal)
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",   // ambiguous / partial / naked — operator or reconciler
  UNKNOWN: "UNKNOWN",                       // broker unreadable — hold, never infer flat
});

const {
  INTENT_CREATED, SUBMITTING, BROKER_ACKNOWLEDGED, POSITION_CONFIRMED,
  STOP_CONFIRMED, REJECTED, RECOVERY_REQUIRED, UNKNOWN,
} = INTENT_STATES;

// FNV-1a 8-hex hash — copied verbatim (the 6-line body) from
// app/main/bar-close.js:1442 `stableIdHash`. Kept local on purpose: importing
// bar-close would pull the whole live chain. A stable hash so the SAME
// setup+account folds to one decision id across bars and restarts, while a
// different side/entry/stop diverges (replay-idempotent).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Deterministic decision id. Folds side+entry+stop in because packetId can fall
// back to a bar-minute timestamp (bar-close.js deterministicSetupId), so two
// distinct setups in the same minute would otherwise collide.
export function deriveDecisionId({ packetId, accountId, session, side, entry, stop } = {}) {
  const parts = [packetId, accountId, session, side, entry, stop].map((p) => (p == null ? "" : String(p)));
  return "OI-" + fnv1a(parts.join("|"));
}

// ── State machine ─────────────────────────────────────────────────────────
// Legal forward edges. STOP_CONFIRMED + REJECTED are terminal (no forward edge).
// RECOVERY_REQUIRED + UNKNOWN have NO forward edge — they only move via an
// explicit reconcile event ({ type: "reconcile", to }).
const FORWARD = {
  [INTENT_CREATED]: new Set([SUBMITTING, REJECTED, UNKNOWN]),
  [SUBMITTING]: new Set([BROKER_ACKNOWLEDGED, REJECTED, RECOVERY_REQUIRED, UNKNOWN]),
  [BROKER_ACKNOWLEDGED]: new Set([POSITION_CONFIRMED, REJECTED, RECOVERY_REQUIRED, UNKNOWN]),
  [POSITION_CONFIRMED]: new Set([STOP_CONFIRMED, RECOVERY_REQUIRED, UNKNOWN]),
  [STOP_CONFIRMED]: new Set(),
  [REJECTED]: new Set(),
  [RECOVERY_REQUIRED]: new Set(),
  [UNKNOWN]: new Set(),
};
// A reconcile event may resolve a held intent to any of these.
const RECONCILE_TARGETS = new Set([STOP_CONFIRMED, REJECTED, POSITION_CONFIRMED, RECOVERY_REQUIRED, UNKNOWN]);

// nextIntentState(current, event) → the next state, or null for an illegal edge.
// `event` is a target-state string for a forward edge, OR { type:"reconcile", to }
// which is the ONLY way out of RECOVERY_REQUIRED / UNKNOWN.
export function nextIntentState(current, event) {
  if (event && typeof event === "object" && event.type === "reconcile") {
    if (current !== RECOVERY_REQUIRED && current !== UNKNOWN) return null;
    return RECONCILE_TARGETS.has(event.to) ? event.to : null;
  }
  const allowed = FORWARD[current];
  if (!allowed) return null;
  return allowed.has(event) ? event : null;
}

// ── Fold ──────────────────────────────────────────────────────────────────
// Last-wins per decision_id. Callers feed parseJsonlTolerant(txt).records so a
// torn tail line is already dropped before we fold; records with no decision_id
// are ignored rather than crashing the fold.
export function foldIntents(records = []) {
  const byId = new Map();
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const id = r.decision_id;
    if (!id) continue;
    byId.set(id, r);
  }
  return byId;
}

// ── Decisions ───────────────────────────────────────────────────────────────
// Given the latest folded record for a decision_id (or none), decide what the
// caller should do when the same setup surfaces again.
export function planIntentAction({ existing } = {}) {
  if (!existing) return { action: "create", state: null };
  const state = existing.state;
  switch (state) {
    case INTENT_CREATED:
    case SUBMITTING:
      // Interrupted mid-flight — we don't know if the order landed. Reconcile.
      return { action: "reconcile", state };
    case BROKER_ACKNOWLEDGED:
    case POSITION_CONFIRMED:
    case STOP_CONFIRMED:
      // Already live at the broker — never double-place.
      return { action: "skip_duplicate", state };
    case REJECTED:
      // A confirmed rejection is not retried in-session (fail-closed).
      return { action: "skip_rejected", state };
    case RECOVERY_REQUIRED:
    case UNKNOWN:
      return { action: "blocked_recovery", state };
    default:
      // Corrupt / unknown state ⇒ fail closed.
      return { action: "blocked_recovery", state: state ?? null };
  }
}

// Classify a raw broker submit result into one of three dispositions. An
// ambiguous submit (fetch-failed / timeout / 5xx → status 0 or non-4xx-non-ok)
// must NEVER invalidate: the order may have landed. Only a 4xx is a clean reject.
export function classifySubmitResult({ ok, status, timeout } = {}) {
  if (ok === true) return "acknowledged";
  if (timeout === true) return "ambiguous";
  const s = Number(status);
  if (Number.isFinite(s) && s >= 400 && s <= 499) return "rejected";
  // status === 0 (fetch failed / timeout), undefined, or 5xx → ambiguous.
  return "ambiguous";
}

const rootOf = (s) => (String(s || "").toUpperCase().match(/(MNQ|MES)/) || [])[1] || null;
const sideKey = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "long" || v === "buy") return "long";
  if (v === "short" || v === "sell") return "short";
  return null;
};

// Interpret a brokerStop reading: true = a stop is present, false = confirmed
// absent, null = not checked / unknown.
function stopPresence(brokerStop) {
  if (brokerStop == null) return null;
  if (Array.isArray(brokerStop)) return brokerStop.length > 0;
  if (typeof brokerStop === "object") {
    if ("present" in brokerStop) return brokerStop.present === true;
    return true;
  }
  return Boolean(brokerStop);
}

// Resolve a held intent against a broker read. Returns the resolved state string.
//   brokerRead.ok === false      → RECOVERY_REQUIRED  (never infer flat, never retry)
//   ok && position == null       → REJECTED           (submit produced no position)
//   matching position, stop set  → STOP_CONFIRMED     (fully bracketed)
//   matching position, stop none → RECOVERY_REQUIRED  (partial bracket / naked)
//   matching position, stop n/a  → POSITION_CONFIRMED (position real, stop unverified)
//   non-matching position        → RECOVERY_REQUIRED  (orphan / mismatch)
export function reconcileIntent({ intent, brokerRead, brokerStop } = {}) {
  if (!brokerRead || brokerRead.ok === false) return RECOVERY_REQUIRED;
  const position = brokerRead.position ?? null;
  if (position == null) return REJECTED;
  const matches =
    rootOf(position.symbol) != null &&
    rootOf(position.symbol) === rootOf(intent?.symbol) &&
    sideKey(position.side) != null &&
    sideKey(position.side) === sideKey(intent?.side);
  if (!matches) return RECOVERY_REQUIRED;
  const present = stopPresence(brokerStop);
  if (present === true) return STOP_CONFIRMED;
  if (present === false) return RECOVERY_REQUIRED;
  return POSITION_CONFIRMED;
}

// ── DI runtime ──────────────────────────────────────────────────────────────
// createIntentStore wraps a { readRecords, appendRecord } dep pair with the fold
// so callers get readIntent(decisionId) + recordTransition(record). Pure over the
// deps — unit tests inject an in-memory pair.
export function createIntentStore(deps = {}) {
  return {
    async readIntent(decisionId) {
      const records = deps.readRecords ? await deps.readRecords() : [];
      return foldIntents(records).get(decisionId) ?? null;
    },
    async recordTransition(record) {
      const rec = { ts: new Date().toISOString(), ...record };
      if (deps.appendRecord) await deps.appendRecord(rec);
      return rec;
    },
  };
}

// Production deps — reads/appends order-intents.jsonl in the active session dir
// (same pattern as tranche-manager.js:145-151). Lazy imports only.
export async function buildRealDeps() {
  const sessions = await import("../sessions.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { parseJsonlTolerant } = await import("../../../cli/lib/jsonl.js");
  const intentsFile = async () => path.join(await sessions.activeSessionDir(), "order-intents.jsonl");
  return {
    readRecords: async () => {
      try {
        const txt = await fs.readFile(await intentsFile(), "utf8");
        return parseJsonlTolerant(txt).records;
      } catch { return []; }
    },
    appendRecord: async (obj) => {
      await fs.appendFile(await intentsFile(), JSON.stringify(obj) + "\n", "utf8");
    },
  };
}

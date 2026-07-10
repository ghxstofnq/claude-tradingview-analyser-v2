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
// `event` is a target-state string for a forward edge, OR { type:"reconcile", to }.
// A reconcile resolution may arrive from ANY non-terminal state — a stuck
// mid-flight INTENT_CREATED/SUBMITTING/BROKER_ACKNOWLEDGED/POSITION_CONFIRMED that
// the broker read settles, or a held RECOVERY_REQUIRED/UNKNOWN. Terminals
// (STOP_CONFIRMED / REJECTED) never move. Forward VERBS out of RECOVERY_REQUIRED /
// UNKNOWN remain illegal — those two leave ONLY via a reconcile event.
export function nextIntentState(current, event) {
  if (event && typeof event === "object" && event.type === "reconcile") {
    if (current === STOP_CONFIRMED || current === REJECTED) return null;
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

// A fail-closed sentinel readIntent returns when the intent journal is corrupt —
// planIntentAction maps it to blocked_recovery so corruption never looks like
// "no intent, create away".
export const CORRUPT_INTENT = Object.freeze({ __corrupt: true, state: "CORRUPT_READ" });

// ── Decisions ───────────────────────────────────────────────────────────────
// Given the latest folded record for a decision_id (or none), decide what the
// caller should do when the same setup surfaces again.
export function planIntentAction({ existing } = {}) {
  if (!existing) return { action: "create", state: null };
  // A corrupt read is never "safe to place" — hold for recovery (fail-closed).
  if (existing.__corrupt) return { action: "blocked_recovery", state: "CORRUPT_READ" };
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
  // deps.readRecords may return a bare array (back-compat) or the tolerant-parse
  // shape { records, dropped }. Normalise so corruption is never silently lost.
  const readAll = async () => {
    const res = deps.readRecords ? await deps.readRecords() : [];
    if (Array.isArray(res)) return { records: res, dropped: 0 };
    return { records: res?.records ?? [], dropped: res?.dropped ?? 0 };
  };
  return {
    async readIntent(decisionId) {
      const { records, dropped } = await readAll();
      if (dropped > 0) {
        // I-3: a torn line in the money-path journal. NEVER let it read as
        // "no intent" — surface loudly and return a fail-closed sentinel that
        // planIntentAction maps to blocked_recovery.
        deps.onCorrupt?.(dropped);
        return { ...CORRUPT_INTENT, decision_id: decisionId };
      }
      return foldIntents(records).get(decisionId) ?? null;
    },
    async recordTransition(record) {
      const rec = { ts: new Date().toISOString(), ...record };
      // Make the state machine real, not decorative: validate the edge against
      // the current folded state and surface any illegal transition. Best-effort
      // (a read/validation failure never blocks the durable append). A reconcile-
      // or adopt-sourced record is a reconcile event; everything else is forward.
      try {
        const { records, dropped } = await readAll();
        if (dropped === 0) {
          const current = foldIntents(records).get(rec.decision_id)?.state ?? null;
          if (current != null) {
            const isReconcile = rec.source === "reconcile" || rec.source === "adopted";
            const event = isReconcile ? { type: "reconcile", to: rec.state } : rec.state;
            if (nextIntentState(current, event) == null) {
              rec.illegal_edge = { from: current, to: rec.state };
              deps.onIllegal?.({ decision_id: rec.decision_id, from: current, to: rec.state });
            }
          }
        }
      } catch { /* validation is best-effort */ }
      if (deps.appendRecord) await deps.appendRecord(rec);
      return rec;
    },
  };
}

// Production deps — reads/appends order-intents.jsonl in the active session dir
// (same pattern as tranche-manager.js:145-151). Lazy imports only. `send` wires
// the corruption + illegal-edge surfaces to the renderer app:error channel.
export async function buildRealDeps({ send } = {}) {
  const sessions = await import("../sessions.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { parseJsonlTolerant } = await import("../../../cli/lib/jsonl.js");
  const intentsFile = async () => path.join(await sessions.activeSessionDir(), "order-intents.jsonl");
  return {
    // Return the full tolerant-parse shape so `dropped` propagates (I-3).
    readRecords: async () => {
      try {
        const txt = await fs.readFile(await intentsFile(), "utf8");
        return parseJsonlTolerant(txt);
      } catch { return { records: [], dropped: 0 }; }
    },
    // Defensive: append with a leading newline so a torn (newline-less) tail from
    // a prior crash can't concatenate into — and corrupt — this new record. The
    // parse tolerates the resulting blank line.
    appendRecord: async (obj) => {
      await fs.appendFile(await intentsFile(), "\n" + JSON.stringify(obj) + "\n", "utf8");
    },
    // Halt-beats-double-place stays: a corrupt read returns CORRUPT_INTENT →
    // planIntentAction → blocked_recovery (no behavioral loosening). ALSO snapshot
    // the corrupt file to a `.quarantine` sibling (best-effort, non-destructive —
    // the live file is untouched) so the torn tail is preserved for post-mortem
    // rather than lost to the next append. Never throws.
    onCorrupt: async (dropped) => {
      send?.("app:error", { source: "order-intent", level: "error", message: `order-intents.jsonl: ${dropped} corrupt line(s) — HOLDING for recovery (fail-closed). A new order will NOT be placed on this decision until it is resolved. Corrupt copy quarantined for inspection.` });
      try {
        const src = await intentsFile();
        const txt = await fs.readFile(src, "utf8");
        await fs.writeFile(`${src}.quarantine`, txt, "utf8");
      } catch { /* best-effort quarantine snapshot */ }
    },
    onIllegal: ({ decision_id, from, to }) => send?.("app:error", { source: "order-intent", level: "warn", message: `Illegal order-intent transition ${from} → ${to} for ${decision_id} (recorded + flagged).` }),
  };
}

// Pure helpers for the LIVE order-lifecycle timeline (Task C3). Extracted so
// they can be unit-tested with `node --test`. Importing this file has NO side
// effects and pulls in NO main-process / node modules — it re-derives the
// visible lifecycle purely from the raw inputs the renderer already holds.
//
// #233 sanitizer discipline: NEVER trust a durable-intent record's claimed
// state at face value for a stage that requires broker corroboration. A record
// claiming STOP_CONFIRMED while the live broker read shows no position must NOT
// light STOP WORKING — re-derive from broker truth, fail-closed.

// ── The 7-stage rail ──────────────────────────────────────────────────────
// Frozen. Order is load-bearing (index === progress). Every durable intent
// state and every broker-truth signal maps onto exactly one of these.
export const TIMELINE_STAGES = Object.freeze([
  Object.freeze({ key: "SETUP_CONFIRMED", label: "SETUP CONFIRMED" }),
  Object.freeze({ key: "RISK_PASSED", label: "RISK PASSED" }),
  Object.freeze({ key: "ORDER_SENT", label: "ORDER SENT" }),
  Object.freeze({ key: "FILL_CONFIRMED", label: "FILL CONFIRMED" }),
  Object.freeze({ key: "STOP_WORKING", label: "STOP WORKING" }),
  Object.freeze({ key: "MANAGED", label: "MANAGED" }),
  Object.freeze({ key: "CLOSED", label: "CLOSED" }),
]);

const STAGE_IDX = Object.freeze(
  TIMELINE_STAGES.reduce((m, s, i) => { m[s.key] = i; return m; }, {})
);

// The eight durable order-intent states this module maps. Kept in lock-step
// with app/main/execution/order-intent.js INTENT_STATES — a contract test
// asserts these sets match so a new intent state can't silently regress the
// rail. Listed here (rather than imported) to keep the renderer helper free of
// main-process / node coupling.
export const DURABLE_STATES = Object.freeze([
  "INTENT_CREATED",
  "SUBMITTING",
  "BROKER_ACKNOWLEDGED",
  "POSITION_CONFIRMED",
  "STOP_CONFIRMED",
  "REJECTED",
  "RECOVERY_REQUIRED",
  "UNKNOWN",
]);

// Reconcile states that mean the broker HOLDS a position right now.
const RECONCILE_POSITION_STATES = new Set([
  "MANAGEMENT_ONLY", "CRITICAL_NO_STOP", "CRITICAL_QTY_MISMATCH", "ORPHAN_POSITION",
]);
// Reconcile states that additionally mean a protective stop is present.
const RECONCILE_STOP_STATES = new Set([
  "MANAGEMENT_ONLY", "CRITICAL_QTY_MISMATCH", "ORPHAN_POSITION",
]);
// Reconcile states that mean the broker is CONFIRMED flat (no position).
const RECONCILE_FLAT_STATES = new Set(["HEALTHY", "JOURNAL_STALE"]);
// Reconcile states that demand operator recovery.
const RECONCILE_RECOVERY_STATES = new Set([
  "CRITICAL_NO_STOP", "CRITICAL_QTY_MISMATCH", "ORPHAN_POSITION", "UNKNOWN",
]);

// The ONLY recovery verbs the UI may offer. Any verb outside this pinned set is
// dropped (a forged / drifted record can't smuggle an arbitrary action button).
export const RECOVERY_VERBS = Object.freeze(["retry", "adopt", "protect", "flatten"]);

const rootOf = (s) => (String(s || "").toUpperCase().match(/(MNQ|MES|NQ|ES)/) || [])[1] || null;
const sideKey = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "long" || v === "buy") return "long";
  if (v === "short" || v === "sell") return "short";
  return null;
};

// Filter an arbitrary verb list down to the pinned whitelist, de-duped and in
// input order. A forged / drifted record can't smuggle an unknown action.
export function sanitizeVerbs(verbs) {
  const seen = new Set();
  const out = [];
  for (const v of verbs || []) {
    if (RECOVERY_VERBS.includes(v) && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// ── foldIntentChain ────────────────────────────────────────────────────────
// Group raw order-intent records by decision_id, preserving transition order,
// and select the ACTIVE chain. Records with no decision_id are ignored (never
// crash the fold). When `symbol` is given, only chains whose records match the
// instrument root are considered.
//
// Active-chain selection: prefer a chain that has NOT terminated in REJECTED;
// among candidates the newest (by last transition ts, else insertion order)
// wins. If every chain is REJECTED, the newest REJECTED chain is returned so
// the rail can still show the failure.
export function foldIntentChain(records = [], { symbol = null } = {}) {
  const order = [];
  const byId = new Map();
  const wantRoot = symbol ? rootOf(symbol) : null;
  for (const r of records || []) {
    if (!r || typeof r !== "object") continue;
    const id = r.decision_id;
    if (!id) continue;
    if (wantRoot && r.symbol != null && rootOf(r.symbol) && rootOf(r.symbol) !== wantRoot) continue;
    if (!byId.has(id)) { byId.set(id, []); order.push(id); }
    byId.get(id).push(r);
  }
  const chains = order.map((id) => {
    const transitions = byId.get(id);
    const last = transitions[transitions.length - 1];
    return {
      decision_id: id,
      state: last?.state ?? null,
      transitions,
      symbol: last?.symbol ?? transitions.find((t) => t.symbol)?.symbol ?? null,
      side: last?.side ?? transitions.find((t) => t.side)?.side ?? null,
      last_ts: last?.ts ?? null,
      seq: order.indexOf(id),
    };
  });
  const tsOf = (c) => (c.last_ts ? Date.parse(c.last_ts) : NaN);
  const newer = (a, b) => {
    const ta = tsOf(a), tb = tsOf(b);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb ? a : b;
    return a.seq >= b.seq ? a : b; // insertion order fallback
  };
  const live = chains.filter((c) => c.state !== "REJECTED");
  const pool = live.length ? live : chains;
  const active = pool.length ? pool.reduce(newer) : null;
  return { active, chains };
}

// ── reconcile normalisation ─────────────────────────────────────────────────
// The reconcile input may be a bare state STRING (getLastReconcileState) or a
// richer record { state, broker_read:{ok,position}, stop_present }. Normalise
// both into { state, brokerOk, positionPresent, positionFlat, stopPresent }.
export function normalizeReconcile(reconcile) {
  if (reconcile == null) return { state: null, brokerOk: null, positionPresent: false, positionFlat: false, stopPresent: false };
  if (typeof reconcile === "string") {
    const state = reconcile;
    if (state === "corrupt") return { state, brokerOk: false, positionPresent: false, positionFlat: false, stopPresent: false };
    const brokerOk = state === "UNKNOWN" ? false : true;
    return {
      state,
      brokerOk,
      positionPresent: RECONCILE_POSITION_STATES.has(state),
      positionFlat: RECONCILE_FLAT_STATES.has(state),
      stopPresent: RECONCILE_STOP_STATES.has(state),
    };
  }
  // Object form — prefer the explicit broker_read truth.
  const state = reconcile.state ?? null;
  const br = reconcile.broker_read ?? null;
  const brokerOk = br ? br.ok === true : (state === "UNKNOWN" ? false : null);
  const posFromBroker = br ? br.position != null : null;
  const positionPresent = posFromBroker === true || (state != null && RECONCILE_POSITION_STATES.has(state));
  const positionFlat = (br ? (br.ok === true && br.position == null) : false) || (state != null && RECONCILE_FLAT_STATES.has(state));
  const stopPresent = reconcile.stop_present === true || (state != null && RECONCILE_STOP_STATES.has(state));
  return { state, brokerOk, positionPresent, positionFlat, stopPresent };
}

function execHasStop(exec) {
  if (!exec) return false;
  if (exec.position?.sl != null) return true;
  return (exec.workingOrders || []).some((o) => {
    const kind = String(o?.kind || o?.type || "").toLowerCase();
    return kind.includes("stop");
  });
}

// Combined broker truth from the live execution:state read + the reconcile
// verdict. Fail-closed: only a definite read counts as "flat".
function brokerTruth({ exec, rec }) {
  const execPos = !!exec?.position;
  const positionPresent = execPos || rec.positionPresent;
  const stopPresent = execHasStop(exec) || rec.stopPresent;
  // Definite flat requires the authoritative reconcile verdict (a bare exec
  // read showing null could be a stale / disconnected feed).
  const positionFlat = rec.positionFlat === true && !positionPresent;
  return { positionPresent, stopPresent, positionFlat };
}

// A journal trade with a terminal outcome is CLOSED.
function journalTerminal(trade) {
  return !!trade && ["STOPPED", "TP2_HIT", "INVALIDATED"].includes(trade.outcome);
}

// ── deriveTimeline ──────────────────────────────────────────────────────────
// Map { chain, trade, exec, reconcile, dropped } → a rendered rail:
//   { stages:[{key,label,status,badge}], currentKey, reachedKey,
//     recovery:null|{kind,verbs,message}, corrupt:bool, blocked:bool }
// status ∈ done | current | failed | pending.  badge ∈ null | "recovery" | "failed".
export function deriveTimeline({ chain = null, trade = null, exec = null, reconcile = null, dropped = 0 } = {}) {
  const rec = normalizeReconcile(reconcile);
  const bt = brokerTruth({ exec, rec });
  const durable = chain?.state ?? null;

  // ── Corruption short-circuit: a torn intent journal blocks the happy path. ──
  if (dropped > 0 || rec.state === "corrupt") {
    return renderRail({
      reachedIdx: -1, currentIdx: 0, failedIdx: null,
      corrupt: true,
      recovery: { kind: "CORRUPT", verbs: sanitizeVerbs(["retry"]), message: "Order-intent journal is corrupt — happy path blocked. Retry the broker read." },
    });
  }

  // ── Terminal REJECTED: order failed at ORDER SENT. ──
  if (durable === "REJECTED") {
    return renderRail({
      reachedIdx: STAGE_IDX.RISK_PASSED, currentIdx: STAGE_IDX.ORDER_SENT, failedIdx: STAGE_IDX.ORDER_SENT,
      recovery: null,
    });
  }

  // ── Base progress from the durable intent state (pre-broker-confirmation). ──
  let reachedIdx;
  switch (durable) {
    case "INTENT_CREATED": reachedIdx = STAGE_IDX.SETUP_CONFIRMED; break;
    case "SUBMITTING": reachedIdx = STAGE_IDX.RISK_PASSED; break;
    case "BROKER_ACKNOWLEDGED": reachedIdx = STAGE_IDX.ORDER_SENT; break;
    case "POSITION_CONFIRMED": reachedIdx = STAGE_IDX.FILL_CONFIRMED; break;
    case "STOP_CONFIRMED": reachedIdx = STAGE_IDX.STOP_WORKING; break;
    case "RECOVERY_REQUIRED":
    case "UNKNOWN": reachedIdx = STAGE_IDX.ORDER_SENT; break; // hold at last durable progress
    default: reachedIdx = -1; // no intent yet
  }

  // ── Broker-truth escalation (add-only — confirms fill / stop / managed). ──
  if (bt.positionPresent) reachedIdx = Math.max(reachedIdx, STAGE_IDX.FILL_CONFIRMED);
  if (bt.positionPresent && bt.stopPresent) reachedIdx = Math.max(reachedIdx, STAGE_IDX.STOP_WORKING);
  const managed = rec.state === "MANAGEMENT_ONLY" || trade?.tp1_hit === true;
  if (managed && (bt.positionPresent || durable === "STOP_CONFIRMED")) reachedIdx = Math.max(reachedIdx, STAGE_IDX.MANAGED);

  // ── FORGE-PROOF the confirmation stages against live broker truth. ──
  // FILL/STOP are only real when the broker corroborates. A durable claim that
  // outruns a definite-flat broker read is capped and flips to recovery.
  let recovery = null;
  const stopCorroborated = bt.stopPresent || (durable === "STOP_CONFIRMED" && bt.positionPresent);
  if (reachedIdx >= STAGE_IDX.STOP_WORKING && !stopCorroborated) {
    // Claimed STOP WORKING but the broker shows no working stop.
    reachedIdx = Math.min(reachedIdx, STAGE_IDX.FILL_CONFIRMED);
  }
  // ── Terminal CLOSED. Two POSITIVE signals only:
  //   1. the journal has a terminal outcome (the grader wrote STOPPED/TP2/etc.);
  //   2. reconcile is JOURNAL_STALE — the reconciler's own verdict that the
  //      broker went flat while the journal thought it open (a real close).
  // A bare HEALTHY-flat while the intent claims a fill is NOT a close — it's a
  // contradiction handled by the forge-proof mismatch below. #233 fail-closed.
  const closedByBroker = rec.state === "JOURNAL_STALE" && (durable === "POSITION_CONFIRMED" || durable === "STOP_CONFIRMED");
  if (journalTerminal(trade) || closedByBroker) {
    reachedIdx = STAGE_IDX.CLOSED;
  } else if (reachedIdx >= STAGE_IDX.FILL_CONFIRMED && bt.positionFlat) {
    // Claimed a live fill but the broker is DEFINITELY flat with no terminal
    // outcome → the position we think we hold isn't there. Re-derive to the
    // last provable stage and demand a reconcile.
    reachedIdx = Math.min(reachedIdx, STAGE_IDX.ORDER_SENT);
    recovery = { kind: "POSITION_MISMATCH", verbs: sanitizeVerbs(["retry", "flatten"]), message: "Intent claims a live position the broker read doesn't show — reconcile before trusting the fill." };
  }

  // ── Recovery from broker/intent state (persistent red badge on current). ──
  if (!recovery) recovery = deriveRecovery({ durable, rec, bt });

  const closed = reachedIdx === STAGE_IDX.CLOSED;
  const currentIdx = closed ? STAGE_IDX.CLOSED : Math.min(reachedIdx + 1, STAGE_IDX.CLOSED);
  return renderRail({ reachedIdx, currentIdx, failedIdx: null, recovery });
}

// Map a residual intent/reconcile state to a recovery affordance (verbs pinned).
function deriveRecovery({ durable, rec, bt }) {
  // Reconcile-driven recovery outranks intent-driven (it's the broker verdict).
  if (rec.state && RECONCILE_RECOVERY_STATES.has(rec.state)) {
    switch (rec.state) {
      case "CRITICAL_NO_STOP": return { kind: "CRITICAL_NO_STOP", verbs: sanitizeVerbs(["protect", "flatten"]), message: "Open position with NO protective stop — protect or flatten now." };
      case "ORPHAN_POSITION": return { kind: "ORPHAN_POSITION", verbs: sanitizeVerbs(["adopt", "flatten"]), message: "Broker holds a position the journal never recorded — adopt or flatten." };
      case "CRITICAL_QTY_MISMATCH": return { kind: "CRITICAL_QTY_MISMATCH", verbs: sanitizeVerbs(["flatten", "retry"]), message: "Position size disagrees with the journal (partial bracket) — reconcile." };
      case "UNKNOWN": return { kind: "UNKNOWN", verbs: sanitizeVerbs(["retry"]), message: "Broker unreadable — hold. Retry the read." };
      default: break;
    }
  }
  if (durable === "RECOVERY_REQUIRED") {
    return { kind: "RECOVERY_REQUIRED", verbs: sanitizeVerbs(["retry", "protect", "flatten"]), message: "Ambiguous order submit — reconcile against the broker before acting." };
  }
  if (durable === "UNKNOWN") {
    return { kind: "UNKNOWN", verbs: sanitizeVerbs(["retry"]), message: "Broker unreadable — hold. Retry the read." };
  }
  // Naked open position (a real fill, no working stop, no explicit reconcile row).
  if (bt.positionPresent && !bt.stopPresent) {
    return { kind: "CRITICAL_NO_STOP", verbs: sanitizeVerbs(["protect", "flatten"]), message: "Open position with NO protective stop — protect or flatten now." };
  }
  return null;
}

function renderRail({ reachedIdx, currentIdx, failedIdx, recovery = null, corrupt = false }) {
  const stages = TIMELINE_STAGES.map((st, i) => {
    let status;
    if (failedIdx != null && i === failedIdx) status = "failed";
    else if (i <= reachedIdx) status = "done";
    else if (i === currentIdx) status = "current";
    else status = "pending";
    let badge = null;
    if (i === failedIdx) badge = "failed";
    else if (recovery && i === currentIdx) badge = "recovery";
    return { key: st.key, label: st.label, status, badge };
  });
  return {
    stages,
    reachedKey: reachedIdx >= 0 ? TIMELINE_STAGES[reachedIdx].key : null,
    currentKey: TIMELINE_STAGES[failedIdx != null ? failedIdx : currentIdx]?.key ?? null,
    recovery,
    corrupt,
    blocked: corrupt || !!recovery,
  };
}

// ── brokerVsJournal ──────────────────────────────────────────────────────────
// Side-by-side broker vs journal coverage. verdict ∈ covered | naked | mismatch
// | unknown. `covered` is only ever returned on a POSITIVE stop confirmation +
// qty agreement; an unreadable broker can never read "covered" (unknown ⇒ naked
// posture).
export function brokerVsJournal({ trade = null, exec = null, reconcile = null } = {}) {
  const rec = normalizeReconcile(reconcile);
  const bt = brokerTruth({ exec, rec });
  const journalQty = numOrNull(trade?.size?.contracts ?? trade?.contracts ?? null);
  const brokerQty = numOrNull(exec?.position?.qty ?? null);
  const journalStop = numOrNull(trade?.stop ?? null);
  const brokerStop = numOrNull(exec?.position?.sl ?? (exec?.workingOrders || []).find((o) => String(o?.kind || o?.type || "").toLowerCase().includes("stop"))?.price ?? null);
  const journalOpen = !!trade && trade.state !== "closed" && !journalTerminal(trade);

  const out = {
    qty: { journal: journalQty, broker: brokerQty },
    stop: { journal: journalStop, broker: brokerStop },
  };

  // No live position on either side we can trust → nothing to cover.
  if (!bt.positionPresent) {
    if (rec.brokerOk === false || (exec == null && reconcile == null)) {
      return { ...out, verdict: "unknown", protected: false };
    }
    return { ...out, verdict: journalOpen ? "unknown" : "unknown", protected: false };
  }

  // Broker holds a position.
  if (!bt.stopPresent) return { ...out, verdict: "naked", protected: false };
  // Stop present — check qty agreement when both sides known.
  if (journalQty != null && brokerQty != null && journalQty !== brokerQty) {
    return { ...out, verdict: "mismatch", protected: false };
  }
  return { ...out, verdict: "covered", protected: true };
}

function numOrNull(v) {
  if (v == null || v === "") return null; // Number(null) === 0 — guard it
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── sourceAgeChips ────────────────────────────────────────────────────────────
// Freshness chips for the four data sources the IN-TRADE panel leans on.
// stale ⇒ red; a MISSING timestamp ⇒ stale (fail-closed — we can't prove fresh).
export const SOURCE_STALE_MS = Object.freeze({ price: 10000, position: 10000, orders: 10000, engine: 45000 });

export function sourceAgeChips({ exec = null, reconcile = null, health = null, lastBar = null, now = Date.now() } = {}) {
  void reconcile;
  const execAt = numOrNull(exec?.read_at ?? null);
  const barAt = numOrNull(lastBar?.time ?? lastBar?.ts ?? null);
  const chip = (key, tsMs, thresholdMs, present) => {
    if (tsMs == null || !Number.isFinite(tsMs)) return { key, age_s: null, stale: true, present: !!present };
    const ageMs = Math.max(0, now - tsMs);
    return { key, age_s: Math.round(ageMs / 1000), stale: ageMs > thresholdMs, present: !!present };
  };
  // Engine freshness rides the health heartbeat (bar cadence) + loop verdict.
  const hbMs = numOrNull(health?.heartbeat_age_s != null ? now - health.heartbeat_age_s * 1000 : (health?._recv_at ?? null));
  const engineChip = (() => {
    const base = chip("engine", hbMs, SOURCE_STALE_MS.engine, health != null);
    if (health && health.loop && health.loop !== "healthy") base.stale = true;
    return base;
  })();
  return [
    chip("price", barAt != null ? barAt : execAt, SOURCE_STALE_MS.price, exec != null || lastBar != null),
    chip("position", execAt, SOURCE_STALE_MS.position, exec != null),
    chip("orders", execAt, SOURCE_STALE_MS.orders, exec != null),
    engineChip,
  ];
}

// ── pnlGate ────────────────────────────────────────────────────────────────────
// P&L (a money number) may render ONLY when the DURABLE intent has reached
// POSITION_CONFIRMED or beyond. A journal state of "filled" alone is NOT enough
// — that can be simulated / optimistic. Everything short of a durable fill
// shows PENDING.
const DURABLE_RANK = Object.freeze({
  INTENT_CREATED: 0, SUBMITTING: 1, BROKER_ACKNOWLEDGED: 2,
  POSITION_CONFIRMED: 3, STOP_CONFIRMED: 4,
});
export function pnlGate({ chain = null, trade = null } = {}) {
  void trade;
  const state = chain?.state ?? null;
  const rank = DURABLE_RANK[state];
  const show = rank != null && rank >= DURABLE_RANK.POSITION_CONFIRMED;
  return { show, label: show ? null : "PENDING", durable: state ?? null };
}

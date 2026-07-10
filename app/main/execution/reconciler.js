// app/main/execution/reconciler.js
// Boot-time broker/journal reconciliation (Task B2). On every start the app must
// answer one money question before it lets auto trade: does the journal's view of
// "open position" match what the broker actually holds, and is that position
// protected by a stop? The pure matrix below maps (journal, broker, stop, qty)
// onto a state + action + blockers; the DI runtime gathers the reads, persists a
// reconciliation.jsonl record, and gates paper auto on a HEALTHY result. Fail
// closed: a broker read we cannot trust holds UNKNOWN and never infers "flat".
//
// Top half is pure (no IO). The DI runtime lazy-imports adapters/sessions so unit
// tests inject fakes and never touch electron/CDP.
import { deriveDecisionId, INTENT_STATES } from "./order-intent.js";

// ── Reconciliation states ─────────────────────────────────────────────────
export const RECONCILE_STATES = Object.freeze({
  HEALTHY: "HEALTHY",                       // journal flat + broker flat
  JOURNAL_STALE: "JOURNAL_STALE",           // journal thinks open, broker flat
  ORPHAN_POSITION: "ORPHAN_POSITION",       // broker open, journal flat
  CRITICAL_NO_STOP: "CRITICAL_NO_STOP",     // broker open, no protective stop
  CRITICAL_QTY_MISMATCH: "CRITICAL_QTY_MISMATCH", // both open, size disagrees (partial bracket)
  MANAGEMENT_ONLY: "MANAGEMENT_ONLY",       // both open, stop present, size agrees — managed
  UNKNOWN: "UNKNOWN",                        // broker unreadable — hold
});

const {
  HEALTHY, JOURNAL_STALE, ORPHAN_POSITION, CRITICAL_NO_STOP,
  CRITICAL_QTY_MISMATCH, MANAGEMENT_ONLY, UNKNOWN,
} = RECONCILE_STATES;

// Pure decision matrix. Inputs:
//   journalOpen  — the journal folds to an open trade
//   brokerRead   — { ok, position }  (ok:false = unreadable, never "flat")
//   stopPresent  — a working protective stop exists at the broker
//   qtyAgree     — journal size matches the broker position size
export function reconcile({ journalOpen, brokerRead, stopPresent, qtyAgree } = {}) {
  const evidence = {
    journal_open: !!journalOpen,
    broker_ok: brokerRead?.ok === true,
    broker_open: brokerRead?.ok === true && brokerRead?.position != null,
    stop_present: stopPresent === true,
    qty_agree: qtyAgree !== false,
  };
  // Row 7: broker unreadable → UNKNOWN. NEVER infer flat from a failed read.
  if (!brokerRead || brokerRead.ok !== true) {
    return { state: UNKNOWN, action: "retry", blockers: ["broker_unreadable"], evidence };
  }
  const brokerOpen = brokerRead.position != null;
  if (!brokerOpen) {
    // Broker confirmed flat.
    if (!journalOpen) return { state: HEALTHY, action: "none", blockers: [], evidence };       // row 1
    return { state: JOURNAL_STALE, action: "close_journal", blockers: ["journal_stale"], evidence }; // row 2
  }
  // Broker holds a position.
  // Row 4: an open position with NO protective stop is the most urgent state —
  // it outranks orphan / qty checks (any journal state).
  if (stopPresent !== true) {
    return { state: CRITICAL_NO_STOP, action: "protect_or_flatten", blockers: ["no_protective_stop"], evidence };
  }
  // Stop present.
  if (!journalOpen) {
    // Row 3: broker holds a position the journal never recorded.
    return { state: ORPHAN_POSITION, action: "adopt_or_flatten", blockers: ["orphan_position"], evidence };
  }
  // Journal open + broker open + stop present.
  if (qtyAgree === false) {
    // Row 5: size drift / partial bracket.
    return { state: CRITICAL_QTY_MISMATCH, action: "manual_reconcile", blockers: ["qty_mismatch"], evidence };
  }
  // Row 6: fully-managed position — auto stays paused, resumes only on explicit
  // operator action (reconciliation does not auto-arm on an already-open trade).
  return { state: MANAGEMENT_ONLY, action: "none", blockers: ["management_only"], evidence };
}

// Only a fully HEALTHY reconciliation permits auto to (re)arm.
export function reconciliationGatesAuto(state) { return state === HEALTHY; }

// The latest reconciliation record from an append-only reconciliation.jsonl fold
// (restart idempotency: the last line is authoritative).
export function latestReconciliation(records = []) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i] && typeof records[i] === "object") return records[i];
  }
  return null;
}

// ── Pure operator planners (no IO) ──────────────────────────────────────────
const normSide = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "long" || v === "buy") return "long";
  if (v === "short" || v === "sell") return "short";
  return null;
};

// Adopt an orphan broker position into the journal: an accept + FILLED pair
// (source "adopted") plus a POSITION_CONFIRMED intent record. Pure — returns the
// records to write; the caller persists them.
export function planAdopt(brokerPosition = {}) {
  const side = normSide(brokerPosition.side);
  const symbol = brokerPosition.symbol ?? null;
  const entry = brokerPosition.avgFill ?? brokerPosition.avg ?? null;
  const contracts = brokerPosition.qty ?? null;
  const decisionId = deriveDecisionId({
    packetId: `adopt:${symbol ?? "?"}`, accountId: brokerPosition.accountId ?? null,
    session: brokerPosition.session ?? "", side, entry, stop: null,
  });
  const tradeId = `ADOPT-${decisionId.slice(3)}`;
  const accept = { type: "accept", id: tradeId, side, symbol, entry, stop: null, source: "adopted" };
  const filled = { type: "outcome", id: tradeId, status: "FILLED", source: "adopted" };
  const intent = {
    decision_id: decisionId, state: INTENT_STATES.POSITION_CONFIRMED, trade_id: tradeId,
    symbol, side, qty: contracts, avg: entry, source: "adopted",
  };
  return { journal: [accept, filled], intent, trade_id: tradeId, decision_id: decisionId };
}

// A protective-stop order spec for an unprotected broker position. Pure.
export function planProtect(brokerPosition = {}, stopPrice) {
  const side = normSide(brokerPosition.side);
  const exitSide = side === "long" ? "sell" : "buy";
  return {
    symbol: brokerPosition.symbol ?? null, side: exitSide, type: "stop", kind: "stop",
    price: stopPrice ?? null, contracts: brokerPosition.qty ?? null,
  };
}

// A close (flatten) spec for a broker position. Pure.
export function planFlatten(brokerPosition = {}) {
  const side = normSide(brokerPosition.side);
  return { symbol: brokerPosition.symbol ?? null, side, contracts: brokerPosition.qty ?? null, kind: "close" };
}

// ── DI runtime ──────────────────────────────────────────────────────────────
function qtyMatches(openTrade, position) {
  const jqty = Number(openTrade?.contracts ?? openTrade?.size?.contracts ?? openTrade?.size ?? openTrade?.qty);
  const bqty = Number(position?.qty);
  if (!Number.isFinite(jqty) || !Number.isFinite(bqty)) return false; // fail closed
  return jqty === bqty;
}

function reconcileMessage(result) {
  switch (result.state) {
    case CRITICAL_NO_STOP: return "RECONCILE: a broker position has NO protective stop — protect or flatten now.";
    case CRITICAL_QTY_MISMATCH: return "RECONCILE: journal vs broker size disagree (partial bracket) — reconcile manually.";
    case ORPHAN_POSITION: return "RECONCILE: the broker holds a position the journal doesn't know about — adopt or flatten.";
    default: return `RECONCILE: ${result.state}`;
  }
}

// createReconciler(deps) → { runReconcile } — one attempt: gather the reads,
// run the pure matrix, persist a record, set the auto gate, and emit a loud
// app:error on a CRITICAL_* / ORPHAN state. Pure over the deps.
export function createReconciler(deps = {}) {
  async function runReconcile() {
    const openTrade = deps.getJournalOpen ? await deps.getJournalOpen() : null;
    const journalOpen = !!openTrade;
    const brokerRead = deps.readBroker ? await deps.readBroker() : { ok: false, position: null };
    let stopPresent = false;
    let qtyAgree = true;
    if (brokerRead?.ok === true && brokerRead.position != null) {
      stopPresent = deps.readStop ? (await deps.readStop(brokerRead.position)) === true : false;
      qtyAgree = qtyMatches(openTrade, brokerRead.position);
    }
    const result = reconcile({ journalOpen, brokerRead, stopPresent, qtyAgree });
    const record = {
      ts: new Date().toISOString(),
      state: result.state,
      journal_open: journalOpen,
      broker_read: { ok: brokerRead?.ok === true, position: brokerRead?.position ?? null },
      stop_present: stopPresent,
      qty_agree: qtyAgree,
      blockers: result.blockers,
      action: result.action,
      evidence_age_ms: brokerRead?.evidence_age_ms ?? null,
      account_id: brokerRead?.account_id ?? (deps.accountId ? deps.accountId() : null),
    };
    if (deps.recordReconciliation) await deps.recordReconciliation(record);
    if (deps.setReconciliationHealthy) deps.setReconciliationHealthy(reconciliationGatesAuto(result.state));
    if ([CRITICAL_NO_STOP, CRITICAL_QTY_MISMATCH, ORPHAN_POSITION].includes(result.state)) {
      deps.emitError?.({ level: "error", message: reconcileMessage(result) });
    }
    return { ...result, record };
  }
  return { runReconcile };
}

// ── Module-level last state (for health.js + ipc-execution.js) ──────────────
let _lastState = null;
export function getLastReconcileState() { return _lastState; }

// Production deps — real journal + broker reads, reconciliation.jsonl append,
// auto gate, app:error sink. Lazy imports only (safe to import this module at
// boot: nothing heavy runs until these deps are built).
async function buildReconcilerDeps({ send } = {}) {
  const sessions = await import("../sessions.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { parseJsonlTolerant } = await import("../../../cli/lib/jsonl.js");
  const { foldOpenTrades } = await import("../../../cli/lib/trade-outcomes.js");
  const active = await import("./active-account.js");
  const feed = await import("./trading-feed.js");
  const autoResume = await import("./auto-resume.js");
  const reconFile = async () => path.join(await sessions.activeSessionDir(), "reconciliation.jsonl");
  const tradesFile = async () => path.join(await sessions.activeSessionDir(), "trades.jsonl");
  return {
    getJournalOpen: async () => {
      try {
        const txt = await fs.readFile(await tradesFile(), "utf8");
        const open = foldOpenTrades(parseJsonlTolerant(txt).records);
        return open[0] ?? null;
      } catch { return null; }
    },
    readBroker: async () => {
      try {
        const broker = active.getActiveAccount()?.broker ?? null;
        if (broker === "tradovate") {
          const { readTradovatePositionSafe } = await import("./tradovate-adapter.js");
          const r = await readTradovatePositionSafe();
          return { ok: r.ok === true, position: r.position ?? null, account_id: active.getActiveAccount()?.id ?? null };
        }
        const { readStateSafe } = await import("./tv-adapter.js");
        const r = await readStateSafe();
        return { ok: r.ok === true, position: r.position ?? null, account_id: feed.getTradingState().accountId ?? null };
      } catch { return { ok: false, position: null }; }
    },
    readStop: async () => {
      try {
        const broker = active.getActiveAccount()?.broker ?? null;
        if (broker === "tradovate") {
          const { readTradovateOrders } = await import("./tradovate-adapter.js");
          return (await readTradovateOrders()).some((o) => o.kind === "stop");
        }
        const wos = feed.getTradingState().workingOrders || [];
        return wos.some((o) => String(o.type || "").toLowerCase().includes("stop"));
      } catch { return false; }
    },
    recordReconciliation: async (record) => {
      _lastState = record.state;
      try { await fs.appendFile(await reconFile(), JSON.stringify(record) + "\n", "utf8"); } catch { /* best-effort */ }
    },
    setReconciliationHealthy: (v) => { try { autoResume.setReconciliationHealthy(v); } catch { /* best-effort */ } },
    emitError: (o) => send?.("app:error", { source: "reconciler", ...o }),
    accountId: () => active.getActiveAccount()?.id ?? null,
  };
}

// One reconciliation attempt against the real deps (execution:reconcile retry).
export async function runReconcileNow({ send } = {}) {
  const deps = await buildReconcilerDeps({ send });
  return createReconciler(deps).runReconcile();
}

// Start the boot reconciler: run immediately, then bounded 4s retries (matching
// the fill poller cadence) WHILE the broker read is UNKNOWN — the broker feed may
// not be connected the instant we boot, so keep retrying until it answers. Never
// blocks boot (fire-and-forget). Returns a small handle for shutdown/tests.
export function startReconciler({ send } = {}) {
  let stopped = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 6;   // ~24s of retries — long enough for the feed to connect
  const RETRY_MS = 4000;    // match startTradovateFillPoller / trading-feed reconnect
  async function attempt() {
    if (stopped) return;
    let result = null;
    try { result = await runReconcileNow({ send }); } catch { /* never crash boot */ }
    if (!stopped && result?.state === UNKNOWN && attempts < MAX_ATTEMPTS) {
      attempts += 1;
      setTimeout(attempt, RETRY_MS).unref?.();
    }
  }
  Promise.resolve().then(attempt);
  return { stop: () => { stopped = true; }, get lastState() { return _lastState; } };
}

// ── Operator recovery actions (execution:reconcile:{adopt,protect,flatten}) ──
// Each reads the broker fresh, applies the pure planner, writes, and re-runs the
// reconciler so the gate/state reflect the fix. Fail-closed structured returns.
export async function adoptOpenPosition({ send } = {}) {
  const deps = await buildReconcilerDeps({ send });
  const brokerRead = await deps.readBroker();
  if (brokerRead?.ok !== true) return { ok: false, code: "broker_unreadable" };
  if (brokerRead.position == null) return { ok: false, code: "no_position" };
  const plan = planAdopt(brokerRead.position);
  const sessions = await import("../sessions.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = await sessions.activeSessionDir();
  const stamp = new Date().toISOString();
  try {
    for (const ev of plan.journal) await fs.appendFile(path.join(dir, "trades.jsonl"), JSON.stringify({ ...ev, ts: stamp }) + "\n", "utf8");
    await fs.appendFile(path.join(dir, "order-intents.jsonl"), JSON.stringify({ ...plan.intent, ts: stamp }) + "\n", "utf8");
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  const result = await createReconciler(deps).runReconcile();
  return { ok: true, adopted: plan.trade_id, state: result.state };
}

export async function protectOpenPosition({ send, stopPrice } = {}) {
  const deps = await buildReconcilerDeps({ send });
  const brokerRead = await deps.readBroker();
  if (brokerRead?.ok !== true) return { ok: false, code: "broker_unreadable" };
  if (brokerRead.position == null) return { ok: false, code: "no_position" };
  const spec = planProtect(brokerRead.position, stopPrice);
  if (spec.price == null) return { ok: false, code: "no_stop_price" };
  try {
    const active = await import("./active-account.js");
    if (active.getActiveAccount()?.broker === "tradovate") {
      const { placeTradovateOrder } = await import("./tradovate-adapter.js");
      const r = await placeTradovateOrder({ symbol: spec.symbol, side: spec.side, type: "stop", contracts: spec.contracts, entry: spec.price, limitPrice: spec.price });
      const result = await createReconciler(deps).runReconcile();
      return { ok: r?.ok === true, broker: "tradovate", result: r, state: result.state };
    }
    const { tvAdapter } = await import("./tv-adapter.js");
    const r = await tvAdapter.placeStandalone(spec);
    const result = await createReconciler(deps).runReconcile();
    return { ok: r?.ok === true, broker: "paper", result: r, state: result.state };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

export async function flattenOpenPosition({ send } = {}) {
  const deps = await buildReconcilerDeps({ send });
  const brokerRead = await deps.readBroker();
  if (brokerRead?.ok !== true) return { ok: false, code: "broker_unreadable" };
  if (brokerRead.position == null) return { ok: true, alreadyFlat: true };
  const spec = planFlatten(brokerRead.position);
  try {
    const active = await import("./active-account.js");
    if (active.getActiveAccount()?.broker === "tradovate") {
      const { closeTradovatePosition } = await import("./tradovate-adapter.js");
      const r = await closeTradovatePosition({ instrument: brokerRead.position.symbol });
      const result = await createReconciler(deps).runReconcile();
      return { ok: r?.ok === true, broker: "tradovate", result: r, state: result.state };
    }
    const { tvAdapter } = await import("./tv-adapter.js");
    const r = await tvAdapter.flatten({ symbol: spec.symbol });
    const result = await createReconciler(deps).runReconcile();
    return { ok: r?.ok === true, broker: "paper", result: r, state: result.state };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

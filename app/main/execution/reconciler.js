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
import { getReconciliationHealthy, setReconciliationHealthy } from "./auto-resume.js";

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
    // Row 3: broker holds a position the journal never recorded. Also the
    // cross-session-carry case (I-2): a position held across a session rollover
    // reconciles against the NEW session's empty journal → ORPHAN, which blocks
    // auto (fail-closed) pending an operator adopt/flatten. That is the intended,
    // safe outcome — never auto-flatten or auto-adopt a carried position.
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

// ── B4: broker-clock EOD ────────────────────────────────────────────────────
// The bar-driven maybeForceCloseAtEod (trade-ticker.js) keeps its R bookkeeping;
// this is the AUTHORITATIVE broker flatten that closes the NET position at 16:00
// ET cash close — manual AND auto in one flatten (the manual-bracket gap the
// bar path never covered), driven by the trade-ticker-watchdog's wall-clock
// timer so it fires even when the bar detector is dead.

const EOD_MINUTE = 16 * 60; // 16:00 ET

// Pure. Is the broker-clock EOD flatten due? Idempotent per trading day: fires
// only at/after 16:00 ET and only once per ET date (lastEodDate latches it).
export function eodDue({ nowEtMinutes, lastEodDate, todayEt, eodMinute = EOD_MINUTE } = {}) {
  if (!Number.isFinite(nowEtMinutes) || nowEtMinutes < eodMinute) return false;
  if (todayEt == null) return false;
  return lastEodDate !== todayEt;
}

// Pure. Reconstruct the last CONFIRMED EOD flatten date from reconciliation.jsonl
// on restart (so a mid-day restart doesn't re-flatten a day already closed, and
// an UNKNOWN/unconfirmed result leaves the latch OPEN → retried next tick).
export function lastEodDateFrom(records = []) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (r && r.action === "eod_flatten" && r.confirmed_flat === true) return r.trading_day ?? null;
  }
  return null;
}

// Pure. Build the reconciliation.jsonl EOD row (reuses the same file + append).
function buildEodRecord({ state, confirmedFlat, tradingDay, note, now, brokerRead, flatResult, cancelResult }) {
  return {
    ts: new Date(now).toISOString(),
    action: "eod_flatten",
    state,
    confirmed_flat: confirmedFlat === true,
    trading_day: tradingDay ?? null,
    note: note ?? null,
    broker_read: { ok: brokerRead?.ok === true, position: brokerRead?.position ?? null },
    flat_result: flatResult ?? null,
    cancel_result: cancelResult ?? null,
  };
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
  // Carry the broker size onto the accept row so the NEXT boot's qtyMatches sees
  // journal ≡ broker and doesn't false-alarm CRITICAL_QTY_MISMATCH.
  const accept = { type: "accept", id: tradeId, side, symbol, entry, stop: null, contracts, size: { contracts }, source: "adopted" };
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
  async function runReconcile(_depth = 0) {
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
    // B-1: EXECUTE close_journal. A JOURNAL_STALE row (broker CONFIRMED flat —
    // ok:true + position:null, guaranteed by this state) that is only an
    // unfilled / recovery-held stub is written terminal so it leaves the open set
    // and stops bricking auto for the session. Fail-closed: closeJournalStale only
    // closes rows that never confirmed a fill; a genuinely-filled row is left for
    // the grader / operator (never drop P&L). Then recompute once → HEALTHY.
    if (result.state === JOURNAL_STALE && _depth === 0 && deps.closeJournalStale) {
      let closed = 0;
      try { closed = (await deps.closeJournalStale(openTrade)) || 0; } catch { closed = 0; }
      if (closed > 0) return runReconcile(_depth + 1);
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
  // Read the open journal trades, surfacing any torn-tail corruption (I-3).
  const readOpenTrades = async () => {
    try {
      const txt = await fs.readFile(await tradesFile(), "utf8");
      const parsed = parseJsonlTolerant(txt);
      if (parsed.dropped > 0) send?.("app:error", { source: "reconciler", level: "error", message: `trades.jsonl: ${parsed.dropped} corrupt line(s) while reconciling — treating the journal as UNCERTAIN (fail-closed).` });
      return { open: foldOpenTrades(parsed.records), dropped: parsed.dropped };
    } catch { return { open: [], dropped: 0 }; }
  };
  return {
    getJournalOpen: async () => {
      const { open, dropped } = await readOpenTrades();
      // Corruption ⇒ pretend "journal open" so the matrix can never read HEALTHY
      // off an unreadable journal (fail-closed): a synthetic marker keeps the
      // journal side non-flat without inventing a closeable trade.
      if (dropped > 0) return { id: null, state: "corrupt", __corrupt: true };
      return open[0] ?? null;
    },
    readBroker: async () => {
      try {
        const broker = active.getActiveAccount()?.broker ?? null;
        if (broker === "tradovate") {
          const { readTradovatePositionSafe } = await import("./tradovate-adapter.js");
          const r = await readTradovatePositionSafe();
          return { ok: r.ok === true, position: r.position ?? null, account_id: active.getActiveAccount()?.id ?? null };
        }
        // Paper: the trading WS FEED is the reliable position source — the DOM
        // table goes stale/absent when the panel is collapsed (B-2). Trust the
        // feed only once it has affirmatively reported a position frame; otherwise
        // fall back to the hardened DOM read (ok:false unless the table is present).
        const fs2 = feed.getTradingState();
        if (fs2.connected === true && fs2.hasReceivedPositionUpdate === true) {
          return { ok: true, position: fs2.position ?? null, account_id: fs2.accountId ?? null };
        }
        const { readStateSafe } = await import("./tv-adapter.js");
        const r = await readStateSafe();
        return { ok: r.ok === true, position: r.position ?? null, account_id: fs2.accountId ?? null };
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
    // B-1: close unfilled / recovery-held journal rows against a CONFIRMED-flat
    // broker so a status-0 submit that never landed can't brick auto forever.
    // Only touches states that never confirmed a fill; a filled row is left alone.
    closeJournalStale: async () => {
      const { open, dropped } = await readOpenTrades();
      if (dropped > 0) return 0; // corrupt journal — never auto-close on uncertainty
      const closeable = open.filter((t) => t.state === "recovery_held" || t.state === "pending_entry");
      if (!closeable.length) return 0;
      const stamp = new Date().toISOString();
      for (const t of closeable) {
        try { await fs.appendFile(await tradesFile(), JSON.stringify({ type: "outcome", id: t.id, status: "INVALIDATED", source: "reconcile-flat", ts: stamp }) + "\n", "utf8"); } catch { /* best-effort */ }
      }
      send?.("app:error", { source: "reconciler", level: "warn", message: `Closed ${closeable.length} unfilled/recovery journal row(s) against a CONFIRMED-flat broker — session auto unblocked.` });
      return closeable.length;
    },
    recordReconciliation: async (record) => {
      _lastState = record.state;
      try { await fs.appendFile(await reconFile(), JSON.stringify(record) + "\n", "utf8"); } catch { /* best-effort */ }
    },
    setReconciliationHealthy: (v) => { try { autoResume.setReconciliationHealthy(v); } catch { /* best-effort */ } },
    emitError: (o) => send?.("app:error", { source: "reconciler", ...o }),
    accountId: () => active.getActiveAccount()?.id ?? null,
    // B4: the whole EOD reconciliation.jsonl for lastEodDate reconstruction.
    readReconciliations: async () => {
      try {
        const txt = await fs.readFile(await reconFile(), "utf8");
        return parseJsonlTolerant(txt).records;
      } catch { return []; }
    },
    // B4: flatten the NET broker position (closes manual AND auto in one shot).
    flatten: async (position) => {
      const broker = active.getActiveAccount()?.broker ?? null;
      if (broker === "tradovate") {
        const { closeTradovatePosition } = await import("./tradovate-adapter.js");
        return closeTradovatePosition({ instrument: position?.symbol });
      }
      const { tvAdapter } = await import("./tv-adapter.js");
      return tvAdapter.flatten({ symbol: position?.symbol });
    },
    // B4: cancel every working order (the resting bracket / limit).
    cancelWorkingOrders: async () => {
      const broker = active.getActiveAccount()?.broker ?? null;
      if (broker === "tradovate") {
        const { cancelTradovateOrders } = await import("./tradovate-adapter.js");
        return cancelTradovateOrders();
      }
      const { tvAdapter } = await import("./tv-adapter.js");
      const wos = feed.getTradingState().workingOrders || [];
      const results = [];
      for (const o of wos) { try { results.push(await tvAdapter.cancelOrder({ id: o.id })); } catch { /* best-effort */ } }
      return { ok: results.every((r) => r?.ok === true), cancelled: results.filter((r) => r?.ok === true).length, results };
    },
  };
}

// One reconciliation attempt against the real deps (execution:reconcile retry).
export async function runReconcileNow({ send } = {}) {
  const deps = await buildReconcilerDeps({ send });
  return createReconciler(deps).runReconcile();
}

// Reconcile with a short burst of retries, but do NOT let a transient UNKNOWN
// clobber a prior HEALTHY gate — the gate is written from the SETTLED (non-
// UNKNOWN) result. Used by the supervisor's on-arm re-reconcile so a momentary
// unreadable read on arm doesn't flap a healthy paper-auto gate closed. DI over
// runOnce/getGate/setGate/sleep for unit tests.
export async function runReconcileWithBurst({
  send, attempts = 4, delayMs = 1000,
  runOnce, getGate = getReconciliationHealthy, setGate = setReconciliationHealthy, sleep,
} = {}) {
  const run = runOnce || (() => runReconcileNow({ send }));
  const wait = sleep || ((ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); }));
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    const priorGate = getGate();
    // eslint-disable-next-line no-await-in-loop
    last = await run();
    if (last?.state !== UNKNOWN) return last; // settled — this run's gate write stands
    // Transient UNKNOWN: restore the prior gate so we don't flap a HEALTHY open.
    if (priorGate === true) { try { setGate(true); } catch { /* best-effort */ } }
    // eslint-disable-next-line no-await-in-loop
    if (i < attempts - 1) await wait(delayMs);
  }
  return last;
}

// B4: the last CONFIRMED EOD flatten date from disk (restart seed for the
// per-day latch).
export async function readLastEodDate({ send, deps } = {}) {
  try {
    const d = deps || await buildReconcilerDeps({ send });
    const recs = d.readReconciliations ? await d.readReconciliations() : [];
    return lastEodDateFrom(recs || []);
  } catch { return null; }
}

// B4: the authoritative broker-clock EOD flatten. Fail-closed throughout —
//   unreadable broker → UNKNOWN, gate stays closed, latch NOT set (retry).
//   confirmed flat    → idempotent no-op (already_flat), latch may set.
//   open position     → flatten NET + cancel working orders, re-reconcile, and
//                       report flat ONLY off a confirmed ok:true position:null
//                       read; anything else → UNKNOWN + loud error + retry.
// Never assumes flat, never double-flattens a confirmed-flat broker.
export async function eodFlattenNow({ send, now = Date.now(), tradingDay = null, deps } = {}) {
  const d = deps || await buildReconcilerDeps({ send });
  const brokerRead = await d.readBroker();
  if (brokerRead?.ok !== true) {
    d.emitError?.({ level: "warn", message: "EOD flatten: broker UNREADABLE — cannot confirm flat, will retry next tick (fail-closed; never assume flat)." });
    await d.recordReconciliation?.(buildEodRecord({ state: UNKNOWN, confirmedFlat: false, tradingDay, note: "broker_unreadable", now, brokerRead }));
    return { ok: false, confirmedFlat: false, state: UNKNOWN };
  }
  if (brokerRead.position == null) {
    // Already flat — idempotent no-op. Latch the day so we don't re-check.
    await d.recordReconciliation?.(buildEodRecord({ state: HEALTHY, confirmedFlat: true, tradingDay, note: "already_flat", now, brokerRead }));
    return { ok: true, confirmedFlat: true, alreadyFlat: true, state: HEALTHY };
  }
  // Open at cash close — flatten the NET position (manual AND auto) + cancel the
  // resting bracket, then verify.
  let flatResult = null;
  let cancelResult = null;
  try {
    flatResult = await d.flatten?.(brokerRead.position);
    cancelResult = await d.cancelWorkingOrders?.();
  } catch (e) {
    d.emitError?.({ level: "error", message: `EOD flatten threw: ${String(e?.message || e)} — retrying next tick.` });
    await d.recordReconciliation?.(buildEodRecord({ state: UNKNOWN, confirmedFlat: false, tradingDay, note: "flatten_threw", now, brokerRead, flatResult, cancelResult }));
    return { ok: false, confirmedFlat: false, state: UNKNOWN, error: String(e?.message || e) };
  }
  // Re-reconcile: report flat ONLY off a confirmed ok:true + position:null read.
  const after = await createReconciler(d).runReconcile();
  const afterRead = after?.record?.broker_read ?? null;
  const confirmedFlat = afterRead?.ok === true && afterRead?.position == null;
  await d.recordReconciliation?.(buildEodRecord({
    state: confirmedFlat ? HEALTHY : UNKNOWN, confirmedFlat, tradingDay,
    note: confirmedFlat ? "flattened" : "flatten_unconfirmed", now,
    brokerRead: afterRead ?? brokerRead, flatResult, cancelResult,
  }));
  if (!confirmedFlat) {
    d.emitError?.({ level: "error", message: "EOD flatten sent but the broker did NOT confirm flat — gate stays CLOSED, retrying next tick (fail-closed)." });
    return { ok: false, confirmedFlat: false, state: UNKNOWN };
  }
  return { ok: true, confirmedFlat: true, state: HEALTHY };
}

// Start the boot reconciler: run immediately, then a fast burst of retries while
// the broker read is UNKNOWN, then keep retrying on a SLOW cadence indefinitely
// (I-1 — the feed can connect >24s after boot; the read is cheap + read-only, so
// the gate must never brick shut silently). Emits one loud app:error when the
// fast burst ends still-UNKNOWN, and a one-time summary on any non-HEALTHY boot
// settle so a paused paper-auto is never silent. Never blocks boot.
export function startReconciler({ send, runOnce, schedule } = {}) {
  let stopped = false;
  let burst = 0;
  let burstExhaustedEmitted = false;
  let bootSummaryEmitted = false;
  const BURST_MAX = 6;      // ~24s of fast retries — matches the fill poller cadence
  const BURST_MS = 4000;
  const SLOW_MS = 30000;    // then every 30s, unbounded, while still UNKNOWN
  // Injectable for tests; production runs the real reconcile + setTimeout.
  const run = runOnce || (() => runReconcileNow({ send }));
  const arm = schedule || ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); });
  async function attempt() {
    if (stopped) return;
    let result = null;
    try { result = await run(); } catch { /* never crash boot */ }
    if (stopped) return;
    const state = result?.state ?? UNKNOWN;
    if (state === UNKNOWN) {
      burst += 1;
      if (burst < BURST_MAX) { arm(attempt, BURST_MS); return; }
      if (!burstExhaustedEmitted) {
        burstExhaustedEmitted = true;
        send?.("app:error", { source: "reconciler", level: "error", message: `Broker feed still UNREADABLE ~${Math.round(BURST_MAX * BURST_MS / 1000)}s after boot — paper auto stays PAUSED (fail-closed). Retrying every ${SLOW_MS / 1000}s; RECONCILE retries now.` });
      }
      arm(attempt, SLOW_MS); // slow, UNBOUNDED while UNKNOWN — never give up
      return;
    }
    // Resolved (non-UNKNOWN): stop the loop. CRITICAL/ORPHAN already surfaced
    // inside runReconcile; emit a one-time summary for the other non-HEALTHY
    // settles (MANAGEMENT_ONLY / a filled-row JOURNAL_STALE) so a paused auto
    // never goes unexplained.
    if (!bootSummaryEmitted && state !== HEALTHY) {
      bootSummaryEmitted = true;
      send?.("app:error", { source: "reconciler", level: "warn", message: `Boot reconciliation settled ${state} — paper auto stays PAUSED until resolved / explicitly resumed.` });
    }
  }
  arm(attempt, 0); // initial kick — fire-and-forget, never blocks boot
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

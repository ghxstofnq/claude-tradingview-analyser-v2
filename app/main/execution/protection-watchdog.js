// app/main/execution/protection-watchdog.js
// Continuous protection watchdog (Task B3). The boot reconciler answers the
// money question ONCE at startup: is the open position real + protected? This
// module keeps asking it, always-on, on its own timer — because a stop can be
// cancelled, a position can drift, a symbol can be hijacked, or a token can
// expire long AFTER boot and outside any session window. A held position must be
// watched the whole time it is held.
//
// It reuses the reconciler's fail-closed reads (broker position, working orders,
// journal) and the same downstream (the auto/manual entry gate, the B1 order-
// intent RECOVERY_REQUIRED transition, and the app:error surface). It NEVER
// flattens: on any ambiguous / unreadable / auth-lost read it pauses NEW entries
// (fail-closed) and holds the existing position for operator recovery. Only a
// human (execution:reconcile adopt/protect/flatten) or the broker-clock EOD
// (Task B4, in reconciler.js) ever closes a position. That "detect + surface,
// never auto-flatten" split is deliberate: an auto-flatten on a misread would be
// far more dangerous than a held, surfaced breach.
//
// Top half is pure (no IO); the DI runtime at the bottom lazy-imports adapters /
// sessions so unit tests inject fakes and never touch electron / CDP.
import { RECONCILE_STATES } from "./reconciler.js";
import { tvRootOf } from "./tradovate.js";
import { getProtectionOk } from "./auto-resume.js";

// Two of the terminal breach states are shared verbatim with the boot reconciler
// so the operator sees ONE vocabulary across boot + live.
const { CRITICAL_NO_STOP, CRITICAL_QTY_MISMATCH } = RECONCILE_STATES;

// ── Protection states ───────────────────────────────────────────────────────
export const PROTECTION_STATES = Object.freeze({
  PROTECTED: "PROTECTED",             // position live + fully bracketed + on-route
  NO_POSITION: "NO_POSITION",         // broker confirmed flat — nothing to protect
  UNKNOWN: "UNKNOWN",                 // broker unreadable — hold, never infer flat
  AUTH_EXPIRED: "AUTH_EXPIRED",       // token lost — pause + surface, NEVER flatten
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED", // confirmed protective breach — operator
});
const { PROTECTED, NO_POSITION, UNKNOWN, AUTH_EXPIRED, RECOVERY_REQUIRED } = PROTECTION_STATES;

// ── Side helpers ────────────────────────────────────────────────────────────
// Normalise any side token to "buy"/"sell" (long ≡ buy, short ≡ sell) or null.
function sideKey(s) {
  const v = String(s || "").toLowerCase();
  if (v.includes("sell") || v === "short") return "sell";
  if (v.includes("buy") || v === "long") return "buy";
  return null;
}
// The order side that CLOSES a position: a long (buy) closes with a sell, a
// short (sell) closes with a buy.
function exitSideOf(positionSide) {
  const s = sideKey(positionSide);
  if (s === "buy") return "sell";
  if (s === "sell") return "buy";
  return null;
}

// ── Pure checks ─────────────────────────────────────────────────────────────
// Freshness. Tradovate REST has no independent staleness signal → read success
// IS freshness. Paper carries a feed age → stale beyond maxAgeMs is not fresh.
export function checkFreshness({ evidenceAgeMs, maxAgeMs, brokerOk } = {}) {
  if (brokerOk !== true) return { ok: false, blocker: "stale_broker_read" };
  if (evidenceAgeMs != null && Number.isFinite(maxAgeMs) && evidenceAgeMs > maxAgeMs) {
    return { ok: false, blocker: "stale_broker_read" };
  }
  return { ok: true, blocker: null };
}

// Route match: the position must sit on the armed account + instrument root. A
// missing side of the comparison is treated as "cannot disprove" (ok) — only a
// KNOWN mismatch (the symbol-hijack case) is a breach.
export function checkRouteMatch({ position, armedRoute } = {}) {
  if (!position) return { ok: true, blocker: null };
  if (!armedRoute || (armedRoute.account_id == null && armedRoute.root == null)) {
    return { ok: true, blocker: null };
  }
  const posRoot = tvRootOf(position.symbol);
  const rootOk = armedRoute.root == null || (posRoot != null && posRoot === armedRoute.root);
  const acctOk = armedRoute.account_id == null || position.account_id == null
    || String(position.account_id) === String(armedRoute.account_id);
  if (rootOk && acctOk) return { ok: true, blocker: null };
  return { ok: false, blocker: "route_mismatch" };
}

// Stop coverage: the closing-side working stop(s) must at least cover the
// position qty. Zero closing stops → no_protective_stop. Known qty that falls
// short → stop_undercovers. Unknown qty (paper feed) counts as protection
// (fail-open on size only, so a bracketed paper position is not false-alarmed).
export function checkStopCoverage({ orders, position } = {}) {
  if (!position) return { ok: true, blocker: null };
  const closeSide = exitSideOf(position.side);
  const stops = (orders || []).filter((o) => o && o.kind === "stop");
  const closingStops = stops.filter((o) => { const s = sideKey(o.side); return s == null || s === closeSide; });
  if (closingStops.length === 0) return { ok: false, blocker: "no_protective_stop" };
  const posQty = Number(position.qty) || 0;
  const coveredQty = closingStops.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);
  if (posQty > 0 && coveredQty > 0 && coveredQty < posQty) return { ok: false, blocker: "stop_undercovers" };
  return { ok: true, blocker: null };
}

// Stop side: a long's protective sell-stop sits BELOW price; a short's buy-stop
// sits ABOVE. A stop on the wrong side of price doesn't protect. Only evaluated
// when both price and the stop price are known.
export function checkStopSide({ orders, position, price } = {}) {
  if (!position || price == null) return { ok: true, blocker: null };
  const closeSide = exitSideOf(position.side);
  const stops = (orders || [])
    .filter((o) => o && o.kind === "stop" && sideKey(o.side) === closeSide && Number.isFinite(Number(o.price)));
  if (!stops.length) return { ok: true, blocker: null }; // coverage owns "no stop"
  const isLong = sideKey(position.side) === "buy";
  for (const s of stops) {
    const sp = Number(s.price);
    if (isLong && !(sp < price)) return { ok: false, blocker: "stop_wrong_side" };
    if (!isLong && !(sp > price)) return { ok: false, blocker: "stop_wrong_side" };
  }
  return { ok: true, blocker: null };
}

// Exits cannot reverse: no single closing-side working order may exceed the
// position qty (a fill would overshoot and open the opposite side). OCO siblings
// at full size are fine — only a per-order overshoot is a reversal risk.
export function checkExitsCannotReverse({ orders, position } = {}) {
  if (!position) return { ok: true, blocker: null };
  const posQty = Number(position.qty) || 0;
  if (posQty <= 0) return { ok: true, blocker: null };
  const closeSide = exitSideOf(position.side);
  for (const o of (orders || [])) {
    if (!o || sideKey(o.side) !== closeSide) continue;
    if ((Number(o.qty) || 0) > posQty) return { ok: false, blocker: "exit_can_reverse" };
  }
  return { ok: true, blocker: null };
}

// Auth (Tradovate only). Detect-and-surface: a 401, a null token, or a stale
// last-seen means the token is gone. There is NO refresh path — the operator
// re-sniffs by opening the Tradovate panel. NEVER a reason to flatten.
export function checkAuth({ token, lastReadStatus, lastSeenMs, now, maxStaleMs } = {}) {
  if (lastReadStatus === "http_401" || lastReadStatus === 401) return { ok: false, blocker: "auth_expired" };
  if (token == null || token === "") return { ok: false, blocker: "auth_expired" };
  if (lastSeenMs != null && Number.isFinite(maxStaleMs) && now != null && (now - lastSeenMs) > maxStaleMs) {
    return { ok: false, blocker: "auth_expired" };
  }
  return { ok: true, blocker: null };
}

// Journal vs broker size. Null journal (no open trade recorded) → nothing to
// compare. Non-finite either side → fail closed.
export function checkQtyAgree({ journalQty, position } = {}) {
  if (!position || journalQty == null) return { ok: true, blocker: null };
  const jq = Number(journalQty);
  const bq = Number(position.qty);
  if (!Number.isFinite(jq) || !Number.isFinite(bq)) return { ok: false, blocker: "qty_mismatch" };
  return jq === bq ? { ok: true, blocker: null } : { ok: false, blocker: "qty_mismatch" };
}

// evaluateProtection — the full pure verdict. Precedence:
//   1. auth loss / unreadable-or-stale broker → AUTH_EXPIRED / UNKNOWN first
//      (never look at the position on an untrustworthy read).
//   2. no position → NO_POSITION (entries allowed).
//   3. no protective stop OUTRANKS every other protective breach.
//   4. a lone size disagreement → CRITICAL_QTY_MISMATCH; any other breach (route
//      / side / undercover / reverse, alone or combined) → RECOVERY_REQUIRED.
export function evaluateProtection(inputs = {}) {
  const {
    brokerRead, orders, journalQty, armedRoute, price, auth, now,
    maxAuthStaleMs = 120000, maxEvidenceAgeMs = 120000,
  } = inputs;
  const evidence = {
    broker_ok: brokerRead?.ok === true,
    broker_open: brokerRead?.ok === true && brokerRead?.position != null,
    evidence_age_ms: brokerRead?.evidence_age_ms ?? null,
    account_id: brokerRead?.account_id ?? null,
    orders_count: Array.isArray(orders) ? orders.length : 0,
    armed_route: armedRoute ?? null,
  };

  // 1a. Auth (Tradovate only — auth is null for paper). Loud pause, never flat.
  if (auth) {
    const a = checkAuth({ ...auth, now, maxStaleMs: maxAuthStaleMs });
    if (!a.ok) return { ok: false, state: AUTH_EXPIRED, blockers: ["auth_expired"], evidence };
  }
  // 1b. Unreadable / stale broker read — never infer flat.
  const fresh = checkFreshness({ evidenceAgeMs: brokerRead?.evidence_age_ms, maxAgeMs: maxEvidenceAgeMs, brokerOk: brokerRead?.ok });
  if (!fresh.ok) return { ok: false, state: UNKNOWN, blockers: [fresh.blocker], evidence };

  // 2. Broker confirmed readable.
  const position = brokerRead.position ?? null;
  if (position == null) return { ok: true, state: NO_POSITION, blockers: [], evidence };

  // 3. Position present. no_protective_stop is the most urgent — it outranks all.
  const coverage = checkStopCoverage({ orders, position });
  if (coverage.blocker === "no_protective_stop") {
    return { ok: false, state: CRITICAL_NO_STOP, blockers: ["no_protective_stop"], evidence };
  }
  const blockers = [];
  const route = checkRouteMatch({ position, armedRoute });
  if (!route.ok) blockers.push(route.blocker);
  const side = checkStopSide({ orders, position, price });
  if (!side.ok) blockers.push(side.blocker);
  if (coverage.blocker === "stop_undercovers") blockers.push("stop_undercovers");
  const reverse = checkExitsCannotReverse({ orders, position });
  if (!reverse.ok) blockers.push(reverse.blocker);
  const qty = checkQtyAgree({ journalQty, position });
  if (!qty.ok) blockers.push(qty.blocker);

  if (blockers.length === 0) return { ok: true, state: PROTECTED, blockers: [], evidence };
  if (blockers.length === 1 && blockers[0] === "qty_mismatch") {
    return { ok: false, state: CRITICAL_QTY_MISMATCH, blockers, evidence };
  }
  return { ok: false, state: RECOVERY_REQUIRED, blockers, evidence };
}

// ── Confirm-then-act debounce ───────────────────────────────────────────────
function classifyState(state) {
  if (state === PROTECTED || state === NO_POSITION) return "clear";
  if (state === UNKNOWN || state === AUTH_EXPIRED) return "ambiguous";
  return "breach"; // CRITICAL_NO_STOP / CRITICAL_QTY_MISMATCH / RECOVERY_REQUIRED
}

// planWatchdogAction — one breach read is not enough to intervene. A confirmed
// breach requires `confirmThreshold` CONSECUTIVE reads of the SAME breach state.
// A single ambiguous read (UNKNOWN / AUTH_EXPIRED) pauses entries fail-closed but
// resets the breach counter and never counts toward confirmation (and never
// triggers an intervention). No path here ever emits a flatten action.
export function planWatchdogAction({ prev, current, confirmThreshold = 2 } = {}) {
  const curState = current?.state ?? null;
  const cls = classifyState(curState);
  if (cls === "clear") return { action: "clear", confirmed: false, consecutive: 0 };
  if (cls === "ambiguous") return { action: "pause_entries", confirmed: false, consecutive: 0 };
  // breach — count consecutive identical-state breach reads.
  const prevState = prev?.state ?? null;
  const carried = classifyState(prevState) === "breach" && prevState === curState ? (prev?.consecutive || 0) : 0;
  const consecutive = carried + 1;
  if (consecutive >= confirmThreshold) return { action: "recovery_required", confirmed: true, consecutive };
  return { action: "pause_entries", confirmed: false, consecutive };
}

// interventionRecord — the durable protection-watchdog.jsonl row for a confirmed
// breach.
export function interventionRecord({ result, position, action, now = Date.now() } = {}) {
  return {
    ts: new Date(now).toISOString(),
    state: result?.state ?? null,
    blockers: result?.blockers ?? [],
    evidence: result?.evidence ?? null,
    action: action ?? null,
    position: position
      ? { symbol: position.symbol ?? null, side: position.side ?? null, qty: position.qty ?? null }
      : null,
    evidence_age_ms: result?.evidence?.evidence_age_ms ?? null,
    account_id: result?.evidence?.account_id ?? null,
  };
}

// protectionReadiness — pure readiness verdict for health.js / the supervisor.
// protectionOk false is itself a block; a watchdog that has gone quiet (no tick
// in > 2× interval) WHILE a position is open is a block too ("watchdog failure
// is a readiness blocker" — a dead watchdog leaves a live position unwatched).
export function protectionReadiness({ protectionOk, state, tickAgeMs, intervalMs = 15000 } = {}) {
  const positionExists = [PROTECTED, CRITICAL_NO_STOP, CRITICAL_QTY_MISMATCH, RECOVERY_REQUIRED].includes(state);
  if (protectionOk === false) return { blocked: true, blocker: "protection_unhealthy" };
  if (positionExists && tickAgeMs != null && tickAgeMs > 2 * intervalMs) {
    return { blocked: true, blocker: "watchdog_stale" };
  }
  return { blocked: false, blocker: null };
}

// ── DI runtime ──────────────────────────────────────────────────────────────
// createProtectionWatchdog(deps) → { tick, getState }. One tick: gather the
// fail-closed reads, run the pure verdict, debounce, drive the gate + surfaces.
// A thrown tick is caught and fails closed (pause entries + surface) — it NEVER
// flattens and NEVER throws out.
export function createProtectionWatchdog(deps = {}) {
  const confirmThreshold = deps.confirmThreshold ?? 2;
  const now = deps.now || Date.now;
  let prev = { state: null, consecutive: 0 };
  let last = null;             // last full evaluate result
  let lastBreachKey = null;    // dedupe repeated identical confirmed breaches

  async function tick() {
    try {
      const brokerRead = deps.readBroker ? await deps.readBroker() : { ok: false, position: null };
      // Fold the read's account_id onto the position so route matching can see it.
      let position = brokerRead?.position ?? null;
      if (position && brokerRead?.account_id != null && position.account_id == null) {
        position = { ...position, account_id: brokerRead.account_id };
      }
      const readForEval = { ...brokerRead, position };
      const orders = position && deps.readOrders ? await deps.readOrders() : [];
      const journalOpen = deps.getJournalOpen ? await deps.getJournalOpen() : null;
      const journalQty = journalOpen
        ? (journalOpen.contracts ?? journalOpen.size?.contracts ?? journalOpen.qty ?? null)
        : null;
      const armedRoute = deps.getArmedRoute ? await deps.getArmedRoute() : null;
      const price = deps.getPrice ? await deps.getPrice() : null;
      const auth = deps.getAuth ? await deps.getAuth() : null; // null for paper
      const nowMs = now();

      const result = evaluateProtection({ brokerRead: readForEval, orders, journalQty, armedRoute, price, auth, now: nowMs });
      last = result;
      const plan = planWatchdogAction({ prev, current: result, confirmThreshold });
      prev = { state: result.state, consecutive: plan.consecutive };

      // The gate is open ONLY on a clear read (PROTECTED / NO_POSITION).
      deps.setProtectionOk?.(plan.action === "clear");

      if (plan.action === "clear") { lastBreachKey = null; return { result, plan }; }

      if (result.state === AUTH_EXPIRED) {
        // Detect-and-surface only. Position is never touched (fail-closed).
        deps.emitError?.({
          level: "error",
          message: `Broker AUTH lost (${(result.blockers || []).join(", ")}) — NEW entries PAUSED. Open the Tradovate panel in the webview to re-sniff a token. The open position is NOT touched (the watchdog never flattens).`,
        });
        return { result, plan };
      }

      if (plan.action === "recovery_required") {
        const key = `${result.state}:${(result.blockers || []).join(",")}`;
        if (lastBreachKey !== key) {
          lastBreachKey = key;
          await deps.recordIntervention?.(interventionRecord({ result, position, action: "recovery_required", now: nowMs }));
          deps.emitError?.({
            level: "error",
            message: `PROTECTION BREACH CONFIRMED (${result.state}: ${(result.blockers || []).join(", ")}) — NEW entries PAUSED, position HELD for operator recovery via execution:reconcile (adopt / protect / flatten). The watchdog never flattens.`,
          });
          // Hold the live intent so a restart doesn't re-place on this decision.
          await deps.recordIntentTransition?.({ state: "RECOVERY_REQUIRED", reason: result.state, blockers: result.blockers });
        }
        return { result, plan };
      }
      // pause_entries (single unconfirmed breach) — paused, but no intervention yet.
      return { result, plan };
    } catch (e) {
      try { deps.setProtectionOk?.(false); } catch { /* ignore */ }
      deps.emitError?.({
        level: "error",
        message: `Protection watchdog tick FAILED (${String(e?.message || e)}) — NEW entries PAUSED (fail-closed). No position action was taken.`,
      });
      prev = { state: UNKNOWN, consecutive: 0 };
      last = { ok: false, state: UNKNOWN, blockers: ["watchdog_tick_error"], evidence: null };
      return { error: String(e?.message || e) };
    }
  }

  return {
    tick,
    getState: () => (last ? { state: last.state, ok: last.ok, blockers: last.blockers } : null),
  };
}

// ── Module-level last state (health.js + supervisor) ────────────────────────
let _lastProtectionState = null;
let _lastWatchdogTickMs = null;
let _wdTimer = null;
export function getLastProtectionState() { return _lastProtectionState; }
export function getLastWatchdogTickMs() { return _lastWatchdogTickMs; }

export const PROTECTION_INTERVAL_MS = 15_000;

// Whether the current protection state should BLOCK a cold live arm. A confirmed
// RECOVERY_REQUIRED / AUTH_EXPIRED breach blocks; so does a dead watchdog while a
// position is open (the watchdog itself failing is a block).
export function isProtectionBlockedForArming({ now = Date.now() } = {}) {
  const state = _lastProtectionState;
  if (state === RECOVERY_REQUIRED || state === AUTH_EXPIRED) return true;
  const r = protectionReadiness({
    protectionOk: getProtectionOk(),
    state,
    tickAgeMs: _lastWatchdogTickMs ? now - _lastWatchdogTickMs : null,
    intervalMs: PROTECTION_INTERVAL_MS,
  });
  return r.blocked && r.blocker === "watchdog_stale";
}

// Production deps — mirrors buildReconcilerDeps: real broker/order/journal reads,
// the auto/manual entry gate, the B1 intent transition, and the app:error sink.
// Lazy imports only, so importing this module at boot runs nothing heavy.
let _lastAuth = { token: null, status: null, seenMs: null };
export async function buildWatchdogDeps({ send } = {}) {
  const active = await import("./active-account.js");
  const feed = await import("./trading-feed.js");
  const autoResume = await import("./auto-resume.js");
  const { readExecConfig } = await import("./config.js");

  const normalizePaperOrders = (wos) => (wos || []).map((o) => {
    const t = String(o.type ?? o.kind ?? "").toLowerCase();
    return {
      id: o.id ?? null,
      side: sideKey(o.side ?? o.action),
      kind: t.includes("stop") ? "stop" : (t.includes("limit") ? "limit" : "other"),
      price: Number(o.price ?? o.stopPrice ?? o.limitPrice) || null,
      qty: Number(o.qty ?? o.orderQty ?? o.size) || null,
    };
  });

  return {
    readBroker: async () => {
      try {
        const broker = active.getActiveAccount()?.broker ?? null;
        if (broker === "tradovate") {
          const { readTradovatePositionSafe } = await import("./tradovate-adapter.js");
          const { getTradovate } = await import("./tradovate.js");
          const t = getTradovate();
          const r = await readTradovatePositionSafe();
          _lastAuth = {
            token: t.token ?? null,
            status: r.ok ? "ok" : (r.reason ?? "unreadable"),
            seenMs: r.ok ? Date.now() : _lastAuth.seenMs,
          };
          // Tradovate REST: read success IS freshness (no independent age signal).
          return { ok: r.ok === true, position: r.position ?? null, account_id: active.getActiveAccount()?.id ?? null, evidence_age_ms: null, broker: "tradovate" };
        }
        // Paper — the trading-WS feed is the reliable position source once it has
        // affirmatively reported a position frame; otherwise fall back to a
        // hardened DOM read (ok:false unless the table is present).
        const fs2 = feed.getTradingState();
        if (fs2.connected === true && fs2.hasReceivedPositionUpdate === true) {
          return { ok: true, position: fs2.position ?? null, account_id: fs2.accountId ?? null, evidence_age_ms: null, broker: "paper" };
        }
        const { readStateSafe } = await import("./tv-adapter.js");
        const r = await readStateSafe();
        return { ok: r.ok === true, position: r.position ?? null, account_id: fs2.accountId ?? null, evidence_age_ms: null, broker: "paper" };
      } catch { return { ok: false, position: null }; }
    },
    readOrders: async () => {
      try {
        if (active.getActiveAccount()?.broker === "tradovate") {
          const { readTradovateOrders } = await import("./tradovate-adapter.js");
          return await readTradovateOrders();
        }
        return normalizePaperOrders(feed.getTradingState().workingOrders);
      } catch { return []; }
    },
    getJournalOpen: async () => {
      try {
        const sessions = await import("../sessions.js");
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const { parseJsonlTolerant } = await import("../../../cli/lib/jsonl.js");
        const { foldOpenTrades } = await import("../../../cli/lib/trade-outcomes.js");
        const file = path.join(await sessions.activeSessionDir(), "trades.jsonl");
        const txt = await fs.readFile(file, "utf8");
        const { records, dropped } = parseJsonlTolerant(txt);
        // Corruption ⇒ synthetic non-flat marker (never let a torn journal read as
        // "no open trade", so qty checks can't false-pass on an unreadable file).
        if (dropped > 0) return { id: null, state: "corrupt", __corrupt: true };
        return foldOpenTrades(records)[0] ?? null;
      } catch { return null; }
    },
    getArmedRoute: async () => {
      try {
        const cfg = readExecConfig();
        const confirmed = cfg.confirmedAccount ?? null;
        let root = null;
        try { const { cachedOrderContext } = await import("./order-context.js"); root = tvRootOf(cachedOrderContext()?.symbol); } catch { /* no cache */ }
        return { account_id: confirmed?.id ?? active.getActiveAccount()?.id ?? null, root };
      } catch { return null; }
    },
    getPrice: async () => {
      try { const { cachedOrderContext } = await import("./order-context.js"); return cachedOrderContext()?.price ?? null; }
      catch { return null; }
    },
    getAuth: async () => {
      // Paper has no token concept → no auth check.
      if (active.getActiveAccount()?.broker !== "tradovate") return null;
      return { token: _lastAuth.token, lastReadStatus: _lastAuth.status, lastSeenMs: _lastAuth.seenMs };
    },
    now: Date.now,
    setProtectionOk: (v) => { try { autoResume.setProtectionOk(v); } catch { /* best-effort */ } },
    emitError: (o) => send?.("app:error", { source: "protection-watchdog", ...o }),
    recordIntervention: async (record) => {
      try {
        const sessions = await import("../sessions.js");
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const file = path.join(await sessions.activeSessionDir(), "protection-watchdog.jsonl");
        // Defensive leading newline so a torn tail from a prior crash can't
        // concatenate into this record (parseJsonlTolerant absorbs the blank line).
        await fs.appendFile(file, "\n" + JSON.stringify(record) + "\n", "utf8");
      } catch { /* best-effort */ }
    },
    recordIntentTransition: async ({ state, reason, blockers }) => {
      try {
        const oi = await import("./order-intent.js");
        const deps = await oi.buildRealDeps({ send });
        const { records, dropped } = await deps.readRecords();
        if (dropped > 0) return; // corrupt intent journal — never write on uncertainty
        const folded = oi.foldIntents(records);
        // Hold the latest non-terminal intent (the live position's).
        let target = null;
        for (const [id, rec] of folded) {
          const st = rec?.state;
          if (st && st !== oi.INTENT_STATES.STOP_CONFIRMED && st !== oi.INTENT_STATES.REJECTED) target = id;
        }
        if (!target) return;
        await oi.createIntentStore(deps).recordTransition({ decision_id: target, state, source: "reconcile", reason, blockers });
      } catch { /* best-effort */ }
    },
    confirmThreshold: 2,
  };
}

let _watchdogInstance = null;

// Start the always-on watchdog on its own unref'd timer (NOT bar-driven). Runs
// the whole time the app is up — a held position must be watched outside session
// windows too. Fire-and-forget; never blocks boot.
export function startProtectionWatchdog({ send, schedule } = {}) {
  return buildWatchdogDeps({ send }).then((deps) => {
    const wd = createProtectionWatchdog(deps);
    _watchdogInstance = wd;
    const runTick = async () => {
      try { await wd.tick(); } catch { /* tick fails closed internally */ }
      const st = wd.getState();
      _lastProtectionState = st?.state ?? null;
      _lastWatchdogTickMs = Date.now();
    };
    const arm = schedule || ((fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; });
    if (_wdTimer) { try { clearInterval(_wdTimer); } catch { /* ignore */ } }
    _wdTimer = arm(runTick, PROTECTION_INTERVAL_MS);
    runTick(); // initial kick
    return wd;
  }).catch(() => null);
}

export function stopProtectionWatchdog() {
  if (_wdTimer) { try { clearInterval(_wdTimer); } catch { /* ignore */ } _wdTimer = null; }
  _watchdogInstance = null;
}

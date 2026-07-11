// fixture-adapter.js — TEST-ONLY window.api shim for the deterministic Command
// Shell workflow harness (docs/plans/2026-07-09 Task D1). It builds a fake
// `window.api` from a fixture state bag so the real renderer can run under
// Playwright with NO Electron, broker, TradingView, or LLM.
//
// PRODUCTION SAFETY — what actually keeps this out of the shipped app:
//   1. window.__GOFNQ_FIXTURE__ is set ONLY by the Playwright harness (via
//      addInitScript, before any page script). The shipped app never sets it,
//      so main.jsx's guarded branch never runs in production.
//   2. This module is loaded by a DYNAMIC import, so Vite code-splits it into a
//      chunk that a production run never requests.
//   installFixtureApi()'s sentinel check is an ACCIDENT guard — it makes a
//   mis-wired call fail loudly instead of half-installing — NOT a security
//   boundary. Any code already executing in the renderer could set the global or
//   assign window.api directly; the sentinel does not defend against that. The
//   real protections are #1 and #2; the sentinel just documents intent and
//   prevents foot-guns. Importing this module has no side effects.
//
// Every `on*(cb)` subscriber returns an unsubscribe function (the hooks call
// `off?.()` in cleanup). `invoke`-style methods return resolved Promises whose
// shape matches app/preload.cjs. Un-modelled methods degrade gracefully — the
// renderer reads window.api through optional chaining everywhere.

// ── pure builders (exported for node --test; touch no globals) ───────────────

// The 11 pinned readiness rows (Readiness.helpers.js READINESS_ROW_META order),
// all green. Scenarios override with their own `readiness.rows` to show blockers.
export function defaultReadinessRows() {
  const pass = (id, reason) => ({ id, status: "pass", reason, source: "fixture", age_s: 2 });
  return [
    pass("tests", "suite green"),
    pass("running_code", "disk sha matches boot sha"),
    pass("pine", "ICT Engine V5 emitting, code-rev matches"),
    pass("detector", "bar-close fresh (2s)"),
    pass("corpus", "corpus certified"),
    pass("parity", "parity certificate valid"),
    pass("strategy_approval", "strategy approved"),
    pass("broker_account", "paper account confirmed"),
    pass("broker_reconciliation", "broker reconciled, flat"),
    pass("protective_stop", "no open position"),
    { id: "automation", status: "pass", reason: "manual mode", source: "fixture", age_s: 2 },
  ];
}

// The 8-gate backtest baseline readiness contract (Backtest.helpers.js), all
// green → NET_POSITIVE_APPROVED. Scenarios override to fail a gate.
export function defaultBacktestReadiness() {
  const gate = (id, status, reason, evidence = {}) => ({ id, status, reason, evidence });
  return {
    verdict: "NET_POSITIVE_APPROVED",
    ready: true,
    reason: "all gates green — net positive over the trusted window",
    gates: [
      gate("tests", "pass", "suite green", { failures: 0 }),
      gate("baseline", "pass", "baseline folded", { built: "2026-07-08" }),
      gate("sessions", "pass", "237 sessions", { n_sessions: 237 }),
      gate("corpus", "pass", "corpus certified", { certified: true }),
      gate("parity", "pass", "parity certificate valid", { hard_mismatches: 0 }),
      gate("net_positive", "pass", "net +42.6R", { cum_r: 42.6 }),
      gate("strategy_review", "pass", "strategy reviewed", { reviewer: "gxofnq" }),
      gate("user_approval", "pass", "approved", { approved_at: "2026-07-08" }),
    ],
  };
}

// Merge the adapter defaults with a scenario's overrides (shallow at the slice
// level — a scenario supplies whole slices, never partial ones).
export function buildFixtureState(scenario = {}) {
  const s = scenario.state || scenario || {};
  return {
    automationMode: s.automationMode || "manual",
    health: s.health || { loop: "healthy", cdp: "up", heartbeat_age_s: 2 },
    executionState: s.executionState || { connected: true, position: null, workingOrders: [], balance: null },
    execStaleAfter: Number.isFinite(s.execStaleAfter) ? s.execStaleAfter : null,
    orderIntents: s.orderIntents || { records: [], dropped: 0, reconcile: null },
    brief: s.brief || null,
    briefsBySymbol: s.briefsBySymbol || {},
    session: s.session || null,
    setupCurrent: s.setupCurrent || {},
    tradeList: s.tradeList || { open: [], events: [] },
    fills: s.fills || [],
    readiness: s.readiness || { rows: defaultReadinessRows() },
    backtestReadiness: s.backtestReadiness || defaultBacktestReadiness(),
    review: s.review || { journal: null, sessions: [], library: [] },
    lastBar: s.lastBar || { close: 21510, time: Date.now() },
    account: s.account || { type: "paper", broker: "TradingView Paper", id: "PAPER" },
    calendar: s.calendar || { events: [] },
    version: s.version || { boot_sha: "fixture", disk_sha: "fixture", origin_sha: "fixture", behind: 0 },
    quoteCache: s.quoteCache || {},
  };
}

// A subscription registry that mirrors the real preload's on*(cb) semantics:
// SUBSCRIBING IS PASSIVE — it only registers a listener, it never invokes cb.
// (The real preload does `ipcRenderer.on(...)`; events arrive later from main.)
// This is load-bearing: a hook that re-subscribes on every render is harmless in
// production, but an emitter that fired `initial` on each subscribe would loop
// (subscribe → cb → setState → re-render → subscribe → …). So delivery is driven
// by a timer to whatever listeners are registered, decoupled from subscription.
function makeEmitter(initial, { repeatMs = 0 } = {}) {
  const listeners = new Set();
  const push = () => { for (const cb of [...listeners]) { try { cb(initial); } catch { /* ignore */ } } };
  if (initial !== undefined) {
    // unref() so these timers never keep a Node process alive (the pure builders
    // are unit-tested under `node --test`); it's a no-op in the browser, where
    // the timers still fire and keep useHealth freshness live.
    const t = setTimeout(push, 30);             // one prompt delivery to early subscribers
    if (t && typeof t.unref === "function") t.unref();
    if (repeatMs > 0) {
      const iv = setInterval(push, repeatMs);   // keep time-based freshness (useHealth _recv_at) live
      if (iv && typeof iv.unref === "function") iv.unref();
    }
  }
  return (cb) => {
    if (typeof cb !== "function") return () => {};
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };
}

// Build the fake window.api object from a fixture state bag. Pure — returns a
// plain object, mutates nothing global. Exported for node --test.
export function buildFixtureApi(scenario = {}) {
  const st = buildFixtureState(scenario);
  const calls = { flatten: [], accept: [], reject: [], reconcile: [], placeManual: [], place: [], config: [] };

  // execution.state: usually resolves ok; when execStaleAfter is set it returns
  // ok for the first N calls (stamping the position) then fails, so the
  // useExecutionState stale timer (>6s) trips while the last-known position is
  // kept — the "feed goes stale while a position exists" scenario.
  let stateCalls = 0;
  const execState = async () => {
    stateCalls += 1;
    if (st.execStaleAfter != null && stateCalls > st.execStaleAfter) {
      return { ok: false, error: "broker read timed out (fixture)" };
    }
    return { ok: true, state: st.executionState };
  };

  const record = (bucket, payload) => { calls[bucket].push(payload); return { ok: true, ...payload }; };

  return {
    __fixtureCalls: calls, // harness introspection only

    claude: { onActivity: makeEmitter(undefined) },
    chat: {
      send: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      reset: async () => ({ ok: true }),
      onChunk: makeEmitter(undefined),
      onToolCall: makeEmitter(undefined),
      onTurnComplete: makeEmitter(undefined),
      onQueued: makeEmitter(undefined),
      onQueueReady: makeEmitter(undefined),
    },
    trade: {
      accept: async (setup) => record("accept", { trade: { id: setup?.id || "fx-trade", decision_id: "fx-dec" } }),
      reject: async (setupId, reason) => record("reject", { setupId, reason }),
      list: async () => ({ ok: true, open: st.tradeList.open || [], events: st.tradeList.events || [] }),
      onAccepted: makeEmitter(undefined),
      onRejected: makeEmitter(undefined),
      onOutcome: makeEmitter(undefined),
    },
    bar: { onClose: makeEmitter(undefined) },
    shellKeys: { onKey: makeEmitter(undefined) },
    health: { onUpdate: makeEmitter(st.health, { repeatMs: 3000 }) },
    detector: { start: async () => ({ ok: true }), stop: async () => ({ ok: true }) },
    tv: { relaunch: async () => ({ ok: true, already: true }) },
    journal: { note: async () => ({ ok: true }), day: async () => ({ ok: true }), onClose: makeEmitter(undefined) },
    supervisor: { nudge: async () => ({ ok: true }) },
    fixtures: {
      list: async () => ({ ok: true, fixtures: [] }),
      run: async () => ({ ok: true }),
      runAll: async () => ({ ok: true }),
      expected: async () => ({ ok: true, expected: "" }),
    },
    execution: {
      state: execState,
      fills: async () => ({ ok: true, fills: st.fills || [] }),
      place: async (p) => record("place", { ...p }),
      placeManual: async (p) => record("placeManual", { ...p, preview: { contracts: 1 } }),
      flatten: async (p) => { calls.flatten.push(p || {}); return { ok: true, realized: 0 }; },
      panic: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      moveStopToBE: async () => ({ ok: true }),
      trail: async () => ({ ok: true }),
      orderPreview: async () => ({ ok: true, contracts: 1, actualRisk: 120 }),
      guardState: async () => ({ ok: true, trades: 0, consecLosses: 0, dailyLoss: 0 }),
      reconcile: async (opts) => { calls.reconcile.push(opts || {}); return { ok: true, state: "HEALTHY" }; },
      orderIntents: async () => ({
        ok: true,
        records: st.orderIntents.records || [],
        dropped: st.orderIntents.dropped || 0,
        reconcile: st.orderIntents.reconcile ?? null,
      }),
      config: {
        get: async () => ({ ok: true, config: { automationMode: st.automationMode } }),
        set: async (patch) => { calls.config.push(patch); if (patch?.automationMode) st.automationMode = patch.automationMode; return { ok: true }; },
      },
      account: {
        get: async () => ({ ok: true, ...st.account }),
        confirm: async () => ({ ok: true }),
        resumeAuto: async () => ({ ok: true }),
        revertSim: async () => ({ ok: true }),
      },
    },
    walkers: { onState: makeEmitter(undefined) },
    deterministic: { onPacket: makeEmitter(undefined) },
    alert: {
      arm: async () => ({ ok: true }),
      disarm: async () => ({ ok: true }),
      onFired: makeEmitter(undefined),
      onState: makeEmitter({ armed: [] }),
      state: async () => ({ ok: true, armed: [] }),
    },
    prep: {
      get: async () => ({ ok: true, session: st.session, brief: st.brief, briefsBySymbol: st.briefsBySymbol }),
      refresh: async () => ({ ok: true }),
      recap: async () => ({ ok: true }),
      priorBrief: async () => ({ ok: true, brief: null }),
      resetPairDecision: async () => ({ ok: true }),
      openReaction: async () => ({ ok: true, reads: [], latest: null, ltf: null }),
      onUpdated: makeEmitter(undefined),
      onStatus: makeEmitter(undefined),
    },
    setups: {
      list: async () => ({ ok: true, setups: [] }),
      current: async () => ({ ok: true, ...st.setupCurrent }),
      clear: async () => ({ ok: true }),
    },
    review: {
      listSessions: async () => ({ ok: true, sessions: st.review.sessions || [] }),
      journal: async () => ({ ok: true, journal: st.review.journal }),
      library: async () => ({ ok: true, rows: st.review.library || [] }),
      exportSession: async () => ({ ok: true }),
      // current_hash matches the fixture coach's frontmatter digest_hash so the
      // card renders FRESH (no stale badge) in the harness. A fixture that wants
      // to exercise the stale path sets st.review.coachCurrentHash to differ.
      coach: async () => ({ ok: true, coach: st.review.coach ?? null, current_hash: st.review.coachCurrentHash ?? "9a1b2c3d" }),
      generateCoach: async () => ({ ok: true, coach: st.review.coach ?? null, digest_hash: "9a1b2c3d" }),
    },
    memory: { read: async () => ({ ok: true, user: "", memory: "" }) },
    usage: { today: async () => ({ ok: true, byPurpose: {}, byModel: {}, total_cost_usd: 0 }) },
    status: { lastBar: async () => ({ ok: true, bar: st.lastBar }) },
    quote: { cache: async () => ({ ok: true, cache: st.quoteCache }) },
    files: {
      list: async () => ({ ok: true, files: [] }),
      open: async () => ({ ok: true }),
      reveal: async () => ({ ok: true }),
      read: async () => ({ ok: true, content: "" }),
    },
    error: { onError: makeEmitter(undefined) },
    calendar: { thisWeek: async () => ({ ok: true, events: st.calendar.events || [] }), onUpdate: makeEmitter(undefined) },
    version: { get: async () => ({ ok: true, ...st.version }), onUpdate: makeEmitter(undefined) },
    readiness: { get: async () => ({ ok: true, readiness: st.readiness }) },
    backtest: {
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      decision: async () => ({ ok: true }),
      list: async () => ({ ok: true, runs: [] }),
      get: async () => ({ ok: true, run: null }),
      delete: async () => ({ ok: true }),
      status: async () => ({ ok: true, running: false, session: null }),
      onEvent: makeEmitter(undefined),
      baseline: {
        get: async () => ({ ok: true, baseline: null, readiness: st.backtestReadiness }),
        refold: async () => ({ ok: true, baseline: null, readiness: st.backtestReadiness }),
        history: async () => ({ ok: true, history: [] }),
        readiness: async () => ({ ok: true, readiness: st.backtestReadiness }),
      },
      tests: {
        list: async () => ({ ok: true, tests: [] }),
        run: async () => ({ ok: true }),
        get: async () => ({ ok: true, test: null }),
        verdict: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
      },
    },
  };
}

// Install the fixture api onto window. Accident guard (not a security boundary —
// see the header): the sentinel handed in must be the exact object the harness
// injected on window.__GOFNQ_FIXTURE__ and carry __isGofnqFixtureHarness===true,
// so a mis-wired call fails loudly instead of half-installing. This module is
// test-only; production keeps it out via the dynamic-import split + the global
// never being set.
export function installFixtureApi(sentinel) {
  const g = typeof window !== "undefined" ? window : undefined;
  const ok = !!g
    && g.__GOFNQ_FIXTURE__ === sentinel
    && !!sentinel
    && sentinel.__isGofnqFixtureHarness === true;
  if (!ok) {
    throw new Error(
      "fixture-adapter: refusing to install — the harness sentinel is absent. " +
      "This module is test-only and must never activate in production."
    );
  }
  g.api = buildFixtureApi(sentinel);
  if (sentinel.crashPage) g.__GOFNQ_FIXTURE_CRASH__ = sentinel.crashPage;
  return g.api;
}

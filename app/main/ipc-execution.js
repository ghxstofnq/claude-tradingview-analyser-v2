// app/main/ipc-execution.js
// execution:* IPC. Place/flatten/panic run guardrails first (place), then route
// by active broker (Tradovate REST or TV paper adapter) and place live; state
// reads stay read-only. Adapter/guardrail failures return as structured results
// rather than throwing across IPC.
import { ipcMain } from "electron";
import { tvAdapter } from "./execution/tv-adapter.js";
import { checkOrder, openLossFromUpnl } from "./execution/guardrails.js";
import { readFills, dayRealizedLossUsd, dayTradeCount, dayConsecutiveLossStreak, buildDayState, readAllFills } from "./execution/fills.js";
import { getTradingState } from "./execution/trading-feed.js";
import { TRADES_DIR, readExecConfig, writeExecConfig } from "./execution/config.js";
import { getActiveAccount } from "./execution/active-account.js";
import { resolveAccountGate, revertSimDecision } from "./execution/account-gate.js";
import { setAutoResumed, getAutoResumed, getReconciliationHealthy, getProtectionOk } from "./execution/auto-resume.js";

function tradesDir() { return TRADES_DIR; }
function today() { return new Date().toISOString().slice(0, 10); }

// B1: wrap a broker POST in a durable order-intent record. `base` carries the
// decision_id + order fields; we log INTENT_CREATED → SUBMITTING before the POST
// and classify the result after (acknowledged / rejected / ambiguous→recovery).
// Best-effort: an intent-write failure never blocks the order or throws across IPC.
async function withOrderIntent(base, place) {
  const oi = await import("./execution/order-intent.js");
  const store = oi.createIntentStore(await oi.buildRealDeps());
  const rec = async (state, extra) => { try { await store.recordTransition({ ...base, state, ...(extra || {}) }); } catch { /* best-effort */ } };
  await rec(oi.INTENT_STATES.INTENT_CREATED);
  await rec(oi.INTENT_STATES.SUBMITTING);
  const result = await place();
  const status = result?.result?.status ?? result?.status;
  const submit = oi.classifySubmitResult({ ok: result?.ok, status });
  const terminal = submit === "acknowledged" ? oi.INTENT_STATES.BROKER_ACKNOWLEDGED
    : submit === "rejected" ? oi.INTENT_STATES.REJECTED
    : oi.INTENT_STATES.RECOVERY_REQUIRED;
  await rec(terminal, { status });
  return result;
}

// Snapshot of the account-arming state for the renderer.
function accountState() {
  const active = getActiveAccount();
  const confirmed = readExecConfig().confirmedAccount;
  return { active, confirmed, gate: resolveAccountGate({ active, confirmed }), autoResumed: getAutoResumed() };
}

// Current open drawdown ($, positive) for the predictive daily-loss gate.
// Best-effort: reads existing position sources only (no broker writes) and any
// failure degrades to 0, so the gate falls back to realized + risk rather than
// throwing on the fire path. Tradovate position carries uPnlUsd via its REST
// read; TV paper carries it on the DOM/feed position. (audit Phase 3)
async function openLossUsdNow() {
  try {
    let pos = getTradingState().position ?? null;
    if (getActiveAccount()?.broker === "tradovate") {
      const { readTradovatePosition } = await import("./execution/tradovate-adapter.js");
      pos = (await readTradovatePosition()) ?? pos;
    } else if (pos?.uPnlUsd == null) {
      pos = (await tvAdapter.readState())?.position ?? pos;
    }
    return openLossFromUpnl(pos?.uPnlUsd);
  } catch { return 0; }
}

// Is a position open on the RIGHT source for a given broker? A Tradovate
// position lives only in its REST read; TV paper/live lives on the WS feed
// (getTradingState). Returns true/false, or null on a read error (caller treats
// null as "unknown" → fail-closed). Mirrors openLossUsdNow's Tradovate branch.
async function positionOpenFor(broker) {
  try {
    if (broker === "tradovate") {
      const { readTradovatePosition } = await import("./execution/tradovate-adapter.js");
      return !!(await readTradovatePosition());
    }
    return !!getTradingState().position;
  } catch { return null; }
}

async function guarded(payload) {
  // B3: the continuous protection watchdog owns the entry pause. If it has seen
  // an unprotected / breached / unreadable / auth-lost position, NO new order
  // (manual OR auto) is placed until protection clears — fail-closed at the
  // handler layer, ahead of every other guard. Recovery is the operator's job
  // via execution:reconcile (adopt / protect / flatten); the watchdog never
  // flattens. Defaults open (a no-position boot never blocks manual trading).
  if (getProtectionOk() === false) {
    return { ok: false, blocked: true, code: "RECOVERY_REQUIRED", reason: "protection_watchdog", message: "Entries PAUSED — protection watchdog flagged an unprotected/breached position. Resolve via execution:reconcile before placing new orders." };
  }
  // Fail-closed on a real trade-store read error: block rather than gate on
  // degraded counts (readFills returns [] for a legitimately-absent file, so a
  // throw here means a genuine fs problem).
  let fills;
  try { fills = readFills(tradesDir(), today()); }
  catch { return { ok: false, code: "FILLS_UNREADABLE", message: "Trade store unreadable — blocking (fail-closed)." }; }
  // Scope the daily halt to the SPECIFIC account we'd route to (audit C14) — one
  // account's losses/count must not halt another.
  const acct = getActiveAccount();
  const account = acct?.id ? { id: acct.id, broker: acct.broker ?? null } : null;
  // Count the currently-open (uncounted-until-close) entry against maxTrades,
  // read from the broker's real source (Tradovate REST, not the TV WS feed).
  // true or null(unknown) ⇒ count it (fail-closed); only a confirmed-flat ⇒ 0.
  const openNow = (await positionOpenFor(acct?.broker)) === false ? 0 : 1;
  const dayState = buildDayState({ fills, account, openNow, openLossUsd: await openLossUsdNow() });
  // Server-authoritative guards: NEVER trust renderer-supplied guards on the fire
  // path (closes the execution:place fail-open). Sizing/hasStop still describe the
  // specific order and ride the payload.
  return checkOrder({ hasStop: payload?.hasStop, sizing: payload?.sizing, guards: readExecConfig().guards, dayState });
}

export function registerExecutionIpc() {
  // First-run seed: trust the active PAPER account so paper routing works out of
  // the box. Never auto-seeds a live account — a switch into live always needs a
  // deliberate confirm.
  try {
    const cfg = readExecConfig();
    if (cfg.confirmedAccount == null) {
      const active = getActiveAccount();
      if (active && active.type === "paper") writeExecConfig({ confirmedAccount: active });
    }
  } catch { /* best-effort seed */ }

  // Account arming: read active/confirmed + gate; confirm a switch; resume live
  // auto after a restart.
  ipcMain.handle("execution:account", async () => {
    try { return { ok: true, ...accountState() }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle("execution:confirmAccount", async (_e, arg = {}) => {
    try {
      const active = getActiveAccount();
      if (!active) return { ok: false, error: "no_active_account" };
      const gate = resolveAccountGate({ active, confirmed: readExecConfig().confirmedAccount });
      // A switch into a live account requires the deliberate type-"LIVE" gate.
      if (gate.level === "live" && arg?.typed !== "LIVE") return { ok: false, error: "live_confirm_requires_typed_LIVE" };
      writeExecConfig({ confirmedAccount: active });
      return { ok: true, ...accountState() };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle("execution:resumeAuto", async () => {
    // B3: ack honesty — if the protection watchdog has paused entries, auto stays
    // blocked regardless, so say so instead of returning a misleading ok:true.
    // Recovery is via execution:reconcile (protect / flatten); once the next
    // watchdog tick reads clear the gate reopens and resumeAuto can proceed.
    if (getProtectionOk() === false) {
      return { ok: false, code: "PROTECTION_UNHEALTHY", reason: "protection_watchdog" };
    }
    // B2 + I-1: never resume auto until reconciliation is HEALTHY. But don't just
    // refuse (that was circular — resume required the very gate it should help
    // recover): TRIGGER a fresh reconcile first (the feed may have connected since
    // boot), then arm only if it now reports HEALTHY. Fail-closed otherwise.
    if (!getReconciliationHealthy()) {
      const reconciler = await import("./execution/reconciler.js");
      let fresh = null;
      try { fresh = await reconciler.runReconcileNow({ send: null }); } catch { /* structured below */ }
      if (!getReconciliationHealthy()) {
        return { ok: false, code: "reconciliation_pending", state: fresh?.state ?? reconciler.getLastReconcileState() };
      }
    }
    setAutoResumed(true);
    return { ok: true, autoResumed: true };
  });

  // B2: boot-reconciler surface. Thin pass-throughs to the reconciler runtime —
  // status/retry are read/re-run; adopt/protect/flatten are operator recovery
  // actions. Every branch returns a structured result and never throws across IPC.
  ipcMain.handle("execution:reconcile", async (_e, arg = {}) => {
    try {
      const reconciler = await import("./execution/reconciler.js");
      switch (arg?.action) {
        case "status":
          return { ok: true, state: reconciler.getLastReconcileState(), healthy: getReconciliationHealthy() };
        // retry + resolve-flat both re-run the reconciler; runReconcile EXECUTES
        // close_journal on a CONFIRMED-flat JOURNAL_STALE, so this is the operator
        // escape hatch for a recovery-held row that bricked auto (B-1).
        case "retry":
        case "resolve-flat": {
          const r = await reconciler.runReconcileNow({ send: null });
          return { ok: true, state: r.state, action: r.action, blockers: r.blockers, healthy: getReconciliationHealthy() };
        }
        case "adopt": return await reconciler.adoptOpenPosition({ send: null });
        case "protect": return await reconciler.protectOpenPosition({ send: null, stopPrice: arg?.stopPrice });
        case "flatten": return await reconciler.flattenOpenPosition({ send: null });
        default: return { ok: false, code: "unknown_action" };
      }
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // C3.1: RAW durable order-intent journal for the LIVE order-lifecycle
  // timeline. Returns the tolerant-parsed records + dropped count + the last
  // reconcile verdict, straight off order-intents.jsonl in the active session
  // dir. It NEVER folds, NEVER invents ages, NEVER derives a stage — the
  // renderer re-derives everything from this raw truth (#233 discipline). A
  // read error degrades to empty records (fail-closed: the timeline shows no
  // progress rather than a fabricated one), and dropped>0 propagates so the
  // renderer can block the happy path on a corrupt journal.
  ipcMain.handle("execution:orderIntents", async () => {
    try {
      const reconciler = await import("./execution/reconciler.js");
      const sessions = await import("./sessions.js");
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const { parseJsonlTolerant } = await import("../../cli/lib/jsonl.js");
      const file = path.join(await sessions.activeSessionDir(), "order-intents.jsonl");
      let records = [], dropped = 0;
      try {
        const txt = await fs.readFile(file, "utf8");
        ({ records, dropped } = parseJsonlTolerant(txt));
      } catch { /* absent journal → empty (no intents yet) */ }
      return { ok: true, records, dropped, reconcile: reconciler.getLastReconcileState() };
    } catch (e) { return { ok: false, error: String(e?.message || e), records: [], dropped: 0, reconcile: null }; }
  });

  // Revert routing to SIM: clear the live confirmation (arm a PAPER confirmed
  // account) + drop live-auto arming. A routing change, NOT a flatten — so it
  // BLOCKS when a live position is open (re-routing would strand it), unless
  // {force:true} (which returns a loud `warned`). Never places/closes an order.
  ipcMain.handle("execution:revertSim", async (_e, arg = {}) => {
    try {
      const active = getActiveAccount();
      const cfg = readExecConfig();
      const confirmed = cfg.confirmedAccount;
      const revertingFromLive = confirmed?.type === "live" || active?.broker === "tradovate";
      let positionOpen = false;
      if (revertingFromLive && arg?.force !== true) {
        // Key the read on the account we're reverting FROM, not just the current
        // active one: a Tradovate live position lives in its REST read even after
        // the on-screen active account has diverged to paper (a 12s traffic lull
        // flips active.broker). Either confirmed OR active being tradovate ⇒ read
        // Tradovate. positionOpenFor returns null on a read error → decision blocks.
        const revertBroker = (confirmed?.broker === "tradovate" || active?.broker === "tradovate") ? "tradovate" : (active?.broker || null);
        positionOpen = await positionOpenFor(revertBroker);
      }
      const d = revertSimDecision({ active, confirmed, config: cfg, positionOpen, force: arg?.force === true });
      if (d.block) return { ok: false, blocked: true, reason: d.reason };
      writeExecConfig(d.writePatch);
      if (d.clearAutoResumed) setAutoResumed(false);
      return { ok: true, warned: d.warned, ...accountState() };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Automation mode + risk knobs + guardrails. The settings popover reads on
  // mount and writes on change; the main-process tranche manager reads this to
  // enforce guardrails on auto-fired orders (no ticket to attach them to).
  ipcMain.handle("execution:config", async (_e, arg = {}) => {
    try {
      if (arg?.action === "set" && arg.patch) return { ok: true, config: writeExecConfig(arg.patch) };
      return { ok: true, config: readExecConfig() };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Read-only live guard tallies + thresholds so the UI can render "trades 2/4 ·
  // consec 1/3" and pre-disable the fire button. Counts are null when the day
  // store can't be read (UI shows "—", treats as unknown — never 0).
  ipcMain.handle("execution:guardState", async () => {
    try {
      const guards = readExecConfig().guards || {};
      let fills; try { fills = readFills(tradesDir(), today()); } catch { fills = null; }
      const acct = getActiveAccount();
      const account = acct?.id ? { id: acct.id, broker: acct.broker ?? null } : null;
      const openNow = (await positionOpenFor(acct?.broker)) === false ? 0 : 1;
      const ok = Array.isArray(fills);
      return {
        ok: true, guards,
        tradeCount: ok ? dayTradeCount(fills, account) + openNow : null,
        consecLosses: ok ? dayConsecutiveLossStreak(fills, account) : null,
        realizedLossUsd: ok ? dayRealizedLossUsd(fills, account) : null,
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ORDERS popover — manual market-order ticket. orderContext pulls fresh
  // structure + price (cached); orderPreview is pure over the cache; placeManual
  // re-fetches fresh, re-validates, runs guardrails, and places to the confirmed
  // account. All math lives here (single source of truth).
  ipcMain.handle("execution:orderContext", async (_e, arg = {}) => {
    try {
      const { getOrderContext } = await import("./execution/order-context.js");
      return { ok: true, context: await getOrderContext(arg) };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle("execution:orderPreview", async (_e, arg = {}) => {
    try {
      const { cachedOrderContext } = await import("./execution/order-context.js");
      const { buildOrderPreview } = await import("./execution/manual-order.js");
      const ctx = cachedOrderContext();
      if (!ctx) return { ok: false, error: "no_context" };
      const guards = readExecConfig().guards || {};
      const riskUsd = arg.riskUsd ?? guards.defaultRisk ?? 120;
      const preview = buildOrderPreview({ side: arg.side, entry: ctx.price, symbol: ctx.symbol, candidates: ctx.candidates, fvgs: ctx.fvgs, draws: ctx.draws, typedStop: arg.typedStop, typedTp: arg.typedTp, riskUsd, maxRiskUsd: guards.perTradeMax });
      return { ok: true, preview, context: ctx };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle("execution:placeManual", async (_e, arg = {}) => {
    try {
      const { getOrderContext } = await import("./execution/order-context.js");
      const { buildOrderPreview } = await import("./execution/manual-order.js");
      // Re-read the webview chart fresh before placing, so the order always
      // matches the instrument + structure currently on screen.
      const ctx = await getOrderContext();
      const guards = readExecConfig().guards || {};
      const riskUsd = arg.riskUsd ?? guards.defaultRisk ?? 120;
      const preview = buildOrderPreview({ side: arg.side, entry: ctx.price, symbol: ctx.symbol, candidates: ctx.candidates, fvgs: ctx.fvgs, draws: ctx.draws, typedStop: arg.typedStop, typedTp: arg.typedTp, riskUsd, maxRiskUsd: guards.perTradeMax });
      if (preview.block) return { ok: false, blocked: true, code: preview.block, preview };
      const gate = await guarded({ hasStop: preview.stop != null, sizing: { withinTolerance: preview.withinTolerance, contracts: preview.contracts, actualRisk: preview.actualRiskUsd }, guards: readExecConfig().guards });
      if (!gate.ok) return { ok: false, blocked: true, ...gate, preview };

      // Route by the active broker. Tradovate orders go to its own REST API
      // (Bearer-token + bracket-in-the-POST); paper uses the TV paper adapter.
      const active = getActiveAccount();
      // B1: durable order-intent around the manual ticket. decision_id folds the
      // ticket key (id if present, else symbol|side|entry|stop) with the account.
      const { deriveDecisionId } = await import("./execution/order-intent.js");
      const decisionId = deriveDecisionId({
        packetId: arg.id ?? `${ctx.symbol}|${arg.side}|${preview.entry ?? ctx.price}|${preview.stop}`,
        accountId: active?.id ?? null, session: null,
        side: arg.side, entry: preview.entry ?? ctx.price, stop: preview.stop,
      });
      const intentBase = { decision_id: decisionId, account_id: active?.id ?? null, broker: active?.broker ?? "paper", side: arg.side, symbol: ctx.symbol, entry: preview.entry ?? ctx.price, stop: preview.stop, contracts: preview.contracts, source: "manual" };
      if (active?.broker === "tradovate") {
        const acctGate = resolveAccountGate({ active, confirmed: readExecConfig().confirmedAccount });
        if (!acctGate.route) return { ok: false, blocked: true, code: "confirm_tradovate", preview, gate: acctGate };
        const { placeTradovateOrder } = await import("./execution/tradovate-adapter.js");
        const result = await withOrderIntent(intentBase, () => placeTradovateOrder({
          symbol: ctx.symbol,
          side: arg.side, type: "market", contracts: preview.contracts,
          stopLoss: preview.stop, takeProfit: preview.tp ?? undefined,
          currentAsk: ctx.price, currentBid: ctx.price,
        }));
        return { ok: !!result.ok, broker: "tradovate", result, preview };
      }

      const result = await withOrderIntent(intentBase, () => tvAdapter.placeOrder({ symbol: ctx.symbol, side: arg.side, type: "market", entry: ctx.price, stop: preview.stop, tp: preview.tp ?? undefined, contracts: preview.contracts }));
      // Reflect the broker's actual HTTP result (mirrors the Tradovate path) —
      // a non-200 POST must not report ok:true / "ORDER SENT".
      return { ok: !!result?.ok, broker: "paper", result, preview };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  ipcMain.handle("execution:fills", async (_e, arg = {}) => {
    try {
      const date = arg?.date || today();
      const fills = date === "all" ? readAllFills(tradesDir()) : readFills(tradesDir(), date);
      return { ok: true, date, fills };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  ipcMain.handle("execution:state", async () => {
    try {
      // Prefer the live trading-WS feed (reliable; DOM goes stale when the
      // panel is collapsed). Fall back to the DOM read for connection/account
      // when the feed hasn't connected yet.
      const feed = getTradingState();
      const dom = await tvAdapter.readState();
      let position = feed.position ?? dom.position ?? null;
      let account = dom.account ?? feed.accountId ?? null;
      let tvOrders = null;
      // Tradovate position + working orders come from its REST API (the WS feed
      // is TV-paper-only). Surface the position so IN-TRADE/ORDERS show it +
      // Flatten enables; surface the working orders so IN-TRADE can show the
      // bracket's Stop / TP1 (the position object alone carries neither).
      if (feed.activeBroker === "tradovate") {
        try {
          const { readTradovatePosition, readTradovateOrders } = await import("./execution/tradovate-adapter.js");
          const tpos = await readTradovatePosition();
          if (tpos) position = tpos;
          tvOrders = await readTradovateOrders();
          account = feed.tradovate?.accountId ?? account;
        } catch { /* best-effort */ }
      }
      const state = {
        connected: feed.connected || dom.connected,
        account,
        position,
        balance: feed.balance ?? dom.balance ?? null,
        price: dom.price ?? null,
        workingOrders: tvOrders ?? feed.workingOrders ?? [],
        source: feed.position != null || feed.connected ? "ws" : "dom",
        // Tradovate broker (sniffed from the webview's REST traffic).
        activeBroker: feed.activeBroker ?? "paper",
        tradovate: feed.tradovate ?? null,
        // C5 ruling 2: main-sourced read timestamp so the renderer's freshness
        // chips age the position/orders/price against when MAIN actually read
        // the broker — not against a renderer round-trip. The renderer's own
        // received-at stays as the separate bridge-liveness signal.
        read_at: Date.now(),
      };
      return { ok: true, state };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  ipcMain.handle("execution:place", async (_e, payload) => {
    const gate = await guarded(payload);
    if (!gate.ok) return { ok: false, blocked: true, ...gate };
    try {
      // Route by active broker, same as placeManual / flatten / panic. The
      // surfaced setup already carries its own entry/stop/tp, so place THAT
      // bracket — don't re-derive from chart structure (that's placeManual's
      // job). Without this branch the setup-accept fire path only ever hit TV
      // paper, so firing a setup while on Tradovate placed nothing.
      const active = getActiveAccount();
      // B1: durable order-intent around the surfaced-setup fire path.
      const { deriveDecisionId } = await import("./execution/order-intent.js");
      const decisionId = deriveDecisionId({
        packetId: payload?.id ?? `${payload?.symbol}|${payload?.side}|${payload?.entry}|${payload?.stop}`,
        accountId: active?.id ?? null, session: null,
        side: payload?.side, entry: payload?.entry, stop: payload?.stop,
      });
      const intentBase = { decision_id: decisionId, account_id: active?.id ?? null, broker: active?.broker ?? "paper", side: payload?.side, symbol: payload?.symbol, entry: payload?.entry, stop: payload?.stop, contracts: payload?.contracts ?? null, source: "setup" };
      if (active?.broker === "tradovate") {
        const acctGate = resolveAccountGate({ active, confirmed: readExecConfig().confirmedAccount });
        if (!acctGate.route) return { ok: false, blocked: true, code: "confirm_tradovate", gate: acctGate };
        const { placeTradovateOrder } = await import("./execution/tradovate-adapter.js");
        const { tradovateOrderArgsFromPayload } = await import("./execution/tradovate.js");
        const result = await withOrderIntent(intentBase, () => placeTradovateOrder(tradovateOrderArgsFromPayload(payload)));
        return { ok: !!result?.ok, broker: "tradovate", result };
      }
      // Paper: reflect the broker's real HTTP result — a non-200 POST must not
      // report ok:true (mirrors placeManual).
      const result = await withOrderIntent(intentBase, () => tvAdapter.placeOrder(payload));
      return { ok: !!result?.ok, broker: "paper", result };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  for (const verb of ["flatten", "panic"]) {
    ipcMain.handle(`execution:${verb}`, async (_e, payload) => {
      try {
        // Route flatten/panic to Tradovate when it's the active broker.
        // Derive ok from the broker ack — a non-200/rejected close must NOT
        // report ok:true, or the IN-TRADE failure banner (audit C34) never
        // fires and a still-open position looks flat.
        if (getActiveAccount()?.broker === "tradovate") {
          const { closeTradovatePosition } = await import("./execution/tradovate-adapter.js");
          const result = await closeTradovatePosition(payload || {});
          return { ok: result?.ok === true, broker: "tradovate", result };
        }
        const result = await tvAdapter[verb](payload);
        // Trust the adapter's body-aware ok — a TV rejection can be HTTP 200 with
        // an error body, so `|| status===200` would mask a rejected close (C34).
        return { ok: result?.ok === true, broker: "paper", result };
      } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    });
  }

  // (execution:openTranche / the manual ADD path removed 2026-06-23 — scale-in
  // deleted; the bot trades one position at a time. The renderer ADD control is
  // removed in Stage F.)

  // BE: move the stop to the entry (break-even) via modify_position.
  ipcMain.handle("execution:moveStopToBE", async () => {
    try {
      if (getActiveAccount()?.broker === "tradovate") {
        const adapter = await import("./execution/tradovate-adapter.js");
        const tpos = await adapter.readTradovatePosition();
        if (!tpos) return { ok: false, error: "no open position" };
        // Move EVERY working stop (scale-in tranches each carry their own stop)
        // to net break-even, not just the first one.
        const stops = (await adapter.readTradovateOrders()).filter((o) => o.kind === "stop");
        if (!stops.length) return { ok: false, error: "no working stop order to move" };
        const be = tick(tpos.avgFill);
        const results = [];
        for (const s of stops) results.push(await adapter.modifyTradovateStop({ orderId: s.id, stopPrice: be }));
        return { broker: "tradovate", ok: results.every((r) => r.ok), moved: results.length, stopPrice: be, results };
      }
      const pos = getTradingState().position;
      if (!pos) return { ok: false, error: "no open position" };
      const r = await tvAdapter.modifyPosition({ symbol: pos.symbol, sl: tick(pos.avgFill), tp: pos.tp });
      return { ok: r?.ok === true, result: r };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // TRAIL (one-shot): lock in half the open profit — move the stop toward
  // price by 50% of the unrealized gain, never the wrong direction.
  ipcMain.handle("execution:trail", async (_e, arg = {}) => {
    try {
      if (getActiveAccount()?.broker === "tradovate") {
        const adapter = await import("./execution/tradovate-adapter.js");
        const tpos = await adapter.readTradovatePosition();
        if (!tpos) return { ok: false, error: "no open position" };
        const stops = (await adapter.readTradovateOrders()).filter((o) => o.kind === "stop");
        if (!stops.length) return { ok: false, error: "no working stop order to move" };
        const entry = tpos.avgFill;
        const price = arg?.price ?? entry;
        const isLong = String(tpos.side || "").toLowerCase() === "buy";
        // Trail target from the net entry; move EVERY stop, never loosening any.
        const results = [];
        for (const s of stops) {
          const cur = s.price ?? entry;
          let sl = cur;
          if (price != null && entry != null) {
            if (isLong) sl = Math.max(cur, entry + Math.max(0, (price - entry) * 0.5));
            else sl = Math.min(cur, entry - Math.max(0, (entry - price) * 0.5));
          }
          results.push(await adapter.modifyTradovateStop({ orderId: s.id, stopPrice: tick(sl) }));
        }
        return { broker: "tradovate", ok: results.every((r) => r.ok), moved: results.length, results };
      }
      const pos = getTradingState().position;
      if (!pos) return { ok: false, error: "no open position" };
      const dom = await tvAdapter.readState();
      const price = arg?.price ?? dom.price;
      const entry = pos.avgFill;
      let sl = pos.sl ?? entry;
      if (price != null && entry != null) {
        if (pos.side === "buy") sl = Math.max(sl, entry + Math.max(0, (price - entry) * 0.5));
        else sl = Math.min(sl, entry - Math.max(0, (entry - price) * 0.5));
      }
      const r = await tvAdapter.modifyPosition({ symbol: pos.symbol, sl: tick(sl), tp: pos.tp });
      return { ok: r?.ok === true, result: r, newSl: tick(sl) };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // CANCEL: cancel every working order (e.g. an unfilled limit entry).
  ipcMain.handle("execution:cancel", async () => {
    try {
      // Route to Tradovate when it's the active broker (its working orders live
      // in its REST API, not the TV-paper WS feed).
      if (getActiveAccount()?.broker === "tradovate") {
        const { cancelTradovateOrders } = await import("./execution/tradovate-adapter.js");
        return { broker: "tradovate", ...(await cancelTradovateOrders()) };
      }
      const wos = getTradingState().workingOrders || [];
      if (wos.length === 0) return { ok: true, cancelled: 0 };
      const results = [];
      for (const o of wos) results.push(await tvAdapter.cancelOrder({ id: o.id }));
      // ok only when EVERY cancel acked — a partial cancel must surface (C34).
      const cancelled = results.filter((r) => r?.ok === true).length;
      return { ok: cancelled === results.length, cancelled, result: results };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}

// Round to the MNQ/MES tick (0.25).
function tick(n) { return Number.isFinite(n) ? Math.round(n * 4) / 4 : n; }

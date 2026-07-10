// app/main/execution/tranche-manager.js
// Tranche manager — decides what to do with each bar's surfaced packet, across
// the three automation modes. The pure decision core (planTrancheAction) is
// unit-tested here; the runtime that talks to the journal + broker is added in
// a later task. Detection rules are the shared, backtest-parity module.
import { sizeFromStop } from "./sizing-core.js";
import { bracketDisposition } from "./tranche-exec.js";
import { deriveDecisionId, planIntentAction, reconcileIntent, INTENT_STATES } from "./order-intent.js";

// app:error sink (wired from bar-close) so a naked-entry flatten / broker
// rejection surfaces to the operator instead of being swallowed (audit C13/C24).
let _send = null;
export function setTrancheSink(send) { _send = send; }

// Pure: map a surfaced packet → Tradovate bracket-order args. A Tradovate order
// carries its OWN stop/target in one POST (native bracket), so a tranche is a
// single bracketed market order — not the 3-leg standalone the TV paper path
// needs for the netting workaround. Exported for unit tests so the real-money
// routing is covered without placing an order.
export function tradovateOrderFromPacket(packet = {}, contracts) {
  // A+ rides to TP2 (the surfaced packet's tp2 falls back to tp1 when there's no
  // room), everything else banks at TP1 — mirrors the paper path's runnerTp so a
  // Tradovate A+ runner's native bracket isn't capped at TP1.
  const takeProfit = packet.grade === "A+" ? (packet.tp2 ?? packet.tp1) : packet.tp1;
  return {
    symbol: packet.symbol,
    side: (packet.side === "long" || packet.side === "buy") ? "buy" : "sell",
    type: "market",
    contracts,
    stopLoss: packet.stop,
    takeProfit,
    currentAsk: packet.entry,
    currentBid: packet.entry,
  };
}

// Pure decision: what to do with this bar's surfaced packet.
// Returns { action, reason }. action ∈
//   none | blocked:halt | open_anchor | surface |
//   open_add | skip:opposite | skip:not_greenlit | skip:dup |
//   blocked:breaker | blocked:max_adds | blocked:cap
// One position at a time — scale-in (concurrent adds) removed 2026-06-23
// (risk-and-management.md §Management styles; build-sequence E2). With no open
// position this is the anchor candidate; AUTO opens it, manual surfaces for the
// human. With a position already open, AUTO never stacks — it skips.
export function planTrancheAction({
  bestPacket, openTranches = [], mode = "manual", lossHalt = false,
} = {}) {
  if (!bestPacket) return { action: "none", reason: "no packet" };
  if (lossHalt) return { action: "blocked:halt", reason: "3-loss session halt" };

  const anchor = openTranches.find((t) => t.tranche_role === "anchor") || openTranches[0];
  if (!anchor) {
    if (mode === "auto") return { action: "open_anchor", reason: "auto anchor" };
    return { action: "surface", reason: "manual anchor" };
  }
  return { action: "skip:active", reason: "one position at a time — no adds" };
}

// ── Runtime ──────────────────────────────────────────────────────────────
// Called from bar-close after the chain surfaces a packet. In the auto modes
// it opens the anchor / adds and lays each tranche's standalone bracket; in
// manual mode it no-ops (the existing surface→human-accept flow is unchanged).
// All IO is injected via `deps` so the decision flow is unit-tested without the
// app; production builds real deps lazily (no top-level electron/CDP imports).
export async function runTrancheManager(ctx = {}, deps) {
  const { bestPacket } = ctx;
  if (!bestPacket) return { action: "none" };
  const d = deps || (await buildRealDeps());
  const cfg = await d.readExecConfig();
  // Only exact "auto" fires without confirmation. "suggest" and "manual" both
  // no-op the firing here (the surfaced setup still awaits a human accept); the
  // "suggest" surfacing/notify happens in bar-close. A corrupt/unknown mode was
  // already coerced to "manual" by mergeExecConfig — so nothing but "auto" fires.
  if (cfg.automationMode !== "auto") return { action: cfg.automationMode === "suggest" ? "suggest" : "manual" };

  // Account gate (auto path only — manual entries go through the IPC confirm).
  // Block auto-fire when the active account isn't the confirmed one, or when a
  // confirmed LIVE account's auto is still paused after a restart.
  const gate = d.accountRoutable();
  if (!gate.route) { await d.recordSkip(`blocked:${gate.reason}`); return { action: `blocked:${gate.reason}` }; }
  if (!d.autoAllowed()) { await d.recordSkip("blocked:live_auto_paused"); return { action: "blocked:live_auto_paused" }; }

  const { events, open } = await d.readJournal();

  const decision = planTrancheAction({
    bestPacket, openTranches: open, mode: cfg.automationMode,
    lossHalt: d.consecutiveLossStreak(events) >= 3,
  });

  if (decision.action === "open_anchor") {
    // Store-level fail-closed, matching the manual path's FILLS_UNREADABLE: a
    // genuine trade-store read error must BLOCK, not degrade the daily-loss gate
    // to realized=0 (which, with maxTrades/maxConsec both unset, would fire uncapped).
    if (d.dayFillsReadable && !d.dayFillsReadable()) {
      await d.recordSkip("blocked:FILLS_UNREADABLE");
      return { action: "blocked:FILLS_UNREADABLE" };
    }
    const sizing = d.sizePacket(bestPacket, cfg);
    const openLossUsd = d.openLossUsd ? await d.openLossUsd() : 0;
    const gate = d.checkOrder({
      hasStop: Number.isFinite(Number(bestPacket.stop)) && Number(bestPacket.stop) !== Number(bestPacket.entry),
      sizing, guards: cfg.guards,
      dayState: {
        realizedLossUsd: d.dayRealizedLossUsd(events),
        openLossUsd,
        // Day-scoped counts (same store as the manual path). Absent dep ⇒
        // undefined ⇒ checkOrder fails closed on maxTrades/maxConsec when set.
        tradeCount: d.dayTradeCount?.(),
        consecLosses: d.dayConsecLosses?.(),
      },
    });
    if (!gate.ok) { await d.recordSkip(`blocked:${gate.code}`); return { action: `blocked:${gate.code}`, gate }; }

    // Durable order-intent gate (B1). A deterministic decision_id folds this
    // setup+account; the append-only intent chain lets a restart tell "already
    // placed" from "safe to place". Absent intent deps (unit tests without the
    // store) fall straight through to the legacy create path.
    const decisionId = deriveDecisionId({
      packetId: bestPacket.id ?? bestPacket.walkerId ?? null,
      accountId: d.accountId?.() ?? null,
      session: d.session?.() ?? null,
      side: bestPacket.side, entry: bestPacket.entry, stop: bestPacket.stop,
    });
    const existingIntent = d.readIntent ? await d.readIntent(decisionId) : null;
    const intentPlan = planIntentAction({ existing: existingIntent });
    if (intentPlan.action === "skip_duplicate") { await d.recordSkip("skip:intent_dup"); return { action: "skip:intent_dup", decisionId }; }
    if (intentPlan.action === "skip_rejected") { await d.recordSkip("skip:intent_rejected"); return { action: "skip:intent_rejected", decisionId }; }
    if (intentPlan.action === "blocked_recovery") { await d.recordSkip("blocked:intent_recovery"); return { action: "blocked:intent_recovery", decisionId }; }
    if (intentPlan.action === "reconcile") {
      // An interrupted INTENT_CREATED/SUBMITTING — reconcile against the broker
      // before deciding. Never double-place (dup) and never assume flat (hold).
      const brokerRead = d.readBrokerPosition ? await d.readBrokerPosition() : { ok: false, position: null };
      const brokerStop = d.readBrokerStop ? await d.readBrokerStop(brokerRead) : null;
      const resolved = reconcileIntent({ intent: existingIntent, brokerRead, brokerStop });
      if (resolved === INTENT_STATES.STOP_CONFIRMED || resolved === INTENT_STATES.POSITION_CONFIRMED) {
        await d.recordIntent?.({ decision_id: decisionId, state: resolved, source: "reconcile" });
        await d.recordSkip("skip:intent_dup");
        return { action: "skip:intent_dup", decisionId };
      }
      if (resolved === INTENT_STATES.RECOVERY_REQUIRED) {
        await d.recordIntent?.({ decision_id: decisionId, state: INTENT_STATES.RECOVERY_REQUIRED, source: "reconcile", reason: "reconcile-unresolved" });
        await d.recordSkip("blocked:intent_recovery");
        return { action: "blocked:intent_recovery", decisionId };
      }
      // resolved === REJECTED → the broker never got the prior attempt → allow
      // create (fall through; a fresh INTENT_CREATED is recorded below).
    }

    // The accept is now on disk as a pending_entry trade. If the order call
    // THROWS (unconfigured endpoint, CDP hiccup, unresolvable instrument), the
    // in-function INVALIDATED guards never run — so void the trade here too, or
    // the grader phantom-FILLS it (2026-07-02 review). Both the throw path and
    // the return-{ok:false} path now write INVALIDATED.
    const intentBase = {
      decision_id: decisionId, account_id: d.accountId?.() ?? null, session: d.session?.() ?? null,
      side: bestPacket.side, symbol: bestPacket.symbol ?? null, entry: bestPacket.entry, stop: bestPacket.stop,
      contracts: sizing.contracts, source: "auto",
    };
    await d.recordIntent?.({ ...intentBase, state: INTENT_STATES.INTENT_CREATED });
    const accepted = await d.accept({ ...bestPacket, tranche_role: "anchor" });
    if (!accepted?.id) {
      await d.recordIntent?.({ ...intentBase, state: INTENT_STATES.REJECTED, reason: "accept_failed" });
      await d.recordSkip("accept_failed");
      return { action: "accept_failed", accepted };
    }
    try {
      await d.recordIntent?.({ ...intentBase, state: INTENT_STATES.SUBMITTING, trade_id: accepted.id });
      const ids = await d.openTrancheOrders({ packet: bestPacket, contracts: sizing.contracts, trancheId: accepted.id, decisionId });
      return { action: "open_anchor", accepted, ids, decisionId };
    } catch (err) {
      await d.invalidateTrade?.(accepted.id, "order-throw");
      await d.recordIntent?.({ ...intentBase, state: INTENT_STATES.REJECTED, trade_id: accepted.id, reason: "pre-send-throw" });
      await d.recordSkip(`order_throw:${String(err?.message || err)}`);
      return { action: "open_anchor_failed", accepted, error: String(err?.message || err) };
    }
  }
  if (decision.action === "surface" || decision.action === "none") return decision;
  await d.recordSkip(decision.reason);
  return decision;
}

// Production deps. Heavy modules (CDP/adapter/journal) imported lazily so the
// unit test (which injects fakes) never loads electron/ws.
async function buildRealDeps() {
  const [{ readExecConfig, TRADES_DIR }, sessions, outcomes, { checkOrder, openLossFromUpnl }, fills, exec, gate, active, autoResume, tradingFeed, orderIntent] = await Promise.all([
    import("./config.js"), import("../sessions.js"), import("../../../cli/lib/trade-outcomes.js"),
    import("./guardrails.js"), import("./fills.js"), import("./tranche-exec.js"),
    import("./account-gate.js"), import("./active-account.js"), import("./auto-resume.js"), import("./trading-feed.js"),
    import("./order-intent.js"),
  ]);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const tradesFile = async () => path.join(await sessions.activeSessionDir(), "trades.jsonl");
  // Durable order-intent store (B1) — lives in order-intents.jsonl beside trades.
  const intentStore = orderIntent.createIntentStore(await orderIntent.buildRealDeps());
  // Broker position/stop reads for the reconcile branch (a stuck INTENT_CREATED/
  // SUBMITTING). Same read-only sources as the fire path; a failed read yields
  // ok:false so the reconcile holds rather than assuming flat.
  const readBrokerPositionReal = async () => {
    try {
      if (active.getActiveAccount()?.broker === "tradovate") {
        const { readTradovatePositionSafe } = await import("./tradovate-adapter.js");
        const r = await readTradovatePositionSafe();
        return { ok: r.ok === true, position: r.position ?? null };
      }
      const { readStateSafe } = await import("./tv-adapter.js");
      const r = await readStateSafe();
      return { ok: r.ok === true, position: r.position ?? null };
    } catch { return { ok: false, position: null }; }
  };
  const readBrokerStopReal = async () => {
    try {
      if (active.getActiveAccount()?.broker === "tradovate") {
        const { readTradovateOrders } = await import("./tradovate-adapter.js");
        return (await readTradovateOrders()).some((o) => o.kind === "stop");
      }
      const wos = tradingFeed.getTradingState().workingOrders || [];
      return wos.some((o) => String(o.type || "").toLowerCase().includes("stop"));
    } catch { return null; }
  };
  const rootOf = (s) => (String(s || "").toUpperCase().match(/(MNQ|MES)/) || [])[1] || null;
  // Best-effort POSITION_CONFIRMED after a broker ack: read the live position and,
  // when a matching one exists, advance the intent. A failed read leaves the intent
  // at BROKER_ACKNOWLEDGED (the boot reconciler completes it) — never fatal.
  const confirmPositionAndStop = async (recordIntent, packet) => {
    try {
      const read = await readBrokerPositionReal();
      const pos = read?.ok === true ? read.position : null;
      if (pos && rootOf(pos.symbol) === rootOf(packet.symbol)) {
        await recordIntent({ state: INTENT_STATES.POSITION_CONFIRMED, qty: pos.qty ?? null, avg: pos.avgFill ?? null });
        return true;
      }
    } catch { /* best-effort */ }
    return false;
  };
  const readEvents = async () => {
    try {
      const txt = await fs.readFile(await tradesFile(), "utf8");
      return txt.trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  };
  const appendTrade = async (obj) => { await fs.appendFile(await tradesFile(), JSON.stringify(obj) + "\n", "utf8"); };

  return {
    readExecConfig,
    accountRoutable: () => gate.resolveAccountGate({ active: active.getActiveAccount(), confirmed: readExecConfig().confirmedAccount }),
    // AND-in the boot reconciliation gate (B2): paper auto only fires once the
    // reconciler has confirmed journal ≡ broker (HEALTHY). Defaults false on boot.
    autoAllowed: () => gate.autoFireAllowed({ confirmed: readExecConfig().confirmedAccount, autoResumed: autoResume.getAutoResumed() }) && autoResume.getReconciliationHealthy(),
    accountId: () => active.getActiveAccount()?.id ?? null,
    session: () => { try { return sessions.currentSession().session; } catch { return null; } },
    readIntent: (decisionId) => intentStore.readIntent(decisionId),
    recordIntent: (rec) => intentStore.recordTransition(rec),
    readBrokerPosition: readBrokerPositionReal,
    readBrokerStop: readBrokerStopReal,
    readJournal: async () => { const events = await readEvents(); return { events, open: outcomes.foldOpenTrades(events) }; },
    sizePacket: (packet, cfg) => {
      const target = cfg.guards?.defaultRisk ?? 120;
      const s = sizeFromStop({ symbol: packet.symbol, entry: packet.entry, stop: packet.stop, riskUsd: target });
      return { contracts: s.contracts, riskUsd: s.actualRiskUsd, withinTolerance: s.withinTolerance };
    },
    consecutiveLossStreak: (events) => outcomes.consecutiveLossStreak(events),
    // Scope to THIS account's id (not the broker label) + read from the real
    // TRADES_DIR (config), not the non-existent fills.TRADES_DIR which silently
    // read nothing — so auto mode previously had no daily halt at all.
    dayRealizedLossUsd: () => { try { const a = active.getActiveAccount(); const scope = a?.id ? { id: a.id, broker: a.broker ?? null } : null; return fills.dayRealizedLossUsd(fills.readFills(TRADES_DIR, new Date().toISOString().slice(0, 10)), scope); } catch { return 0; } },
    // Day-scoped trade count + consec-loss streak from the SAME store as the
    // manual path; +open counts the in-flight entry. NaN on error ⇒ checkOrder
    // blocks (fail-closed), so a read failure never lets an uncapped day run.
    // True iff today's trade store reads cleanly (absent file reads as [] — that
    // is a legitimate "no trades yet", not an error). A throw ⇒ false ⇒ block.
    dayFillsReadable: () => { try { fills.readFills(TRADES_DIR, new Date().toISOString().slice(0, 10)); return true; } catch { return false; } },
    dayTradeCount: () => { try { const a = active.getActiveAccount(); const scope = a?.id ? { id: a.id, broker: a.broker ?? null } : null; const open = tradingFeed.getTradingState().position ? 1 : 0; return fills.dayTradeCount(fills.readFills(TRADES_DIR, new Date().toISOString().slice(0, 10)), scope) + open; } catch { return NaN; } },
    dayConsecLosses: () => { try { const a = active.getActiveAccount(); const scope = a?.id ? { id: a.id, broker: a.broker ?? null } : null; return fills.dayConsecutiveLossStreak(fills.readFills(TRADES_DIR, new Date().toISOString().slice(0, 10)), scope); } catch { return NaN; } },
    // Best-effort open drawdown for the predictive daily-loss gate. Same
    // read-only sources as the IPC fire path: Tradovate REST position if active,
    // otherwise the paper/webview position. Any read failure degrades to 0 so
    // auto-fire still keeps the realized + new-risk protection.
    openLossUsd: async () => {
      try {
        let pos = tradingFeed.getTradingState().position ?? null;
        if (active.getActiveAccount()?.broker === "tradovate") {
          const { readTradovatePosition } = await import("./tradovate-adapter.js");
          pos = (await readTradovatePosition()) ?? pos;
        } else if (pos?.uPnlUsd == null) {
          const { tvAdapter } = await import("./tv-adapter.js");
          pos = (await tvAdapter.readState())?.position ?? pos;
        }
        return openLossFromUpnl(pos?.uPnlUsd);
      } catch { return 0; }
    },
    checkOrder,
    accept: async (payload) => {
      const { acceptSetup } = await import("../trades.js");
      // acceptSetup reads setup.direction for side; map from the packet's side.
      return acceptSetup({ setup: { ...payload, direction: payload.direction ?? payload.side } });
    },
    openTrancheOrders: async ({ packet, contracts, trancheId, decisionId }) => {
      // Route by the active broker, same as the manual placeManual path. A
      // Tradovate account (incl. demo — type "live") places ONE bracketed
      // market order via its REST adapter; TV paper uses the 3-leg standalone
      // (netting workaround). Guardrails already ran upstream in runTrancheManager.
      const broker = active.getActiveAccount()?.broker ?? null;
      const intentBase = { decision_id: decisionId, trade_id: trancheId, broker, symbol: packet.symbol ?? null, side: packet.side, entry: packet.entry, stop: packet.stop, contracts };
      const recordIntent = async (fields) => { try { await intentStore.recordTransition({ ...intentBase, ...fields }); } catch { /* best-effort */ } };
      // An order with no instrument cannot place (the POST is rejected → null
      // ids → a phantom fill). Fail LOUD and invalidate rather than route a
      // symbol-less order (2026-07-02 live root cause).
      if (!packet.symbol) {
        _send?.("app:error", { source: "tranche-manager", level: "error", message: `No symbol on the packet for ${trancheId} — cannot place an order; trade invalidated.` });
        await appendTrade({ type: "tranche_orders", broker: broker ?? "paper", setup_id: trancheId, stopOrderId: null, limitOrderId: null, error: "missing_symbol", ts: new Date().toISOString() });
        await appendTrade({ type: "outcome", id: trancheId, status: "INVALIDATED", source: "missing-symbol", ts: new Date().toISOString() });
        await recordIntent({ state: INTENT_STATES.REJECTED, reason: "missing_symbol" });
        return { error: "missing_symbol" };
      }
      if (broker === "tradovate") {
        const { placeTradovateOrder } = await import("./tradovate-adapter.js");
        const r = await placeTradovateOrder(tradovateOrderFromPacket(packet, contracts));
        const submit = classifySubmitResult({ ok: r?.ok, status: r?.status });
        // Ambiguous (status:0 fetch-failed / timeout / 5xx): we DON'T know if the
        // order landed. NEVER invalidate — that could phantom-flat a real
        // position. Mark the trade recovery-held + the intent RECOVERY_REQUIRED;
        // the boot reconciler resolves it against the broker.
        if (submit === "ambiguous") {
          _send?.("app:error", { source: "tranche-manager", level: "error", message: `Tradovate order AMBIGUOUS for ${trancheId} (no ack — request may or may not have landed). Held for reconciliation; NOT invalidated.` });
          await appendTrade({ type: "tranche_orders", broker: "tradovate", setup_id: trancheId, orderId: r?.orderId ?? null, ok: false, recovery: true, ts: new Date().toISOString() });
          await recordIntent({ state: INTENT_STATES.RECOVERY_REQUIRED, order_id: r?.orderId ?? null, status: r?.status ?? 0, reason: "ambiguous-submit" });
          return { action: "recovery_required", orderId: r?.orderId ?? null };
        }
        await appendTrade({ type: "tranche_orders", broker: "tradovate", setup_id: trancheId, orderId: r?.orderId ?? null, ok: !!r?.ok, ts: new Date().toISOString() });
        // Tradovate order cleanly rejected → no position; invalidate so the grader
        // can't phantom-fill the accepted trade.
        if (!r?.ok) {
          _send?.("app:error", { source: "tranche-manager", level: "error", message: `Tradovate order FAILED for ${trancheId} — no position opened; trade invalidated.` });
          await appendTrade({ type: "outcome", id: trancheId, status: "INVALIDATED", source: "order-place-failed", ts: new Date().toISOString() });
          await recordIntent({ state: INTENT_STATES.REJECTED, status: r?.status ?? null, reason: "order-place-failed" });
          return { broker: "tradovate", orderId: r?.orderId ?? null, ok: false };
        }
        // Acknowledged → confirm the native bracket (position + its stop) best-effort.
        // The Tradovate stop rides in the same accepted POST, so a confirmed
        // position means the bracket is in place → STOP_CONFIRMED.
        await recordIntent({ state: INTENT_STATES.BROKER_ACKNOWLEDGED, order_id: r?.orderId ?? null, status: r?.status ?? 200 });
        const tvConfirmed = await confirmPositionAndStop(recordIntent, packet);
        if (tvConfirmed) await recordIntent({ state: INTENT_STATES.STOP_CONFIRMED, stop_order_id: r?.orderId ?? null, stop_price: packet.stop });
        return { broker: "tradovate", orderId: r?.orderId ?? null, ok: true };
      }
      const { tvAdapter } = await import("./tv-adapter.js");
      const actions = exec.brokerActionsForTranche({
        side: packet.side, grade: packet.grade, contracts,
        entry: packet.entry, stop: packet.stop, tp1: packet.tp1, tp2: packet.tp2, symbol: packet.symbol,
      });
      const results = [];
      for (const a of actions) results.push(await tvAdapter.placeStandalone(a));
      const { disposition, stopOrderId, limitOrderId, authLost } = bracketDisposition(results);
      if (authLost) _send?.("app:error", { source: "tranche-manager", level: "error", message: `Broker rejected the bracket as logged-out (401/403) for ${trancheId} — re-auth the TradingView/broker session; auto-entries will keep failing until then` });
      // AMBIGUOUS entry POST (fetch-failed / timeout / 5xx): the entry order may
      // have landed. NEVER invalidate (that could phantom-flat a live position) —
      // hold the trade recovery:true + the intent RECOVERY_REQUIRED and let the
      // boot reconciler settle it against the broker. (THE ambiguous-submit fix.)
      if (disposition === "recovery") {
        _send?.("app:error", { source: "tranche-manager", level: "error", message: `Order placement AMBIGUOUS for ${trancheId} (no ack — the entry may or may not have landed). Held for reconciliation; NOT invalidated.` });
        await appendTrade({ type: "tranche_orders", broker: "paper", setup_id: trancheId, stopOrderId: null, limitOrderId: null, recovery: true, ts: new Date().toISOString() });
        await recordIntent({ state: INTENT_STATES.RECOVERY_REQUIRED, status: results[0]?.status ?? 0, reason: "ambiguous-submit" });
        return { action: "recovery_required" };
      }
      // The ENTRY order was cleanly rejected (4xx / body error). No position
      // exists at the broker. Do NOT leave a pending_entry trade — the grader
      // would phantom-FILL it against price bars, so the journal/REVIEW would show
      // a position that isn't real. Surface loudly and INVALIDATE the journal trade.
      if (disposition === "rejected") {
        _send?.("app:error", { source: "tranche-manager", level: "error", message: `Order placement FAILED for ${trancheId} (entry rejected — check broker login / symbol). No position opened; trade invalidated.` });
        await appendTrade({ type: "tranche_orders", broker: "paper", setup_id: trancheId, stopOrderId: null, limitOrderId: null, error: "entry_place_failed", ts: new Date().toISOString() });
        await appendTrade({ type: "outcome", id: trancheId, status: "INVALIDATED", source: "order-place-failed", ts: new Date().toISOString() });
        await recordIntent({ state: INTENT_STATES.REJECTED, status: results[0]?.status ?? null, reason: "entry_place_failed" });
        return { stopOrderId: null, limitOrderId: null, error: "entry_place_failed" };
      }
      // A filled entry with no working protective stop is the worst money-path
      // state (audit C13). Flatten the just-opened entry immediately, surface
      // it, and never persist a naked entry as if it were bracketed.
      if (disposition === "naked") {
        try { await tvAdapter.flatten({ symbol: packet.symbol }); } catch { /* best-effort — the error below still surfaces */ }
        // flatten (close_position) does NOT cancel resting orders, so the TP
        // limit leg would orphan-reverse the position when it fills — cancel it
        // too (audit review). Then close the journal trade so foldOpenTrades
        // stops the grader ticking a phantom position.
        if (Number.isFinite(limitOrderId)) { try { await tvAdapter.cancelOrder({ id: limitOrderId }); } catch { /* best-effort */ } }
        _send?.("app:error", { source: "tranche-manager", level: "error", message: `Bracket stop leg failed for ${trancheId} — flattened the entry and cancelled the TP leg to avoid a naked/reversed position` });
        await appendTrade({ type: "tranche_orders", broker: "paper", setup_id: trancheId, stopOrderId: null, limitOrderId: null, error: "stop_leg_failed", flattened: true, ts: new Date().toISOString() });
        await appendTrade({ type: "outcome", id: trancheId, status: "INVALIDATED", source: "bracket-naked-abort", ts: new Date().toISOString() });
        await recordIntent({ state: INTENT_STATES.REJECTED, reason: "bracket-naked-abort" });
        return { stopOrderId: null, limitOrderId: null, error: "stop_leg_failed", flattened: true };
      }
      // Success: entry filled + a working protective stop. Record the lifecycle
      // forward: acknowledged → (best-effort position confirm) → stop confirmed.
      await appendTrade({ type: "tranche_orders", broker: "paper", setup_id: trancheId, stopOrderId, limitOrderId, ts: new Date().toISOString() });
      await recordIntent({ state: INTENT_STATES.BROKER_ACKNOWLEDGED, order_id: stopOrderId ?? null, status: results[0]?.status ?? 200 });
      const confirmed = await confirmPositionAndStop(recordIntent, packet);
      if (confirmed) await recordIntent({ state: INTENT_STATES.STOP_CONFIRMED, stop_order_id: stopOrderId ?? null, stop_price: packet.stop });
      return { stopOrderId, limitOrderId };
    },
    recordSkip: async (reason) => {
      try {
        const dir = await sessions.activeSessionDir();
        await fs.appendFile(path.join(dir, "setups.jsonl"), JSON.stringify({ type: "tranche_skip", reason, ts: new Date().toISOString() }) + "\n", "utf8");
      } catch { /* best-effort */ }
    },
    // Void an accepted trade whose order call THREW — writes the INVALIDATED
    // outcome the grader needs so the pending_entry can't phantom-fill.
    invalidateTrade: async (id, source) => {
      try { await appendTrade({ type: "outcome", id, status: "INVALIDATED", source, ts: new Date().toISOString() }); } catch { /* best-effort */ }
    },
  };
}

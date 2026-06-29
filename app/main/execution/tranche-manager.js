// app/main/execution/tranche-manager.js
// Tranche manager — decides what to do with each bar's surfaced packet, across
// the three automation modes. The pure decision core (planTrancheAction) is
// unit-tested here; the runtime that talks to the journal + broker is added in
// a later task. Detection rules are the shared, backtest-parity module.
import { sizeFromStop } from "./sizing-core.js";

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
  if (cfg.automationMode === "manual") return { action: "manual" };

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
    const sizing = d.sizePacket(bestPacket, cfg);
    const openLossUsd = d.openLossUsd ? await d.openLossUsd() : 0;
    const gate = d.checkOrder({
      hasStop: Number.isFinite(Number(bestPacket.stop)) && Number(bestPacket.stop) !== Number(bestPacket.entry),
      sizing, guards: cfg.guards,
      dayState: { realizedLossUsd: d.dayRealizedLossUsd(events), openLossUsd },
    });
    if (!gate.ok) { await d.recordSkip(`blocked:${gate.code}`); return { action: `blocked:${gate.code}`, gate }; }
    const accepted = await d.accept({ ...bestPacket, tranche_role: "anchor" });
    if (!accepted?.id) { await d.recordSkip("accept_failed"); return { action: "accept_failed", accepted }; }
    const ids = await d.openTrancheOrders({ packet: bestPacket, contracts: sizing.contracts, trancheId: accepted.id });
    return { action: "open_anchor", accepted, ids };
  }
  if (decision.action === "surface" || decision.action === "none") return decision;
  await d.recordSkip(decision.reason);
  return decision;
}

// Production deps. Heavy modules (CDP/adapter/journal) imported lazily so the
// unit test (which injects fakes) never loads electron/ws.
async function buildRealDeps() {
  const [{ readExecConfig, TRADES_DIR }, sessions, outcomes, { checkOrder, openLossFromUpnl }, fills, exec, gate, active, autoResume, tradingFeed] = await Promise.all([
    import("./config.js"), import("../sessions.js"), import("../../../cli/lib/trade-outcomes.js"),
    import("./guardrails.js"), import("./fills.js"), import("./tranche-exec.js"),
    import("./account-gate.js"), import("./active-account.js"), import("./auto-resume.js"), import("./trading-feed.js"),
  ]);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const tradesFile = async () => path.join(await sessions.activeSessionDir(), "trades.jsonl");
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
    autoAllowed: () => gate.autoFireAllowed({ confirmed: readExecConfig().confirmedAccount, autoResumed: autoResume.getAutoResumed() }),
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
    dayRealizedLossUsd: () => { try { const acct = active.getActiveAccount()?.id ?? null; return fills.dayRealizedLossUsd(fills.readFills(TRADES_DIR, new Date().toISOString().slice(0, 10)), acct); } catch { return 0; } },
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
    openTrancheOrders: async ({ packet, contracts, trancheId }) => {
      // Route by the active broker, same as the manual placeManual path. A
      // Tradovate account (incl. demo — type "live") places ONE bracketed
      // market order via its REST adapter; TV paper uses the 3-leg standalone
      // (netting workaround). Guardrails already ran upstream in runTrancheManager.
      const broker = active.getActiveAccount()?.broker ?? null;
      if (broker === "tradovate") {
        const { placeTradovateOrder } = await import("./tradovate-adapter.js");
        const r = await placeTradovateOrder(tradovateOrderFromPacket(packet, contracts));
        await appendTrade({ type: "tranche_orders", broker: "tradovate", setup_id: trancheId, orderId: r?.orderId ?? null, ok: !!r?.ok, ts: new Date().toISOString() });
        return { broker: "tradovate", orderId: r?.orderId ?? null, ok: !!r?.ok };
      }
      const { tvAdapter } = await import("./tv-adapter.js");
      const actions = exec.brokerActionsForTranche({
        side: packet.side, grade: packet.grade, contracts,
        entry: packet.entry, stop: packet.stop, tp1: packet.tp1, tp2: packet.tp2, symbol: packet.symbol,
      });
      const results = [];
      for (const a of actions) results.push(await tvAdapter.placeStandalone(a));
      const idOf = (r) => { try { return Number(JSON.parse(r.body).id); } catch { return null; } };
      const stopOrderId = idOf(results[1]);
      const limitOrderId = idOf(results[2]);
      await appendTrade({ type: "tranche_orders", broker: "paper", setup_id: trancheId, stopOrderId, limitOrderId, ts: new Date().toISOString() });
      return { stopOrderId, limitOrderId };
    },
    recordSkip: async (reason) => {
      try {
        const dir = await sessions.activeSessionDir();
        await fs.appendFile(path.join(dir, "setups.jsonl"), JSON.stringify({ type: "tranche_skip", reason, ts: new Date().toISOString() }) + "\n", "utf8");
      } catch { /* best-effort */ }
    },
  };
}

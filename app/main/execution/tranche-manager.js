// app/main/execution/tranche-manager.js
// Tranche manager — decides what to do with each bar's surfaced packet, across
// the three automation modes. The pure decision core (planTrancheAction) is
// unit-tested here; the runtime that talks to the journal + broker is added in
// a later task. Detection rules are the shared, backtest-parity module.
import { canScaleInto, isNearDuplicate, greenLightReached, addsDisabledFromOutcomes } from "../../../cli/lib/scale-in-rules.js";
import { sizeFromStop } from "./sizing-core.js";

// Pure: map a surfaced packet → Tradovate bracket-order args. A Tradovate order
// carries its OWN stop/target in one POST (native bracket), so a tranche is a
// single bracketed market order — not the 3-leg standalone the TV paper path
// needs for the netting workaround. Exported for unit tests so the real-money
// routing is covered without placing an order.
export function tradovateOrderFromPacket(packet = {}, contracts) {
  return {
    symbol: packet.symbol,
    side: (packet.side === "long" || packet.side === "buy") ? "buy" : "sell",
    type: "market",
    contracts,
    stopLoss: packet.stop,
    takeProfit: packet.tp1,
    currentAsk: packet.entry,
    currentBid: packet.entry,
  };
}

// Pure decision: what to do with this bar's surfaced packet.
// Returns { action, reason }. action ∈
//   none | blocked:halt | open_anchor | surface |
//   open_add | skip:opposite | skip:not_greenlit | skip:dup |
//   blocked:breaker | blocked:max_adds | blocked:cap
export function planTrancheAction({
  bestPacket, openTranches = [], price, mode = "manual", maxAdds = 5,
  combinedCapUsd = null, openRiskUsd = 0, addRiskUsd = 0,
  addsDisabled = false, lossHalt = false, takenLog = [],
} = {}) {
  if (!bestPacket) return { action: "none", reason: "no packet" };
  if (lossHalt) return { action: "blocked:halt", reason: "3-loss session halt" };

  const anchor = openTranches.find((t) => t.tranche_role === "anchor") || openTranches[0];
  if (!anchor) {
    // No open position → this is an anchor candidate.
    if (mode === "auto") return { action: "open_anchor", reason: "auto anchor" };
    return { action: "surface", reason: "manual anchor" };
  }

  if (bestPacket.side !== anchor.side) return { action: "skip:opposite", reason: "opposite side — no reverse via add" };
  if (!anchor.greenLight) return { action: "skip:not_greenlit", reason: "anchor not 50% to TP1" };
  if (addsDisabled) return { action: "blocked:breaker", reason: "2 add stop-outs in a row" };
  if (openTranches.length >= 1 + maxAdds) return { action: "blocked:max_adds", reason: `max ${maxAdds} adds` };
  if (isNearDuplicate(bestPacket, takenLog)) return { action: "skip:dup", reason: "10-min same-side duplicate" };
  if (combinedCapUsd != null && openRiskUsd + addRiskUsd > combinedCapUsd) {
    return { action: "blocked:cap", reason: `combined risk > $${combinedCapUsd}` };
  }
  // canScaleInto is the authority; the checks above give precise reasons.
  if (!canScaleInto({ anchor, setup: bestPacket, openCount: openTranches.length, takenLog, maxAdds })) {
    return { action: "skip:dup", reason: "canScaleInto rejected" };
  }
  if (mode === "manual") return { action: "surface", reason: "manual add — human accepts" };
  return { action: "open_add", reason: "auto add" };
}

// ── Runtime ──────────────────────────────────────────────────────────────
// Called from bar-close after the chain surfaces a packet. In the auto modes
// it opens the anchor / adds and lays each tranche's standalone bracket; in
// manual mode it no-ops (the existing surface→human-accept flow is unchanged).
// All IO is injected via `deps` so the decision flow is unit-tested without the
// app; production builds real deps lazily (no top-level electron/CDP imports).
export async function runTrancheManager(ctx = {}, deps) {
  const { bestPacket, price } = ctx;
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
  const anchor = open.find((t) => t.tranche_role === "anchor") || open[0] || null;
  let greenLight = false;
  if (anchor) {
    greenLight = d.hasGreenLight(events, anchor.id);
    if (!greenLight && greenLightReached(anchor, price)) { await d.markGreenLight(anchor.id); greenLight = true; }
  }
  const annotated = anchor ? open.map((t) => (t.id === anchor.id ? { ...t, greenLight } : t)) : open;
  const takenLog = open.map((t) => ({ side: t.side, tp1: Number(t.tp1), ms: Date.parse(t.ts) }));
  const sizing = d.sizePacket(bestPacket, cfg);

  const decision = planTrancheAction({
    bestPacket, openTranches: annotated, price, mode: cfg.automationMode,
    maxAdds: cfg.maxAdds, combinedCapUsd: cfg.combinedCapUsd,
    openRiskUsd: d.openRiskUsd(open), addRiskUsd: sizing.riskUsd,
    addsDisabled: addsDisabledFromOutcomes(events),
    lossHalt: d.consecutiveLossStreak(events) >= 3,
    takenLog,
  });

  if (decision.action === "open_anchor" || decision.action === "open_add") {
    const role = decision.action === "open_anchor" ? "anchor" : "add";
    const gate = d.checkOrder({
      hasStop: Number.isFinite(Number(bestPacket.stop)) && Number(bestPacket.stop) !== Number(bestPacket.entry),
      sizing, guards: cfg.guards, dayState: { realizedLossUsd: d.dayRealizedLossUsd(events) },
    });
    if (!gate.ok) { await d.recordSkip(`blocked:${gate.code}`); return { action: `blocked:${gate.code}`, gate }; }
    const accepted = await d.accept({ ...bestPacket, tranche_role: role });
    if (!accepted?.id) { await d.recordSkip("accept_failed"); return { action: "accept_failed", accepted }; }
    const ids = await d.openTrancheOrders({ packet: bestPacket, contracts: sizing.contracts, trancheId: accepted.id });
    return { action: decision.action, accepted, ids };
  }
  if (decision.action === "surface" || decision.action === "none") return decision;
  await d.recordSkip(decision.reason);
  return decision;
}

// Open a tranche on demand (the manual ADD path / human-accepted anchor).
// Unlike runTrancheManager this skips the planTrancheAction gate (the human
// already decided) but keeps the guardrail check + standalone bracket so a
// manual add gets its OWN stop/target, same as an auto add.
export async function openTrancheNow({ packet, role = "add" }, deps) {
  const d = deps || (await buildRealDeps());
  if (!packet) return { ok: false, error: "no packet" };
  const cfg = await d.readExecConfig();
  const sizing = d.sizePacket(packet, cfg);
  const gate = d.checkOrder({
    hasStop: Number.isFinite(Number(packet.stop)) && Number(packet.stop) !== Number(packet.entry),
    sizing, guards: cfg.guards, dayState: { realizedLossUsd: d.dayRealizedLossUsd() },
  });
  if (!gate.ok) return { ok: false, blocked: gate };
  const accepted = await d.accept({ ...packet, tranche_role: role });
  if (!accepted?.id) return { ok: false, error: "accept_failed", accepted };
  const ids = await d.openTrancheOrders({ packet, contracts: sizing.contracts, trancheId: accepted.id });
  return { ok: true, accepted, ids };
}

// Production deps. Heavy modules (CDP/adapter/journal) imported lazily so the
// unit test (which injects fakes) never loads electron/ws.
async function buildRealDeps() {
  const [{ readExecConfig }, sessions, outcomes, { checkOrder }, fills, exec, gate, active, autoResume] = await Promise.all([
    import("./config.js"), import("../sessions.js"), import("../../../cli/lib/trade-outcomes.js"),
    import("./guardrails.js"), import("./fills.js"), import("./tranche-exec.js"),
    import("./account-gate.js"), import("./active-account.js"), import("./auto-resume.js"),
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
  const pointValue = (sym) => (String(sym || "").startsWith("MES") ? 5 : 2);

  return {
    readExecConfig,
    accountRoutable: () => gate.resolveAccountGate({ active: active.getActiveAccount(), confirmed: readExecConfig().confirmedAccount }),
    autoAllowed: () => gate.autoFireAllowed({ confirmed: readExecConfig().confirmedAccount, autoResumed: autoResume.getAutoResumed() }),
    readJournal: async () => { const events = await readEvents(); return { events, open: outcomes.foldOpenTrades(events) }; },
    hasGreenLight: (events, id) => events.some((e) => e.type === "green_light" && e.setup_id === id),
    markGreenLight: async (id) => appendTrade({ type: "green_light", setup_id: id, ts: new Date().toISOString() }),
    sizePacket: (packet, cfg) => {
      const target = cfg.guards?.defaultRisk ?? 120;
      const s = sizeFromStop({ symbol: packet.symbol, entry: packet.entry, stop: packet.stop, riskUsd: target });
      return { contracts: s.contracts, riskUsd: s.actualRiskUsd, withinTolerance: s.withinTolerance };
    },
    openRiskUsd: (open) => open.reduce((s, t) => {
      const pts = Math.abs(Number(t.entry) - Number(t.stop));
      const c = Number(t.size?.contracts ?? t.size ?? 1) || 1;
      return s + (Number.isFinite(pts) ? pts * pointValue(t.symbol) * c : 0);
    }, 0),
    consecutiveLossStreak: (events) => outcomes.consecutiveLossStreak(events),
    dayRealizedLossUsd: () => { try { const acct = active.getActiveAccount()?.broker ?? null; return fills.dayRealizedLossUsd(fills.readFills(fills.TRADES_DIR ?? undefined, new Date().toISOString().slice(0, 10)), acct); } catch { return 0; } },
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

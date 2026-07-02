// app/main/ipc-execution.js
// execution:* IPC. Place/flatten/panic run guardrails first (place), then route
// by active broker (Tradovate REST or TV paper adapter) and place live; state
// reads stay read-only. Adapter/guardrail failures return as structured results
// rather than throwing across IPC.
import { ipcMain } from "electron";
import { tvAdapter } from "./execution/tv-adapter.js";
import { checkOrder, openLossFromUpnl } from "./execution/guardrails.js";
import { readFills, dayRealizedLossUsd, readAllFills } from "./execution/fills.js";
import { getTradingState } from "./execution/trading-feed.js";
import { TRADES_DIR, readExecConfig, writeExecConfig } from "./execution/config.js";
import { getActiveAccount } from "./execution/active-account.js";
import { resolveAccountGate } from "./execution/account-gate.js";
import { setAutoResumed, getAutoResumed } from "./execution/auto-resume.js";

function tradesDir() { return TRADES_DIR; }
function today() { return new Date().toISOString().slice(0, 10); }

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

async function guarded(payload) {
  const fills = readFills(tradesDir(), today());
  // Scope the daily-loss halt to the SPECIFIC account we'd route to — one
  // account's losses must not halt another. Use the account id (not the broker
  // label) so two different Tradovate accounts don't share one tally. Falls back
  // to all-accounts when the active account is unknown.
  const acct = getActiveAccount();
  // Scope by { id, broker } so a fill written before the account id was learned
  // (accountId null) still counts toward this broker's halt (audit C14).
  const account = acct?.id ? { id: acct.id, broker: acct.broker ?? null } : null;
  // Fold current open drawdown into the gate so a new order can't be sized into
  // a worst-case day that breaches the daily limit (audit Phase 3).
  const dayState = { realizedLossUsd: dayRealizedLossUsd(fills, account), openLossUsd: await openLossUsdNow() };
  return checkOrder({ hasStop: payload?.hasStop, sizing: payload?.sizing, guards: payload?.guards, dayState });
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
    setAutoResumed(true);
    return { ok: true, autoResumed: true };
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
      const preview = buildOrderPreview({ side: arg.side, entry: ctx.price, symbol: ctx.symbol, candidates: ctx.candidates, draws: ctx.draws, typedStop: arg.typedStop, typedTp: arg.typedTp, riskUsd, maxRiskUsd: guards.perTradeMax });
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
      const preview = buildOrderPreview({ side: arg.side, entry: ctx.price, symbol: ctx.symbol, candidates: ctx.candidates, draws: ctx.draws, typedStop: arg.typedStop, typedTp: arg.typedTp, riskUsd, maxRiskUsd: guards.perTradeMax });
      if (preview.block) return { ok: false, blocked: true, code: preview.block, preview };
      const gate = await guarded({ hasStop: preview.stop != null, sizing: { withinTolerance: preview.withinTolerance, contracts: preview.contracts, actualRisk: preview.actualRiskUsd }, guards: readExecConfig().guards });
      if (!gate.ok) return { ok: false, blocked: true, ...gate, preview };

      // Route by the active broker. Tradovate orders go to its own REST API
      // (Bearer-token + bracket-in-the-POST); paper uses the TV paper adapter.
      const active = getActiveAccount();
      if (active?.broker === "tradovate") {
        const acctGate = resolveAccountGate({ active, confirmed: readExecConfig().confirmedAccount });
        if (!acctGate.route) return { ok: false, blocked: true, code: "confirm_tradovate", preview, gate: acctGate };
        const { placeTradovateOrder } = await import("./execution/tradovate-adapter.js");
        const result = await placeTradovateOrder({
          symbol: ctx.symbol,
          side: arg.side, type: "market", contracts: preview.contracts,
          stopLoss: preview.stop, takeProfit: preview.tp ?? undefined,
          currentAsk: ctx.price, currentBid: ctx.price,
        });
        return { ok: !!result.ok, broker: "tradovate", result, preview };
      }

      const result = await tvAdapter.placeOrder({ symbol: ctx.symbol, side: arg.side, type: "market", entry: ctx.price, stop: preview.stop, tp: preview.tp ?? undefined, contracts: preview.contracts });
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
      if (active?.broker === "tradovate") {
        const acctGate = resolveAccountGate({ active, confirmed: readExecConfig().confirmedAccount });
        if (!acctGate.route) return { ok: false, blocked: true, code: "confirm_tradovate", gate: acctGate };
        const { placeTradovateOrder } = await import("./execution/tradovate-adapter.js");
        const { tradovateOrderArgsFromPayload } = await import("./execution/tradovate.js");
        const result = await placeTradovateOrder(tradovateOrderArgsFromPayload(payload));
        return { ok: !!result?.ok, broker: "tradovate", result };
      }
      // Paper: reflect the broker's real HTTP result — a non-200 POST must not
      // report ok:true (mirrors placeManual).
      const result = await tvAdapter.placeOrder(payload);
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
        return { ok: result?.ok === true || result?.status === 200, broker: "paper", result };
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
      return { ok: r?.status === 200, result: r };
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
      return { ok: r?.status === 200, result: r, newSl: tick(sl) };
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
      const cancelled = results.filter((r) => r?.ok === true || r?.status === 200).length;
      return { ok: cancelled === results.length, cancelled, result: results };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}

// Round to the MNQ/MES tick (0.25).
function tick(n) { return Number.isFinite(n) ? Math.round(n * 4) / 4 : n; }

// app/main/ipc-execution.js
// execution:* IPC. Place/flatten/panic run guardrails first (place) and
// delegate to the adapter; state is read-only. Placement is gated on M0, so
// these return the adapter's NOT_IMPLEMENTED error as a structured result
// rather than throwing across IPC.
import { ipcMain } from "electron";
import { tvAdapter } from "./execution/tv-adapter.js";
import { checkOrder } from "./execution/guardrails.js";
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

async function guarded(payload) {
  const fills = readFills(tradesDir(), today());
  const dayState = { realizedLossUsd: dayRealizedLossUsd(fills) };
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
      const riskUsd = arg.riskUsd ?? readExecConfig().guards?.defaultRisk ?? 120;
      const preview = buildOrderPreview({ side: arg.side, entry: ctx.price, symbol: ctx.symbol, candidates: ctx.candidates, draws: ctx.draws, typedStop: arg.typedStop, typedTp: arg.typedTp, riskUsd });
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
      const riskUsd = arg.riskUsd ?? readExecConfig().guards?.defaultRisk ?? 120;
      const preview = buildOrderPreview({ side: arg.side, entry: ctx.price, symbol: ctx.symbol, candidates: ctx.candidates, draws: ctx.draws, typedStop: arg.typedStop, typedTp: arg.typedTp, riskUsd });
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
      // Tradovate position comes from its REST API (the WS feed is TV-paper-only).
      // Surface it as the live position so the IN-TRADE / ORDERS display shows it
      // and Flatten enables.
      if (feed.activeBroker === "tradovate") {
        try {
          const { readTradovatePosition } = await import("./execution/tradovate-adapter.js");
          const tpos = await readTradovatePosition();
          if (tpos) position = tpos;
          account = feed.tradovate?.accountId ?? account;
        } catch { /* best-effort */ }
      }
      const state = {
        connected: feed.connected || dom.connected,
        account,
        position,
        balance: feed.balance ?? dom.balance ?? null,
        price: dom.price ?? null,
        workingOrders: feed.workingOrders ?? [],
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
    try { return { ok: true, result: await tvAdapter.placeOrder(payload) }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  for (const verb of ["flatten", "panic"]) {
    ipcMain.handle(`execution:${verb}`, async (_e, payload) => {
      try {
        // Route flatten/panic to Tradovate when it's the active broker.
        if (getActiveAccount()?.broker === "tradovate") {
          const { closeTradovatePosition } = await import("./execution/tradovate-adapter.js");
          return { ok: true, broker: "tradovate", result: await closeTradovatePosition(payload || {}) };
        }
        return { ok: true, broker: "paper", result: await tvAdapter[verb](payload) };
      } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    });
  }

  // ADD / scale-in: open a tranche as its OWN standalone position (entry + its
  // own stop + its own target), per the netting workaround. Supersedes the old
  // averaging addToPosition. Used by the manual ADD button (auto modes open
  // tranches via the bar-close tranche manager). payload = the setup/packet.
  ipcMain.handle("execution:openTranche", async (_e, payload) => {
    try {
      const { openTrancheNow } = await import("./execution/tranche-manager.js");
      return await openTrancheNow({ packet: payload, role: payload?.tranche_role || "add" });
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // BE: move the stop to the entry (break-even) via modify_position.
  ipcMain.handle("execution:moveStopToBE", async () => {
    try {
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
      const wos = getTradingState().workingOrders || [];
      if (wos.length === 0) return { ok: true, cancelled: 0 };
      const results = [];
      for (const o of wos) results.push(await tvAdapter.cancelOrder({ id: o.id }));
      return { ok: true, cancelled: results.length, result: results };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}

// Round to the MNQ/MES tick (0.25).
function tick(n) { return Number.isFinite(n) ? Math.round(n * 4) / 4 : n; }

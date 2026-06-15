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

function tradesDir() { return TRADES_DIR; }
function today() { return new Date().toISOString().slice(0, 10); }

async function guarded(payload) {
  const fills = readFills(tradesDir(), today());
  const dayState = { realizedLossUsd: dayRealizedLossUsd(fills) };
  return checkOrder({ hasStop: payload?.hasStop, sizing: payload?.sizing, guards: payload?.guards, dayState });
}

export function registerExecutionIpc() {
  // Automation mode + risk knobs + guardrails. The settings popover reads on
  // mount and writes on change; the main-process tranche manager reads this to
  // enforce guardrails on auto-fired orders (no ticket to attach them to).
  ipcMain.handle("execution:config", async (_e, arg = {}) => {
    try {
      if (arg?.action === "set" && arg.patch) return { ok: true, config: writeExecConfig(arg.patch) };
      return { ok: true, config: readExecConfig() };
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
      const state = {
        connected: feed.connected || dom.connected,
        account: dom.account ?? feed.accountId ?? null,
        position: feed.position ?? dom.position ?? null,
        balance: feed.balance ?? dom.balance ?? null,
        price: dom.price ?? null,
        workingOrders: feed.workingOrders ?? [],
        source: feed.position != null || feed.connected ? "ws" : "dom",
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
      try { return { ok: true, result: await tvAdapter[verb](payload) }; }
      catch (e) { return { ok: false, error: String(e?.message || e) }; }
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

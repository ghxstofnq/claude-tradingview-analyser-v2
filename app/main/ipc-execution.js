// app/main/ipc-execution.js
// execution:* IPC. Place/flatten/panic run guardrails first (place) and
// delegate to the adapter; state is read-only. Placement is gated on M0, so
// these return the adapter's NOT_IMPLEMENTED error as a structured result
// rather than throwing across IPC.
import { ipcMain } from "electron";
import { tvAdapter } from "./execution/tv-adapter.js";
import { checkOrder } from "./execution/guardrails.js";
import { readFills, dayRealizedLossUsd } from "./execution/fills.js";
import { getTradingState } from "./execution/trading-feed.js";
import { TRADES_DIR } from "./execution/config.js";

function tradesDir() { return TRADES_DIR; }
function today() { return new Date().toISOString().slice(0, 10); }

async function guarded(payload) {
  const fills = readFills(tradesDir(), today());
  const dayState = { realizedLossUsd: dayRealizedLossUsd(fills) };
  return checkOrder({ hasStop: payload?.hasStop, sizing: payload?.sizing, guards: payload?.guards, dayState });
}

export function registerExecutionIpc() {
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
        workingOrders: dom.workingOrders ?? [],
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
  for (const verb of ["flatten", "panic", "moveStopToBE", "trail", "cancel", "addToPosition"]) {
    ipcMain.handle(`execution:${verb}`, async (_e, payload) => {
      try { return { ok: true, result: await tvAdapter[verb](payload) }; }
      catch (e) { return { ok: false, error: String(e?.message || e) }; }
    });
  }
}

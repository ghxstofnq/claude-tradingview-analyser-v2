// app/main/ipc-execution.js
// execution:* IPC. Place/flatten/panic run guardrails first (place) and
// delegate to the adapter; state is read-only. Placement is gated on M0, so
// these return the adapter's NOT_IMPLEMENTED error as a structured result
// rather than throwing across IPC.
import { ipcMain } from "electron";
import { tvAdapter } from "./execution/tv-adapter.js";
import { checkOrder } from "./execution/guardrails.js";
import { readFills, dayRealizedLossUsd } from "./execution/fills.js";
import { join } from "node:path";

// tradesDir resolver — state/trades under the project state root.
function tradesDir() { return join(process.cwd(), "state", "trades"); }
function today() { return new Date().toISOString().slice(0, 10); }

async function guarded(payload) {
  const fills = readFills(tradesDir(), today());
  const dayState = { realizedLossUsd: dayRealizedLossUsd(fills) };
  return checkOrder({ hasStop: payload?.hasStop, sizing: payload?.sizing, guards: payload?.guards, dayState });
}

export function registerExecutionIpc() {
  ipcMain.handle("execution:state", async () => {
    try { return { ok: true, state: await tvAdapter.readState() }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
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

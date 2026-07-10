// app/main/ipc-readiness.js
// IPC for the unified readiness card (Task C1). One handler — `readiness:get`
// — runs the pure reducer (app/main/readiness.js) over live getters and returns
// the SAME readiness object the System page, the Backtest hero, and the Settings
// page all render. No page invents its own "ready".
//
// Every getter is a real source: the git version poll (passed in from
// electron-main, where it's created), the health monitor's last snapshot, and
// the execution account gate. Anything that throws degrades to a null fact →
// an `unavailable` row, never a fabricated pass.

import { ipcMain } from "electron";
import { collectSystemReadiness } from "./readiness.js";
import { getLastHealth } from "./health.js";

// Normalise the execution account state into the readiness account fact. Mirrors
// ipc-execution's accountState() + resolveAccountGate, kept fail-closed.
async function readAccountFact() {
  try {
    const { getActiveAccount } = await import("./execution/active-account.js");
    const { readExecConfig } = await import("./execution/config.js");
    const { resolveAccountGate } = await import("./execution/account-gate.js");
    const active = getActiveAccount?.() ?? null;
    if (!active) return { connected: false, route: false, needsConfirm: false, level: null, name: null, live: false };
    const confirmed = readExecConfig()?.confirmedAccount ?? null;
    const gate = resolveAccountGate({ active, confirmed }) ?? {};
    const routed = gate.route === true;
    // "live" is true when the account we'd actually route to is a real-money one:
    // the confirmed account when routed, else the active account pending confirm.
    const live = routed ? (confirmed?.type === "live") : (active.type === "live");
    return {
      connected: true,
      route: routed,
      needsConfirm: gate.needsConfirm === true,
      level: gate.level ?? null,
      name: active.name ?? confirmed?.name ?? null,
      live,
    };
  } catch {
    return null;
  }
}

export function registerReadinessIpc({ getVersion } = {}) {
  ipcMain.handle("readiness:get", async (_evt, { symbol } = {}) => {
    try {
      const readiness = await collectSystemReadiness({
        symbol: symbol || "MNQ1!",
        cwd: process.cwd(),
        env: process.env,
        getVersion,
        getHealth: getLastHealth,
        getAccount: readAccountFact,
      });
      return { ok: true, readiness };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

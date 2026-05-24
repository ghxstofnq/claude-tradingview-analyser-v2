// IPC handlers — the bridge between the renderer's UI and main's services.

import { ipcMain } from "electron";
import { userTurn } from "./sdk.js";
import { startDetector, stopDetector } from "./bar-close.js";
import { acceptSetup, rejectSetup } from "./trades.js";
import { activeSessionDir } from "./sessions.js";
import { foldOpenTrades } from "../../cli/lib/trade-outcomes.js";
import { startAlertPolling, stopAlertPolling, setAlertMode } from "./alerts.js";
import { tvAlertCreate } from "./tools/tv-alerts.js";
import { runManualRefresh, getBriefForToday, activeOrImminentSession } from "./session-brief.js";
import { listSessionFiles, openPath, revealInFolder, readFileForViewer } from "./fs-inspect.js";
import { getSessionRecap, getOpenReaction, getSetupsList } from "./session-views.js";
import { listSessionFolders, getJournalFor, getLibrary, getDefaultJournal } from "./review.js";
import { getLastBar } from "./last-bar.js";
import { getCache as getSymbolCache } from "./symbol-cache.js";
import fs from "node:fs/promises";
import path from "node:path";

export function registerIpc(win) {
  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle("chat:send_message", async (_evt, { text }) => {
    try {
      await userTurn({
        text,
        onEvent: (ev) => {
          if (ev.type === "chunk") send("chat:chunk", ev);
          else if (ev.type === "tool_call") send("chat:tool_call", ev);
          else if (ev.type === "turn_complete") send("chat:turn_complete", ev);
          else if (ev.type === "error") send("app:error", { source: "sdk", message: ev.message });
        },
      });
      return { ok: true };
    } catch (err) {
      send("app:error", { source: "ipc:chat", message: String(err?.message || err) });
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("mode:switch", async (_evt, { mode }) => {
    if (mode === "live") startDetector({ send });
    else stopDetector();
    setAlertMode(mode);
    return { ok: true };
  });

  ipcMain.handle("alert:arm", async (_evt, { price, label }) => {
    try {
      await tvAlertCreate({ price, label });
      return { ok: true };
    } catch (err) {
      send("app:error", { source: "alert:arm", message: String(err?.message || err) });
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("trade:accept", async (_evt, { setup }) => {
    try {
      const trade = await acceptSetup({ setup, send });
      return { ok: true, trade };
    } catch (err) {
      send("app:error", { source: "trade:accept", message: String(err?.message || err) });
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("trade:reject", async (_evt, { setupId, reason }) => {
    try {
      const ev = await rejectSetup({ setupId, reason, send });
      return { ok: true, event: ev };
    } catch (err) {
      send("app:error", { source: "trade:reject", message: String(err?.message || err) });
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("trades:list", async () => {
    try {
      const dir = await activeSessionDir();
      const file = path.join(dir, "trades.jsonl");
      const txt = await fs.readFile(file, "utf8").catch(() => "");
      const events = txt.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      return { ok: true, open: foldOpenTrades(events), events };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("prep:get", async () => {
    const session = activeOrImminentSession();
    const brief = session ? await getBriefForToday(session) : null;
    return { ok: true, session, brief };
  });

  ipcMain.handle("prep:run", async () => {
    runManualRefresh().catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("files:list", async () => {
    try {
      return { ok: true, ...(await listSessionFiles()) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("files:open", async (_evt, { path: p }) => {
    try {
      await openPath(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("files:reveal", async (_evt, { path: p }) => {
    revealInFolder(p);
    return { ok: true };
  });

  ipcMain.handle("files:read", async (_evt, { path: p }) => {
    try {
      return await readFileForViewer(p);
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("prep:recap_get", async () => {
    try {
      return { ok: true, ...(await getSessionRecap()) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("prep:open_reaction_get", async (_evt, args = {}) => {
    try {
      return { ok: true, ...(await getOpenReaction(args.session)) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("live:setups_list", async (_evt, args = {}) => {
    try {
      return { ok: true, ...(await getSetupsList(args.session, args.limit)) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("review:list_sessions", async () => {
    try {
      return { ok: true, sessions: await listSessionFolders() };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("review:get_journal", async (_evt, args = {}) => {
    try {
      if (args.date && args.session) {
        const j = await getJournalFor({ date: args.date, session: args.session });
        return { ok: true, journal: j };
      }
      const j = await getDefaultJournal();
      return { ok: true, journal: j };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("review:library", async (_evt, args = {}) => {
    try {
      return { ok: true, rows: await getLibrary({ limit: args.limit }) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("status:last_bar_get", async () => {
    try {
      return { ok: true, last_bar: await getLastBar() };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("quote:cache_get", async () => {
    try {
      return { ok: true, cache: await getSymbolCache() };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  return { send };
}

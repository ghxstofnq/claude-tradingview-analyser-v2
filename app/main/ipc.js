// IPC handlers — the bridge between the renderer's UI and main's services.

import { ipcMain } from "electron";
import { userTurn, cancelCurrentTurn, resetSession, addActivityListener } from "./sdk.js";
import { startDetector, stopDetector } from "./bar-close.js";
import { record as recordMetric, readRows as loadMetricRows } from "./metrics.js";
import { summarizeUsage, todayET } from "./usage.js";
import { getPersistentMemory } from "./persistent-memory.js";
import { acceptSetup, rejectSetup } from "./trades.js";
import { activeSessionDir } from "./sessions.js";
import { foldOpenTrades } from "../../cli/lib/trade-outcomes.js";
import { startAlertPolling, stopAlertPolling } from "./alerts.js";
import { setMode } from "./mode.js";
import { tvAlertCreate, tvAlertDeleteOne } from "./tools/tv-alerts.js";
import { runManualRefresh, getBriefForToday, getBriefsBySymbolForToday, activeOrImminentSession } from "./session-brief.js";
import { getCurrentSurfaceState, clearCurrentSurfaceState } from "./tools/surface.js";
import { listSessionFiles, openPath, revealInFolder, readFileForViewer } from "./fs-inspect.js";
import { getSessionRecap, getOpenReaction, getSetupsList } from "./session-views.js";
import { listSessionFolders, getJournalFor, getLibrary, getDefaultJournal, getPriorBrief } from "./review.js";
import { getLastBar } from "./last-bar.js";
import { getCache as getSymbolCache } from "./symbol-cache.js";
import { readCache as readCalendarCache } from "./calendar.js";
import { registerBacktestIpc } from "./ipc-backtest.js";
import fs from "node:fs/promises";
import path from "node:path";

export function registerIpc(win) {
  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // Forward every userTurn event (from any purpose) to the renderer so the
  // CLAUDE conversation can show what Claude is doing across all purposes.
  addActivityListener((ev) => send("claude:activity", ev));

  // Start / stop the bar-close detector from the LIVE popover. Idempotent
  // — startDetector already no-ops if a detector is alive.
  ipcMain.handle("detector:start", async () => {
    try { startDetector({ send }); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });
  ipcMain.handle("detector:stop", async () => {
    try { stopDetector(); send("health:update", { detector: "stopped" }); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  ipcMain.handle("chat:send_message", async (_evt, { text, provider } = {}) => {
    recordMetric({ kind: "chat", event: "started" });
    const startedAt = Date.now();
    let errored = false;
    let usage = null;
    try {
      await userTurn({
        text,
        purpose: "chat",
        providerOverride: provider,
        onEvent: (ev) => {
          if (ev.type === "chunk") send("chat:chunk", ev);
          else if (ev.type === "tool_call") send("chat:tool_call", ev);
          else if (ev.type === "turn_complete") send("chat:turn_complete", ev);
          // #44 Surface queue events to the chat panel.
          else if (ev.type === "queued") send("chat:queued", ev);
          else if (ev.type === "queue_ready") send("chat:queue_ready", ev);
          else if (ev.type === "usage") { usage = ev.usage; }
          else if (ev.type === "error") {
            errored = true;
            send("app:error", { source: "sdk", message: ev.message, provider: ev.provider });
          }
        },
      });
      recordMetric({
        kind: "chat",
        event: errored ? "failed" : "succeeded",
        durationMs: Date.now() - startedAt,
        usage,
      });
      return { ok: true };
    } catch (err) {
      recordMetric({
        kind: "chat",
        event: "failed",
        durationMs: Date.now() - startedAt,
        reason: String(err?.message || err),
      });
      send("app:error", { source: "ipc:chat", message: String(err?.message || err), provider });
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // Daily usage insight — sums today's spend across all turns. Backs the
  // dashboard's "today's spend" panel.
  ipcMain.handle("usage:today", async () => {
    try {
      const rows = await loadMetricRows();
      return summarizeUsage(rows, { day: todayET() });
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  });

  // Persistent memory read — current contents of state/memory/{USER,MEMORY}.md
  // for the REVIEW panel's agent-state cards. Read-only view; mutations go
  // through the model via the memory MCP tool.
  ipcMain.handle("memory:read", async () => {
    try {
      const mem = getPersistentMemory();
      await mem.load();
      const userEntries = [...mem.userEntries];
      const memoryEntries = [...mem.memoryEntries];
      const userTotal = userEntries.join("").length + Math.max(0, userEntries.length - 1) * 3; // approx §\n delimiter
      const memTotal = memoryEntries.join("").length + Math.max(0, memoryEntries.length - 1) * 3;
      return {
        ok: true,
        user: {
          entries: userEntries,
          char_count: userTotal,
          char_limit: 1500,
          pct: Math.min(100, Math.floor((userTotal / 1500) * 100)),
        },
        memory: {
          entries: memoryEntries,
          char_count: memTotal,
          char_limit: 2000,
          pct: Math.min(100, Math.floor((memTotal / 2000) * 100)),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("chat:cancel_turn", async () => {
    // Kill switch: abort the currently-running Claude turn (any purpose).
    // Mutex releases; next queued turn starts as usual.
    const cancelled = cancelCurrentTurn();
    return { ok: true, cancelled };
  });

  ipcMain.handle("pair-decision:reset", async () => {
    // #37 Trader wants to switch pair mid-day (e.g. MNQ → MGC).
    // Delete pair-decision.json so the next bar-close catch-up turn
    // re-picks. activeSessionDir gives us today's folder.
    try {
      const dir = await activeSessionDir();
      const file = path.join(dir, "pair-decision.json");
      await fs.unlink(file);
      return { ok: true, deleted: file };
    } catch (err) {
      if (err?.code === "ENOENT") return { ok: true, deleted: null };
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("setup:current", async () => {
    // #11 Re-hydration endpoint: EntryHunt mounts on every mode switch
    // back to LIVE. Without this, activeSetup state would be empty
    // until the next surface_setup call. Returns the most-recent
    // surface state mirrored in main.
    return { ok: true, ...getCurrentSurfaceState() };
  });

  ipcMain.handle("setup:clear", async () => {
    // Called from the trader's Accept / Reject buttons. Clears main's
    // mirror so subsequent mode flips don't re-show the stale setup.
    clearCurrentSurfaceState();
    return { ok: true };
  });

  ipcMain.handle("chat:reset", async (_evt, { provider } = {}) => {
    // Reset the active provider's 'chat' purpose session id so the next user
    // message starts a fresh conversation. Doesn't touch brief / wrap /
    // bar-close sessions or the other provider's chat history.
    resetSession("chat", provider || "claude");
    return { ok: true };
  });

  // mode:switch IPC removed 2026-05-28 — PREP/LIVE/REVIEW are popovers now,
  // no more mode tabs. setMode() still exists for internal main-process use
  // (see mode.js) but the renderer no longer drives it.

  ipcMain.handle("alert:arm", async (_evt, { price, label }) => {
    try {
      const result = await tvAlertCreate({ price, label });
      // Drift > 0 means TV rounded the price (fractional ticks). Worth knowing
      // so the renderer can show the actual created price instead of the
      // requested one.
      if (result.drift_warning) {
        send("app:error", { source: "alert:arm", message: result.drift_warning, level: "warn" });
      }
      return { ok: true, ...result };
    } catch (err) {
      send("app:error", { source: "alert:arm", message: String(err?.message || err) });
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("alert:disarm", async (_evt, { id }) => {
    try {
      const result = await tvAlertDeleteOne({ id });
      return { ok: true, ...result };
    } catch (err) {
      send("app:error", { source: "alert:disarm", message: String(err?.message || err) });
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("trade:accept", async (_evt, { setup }) => {
    try {
      const trade = await acceptSetup({ setup, send });
      // acceptSetup returns { error: "..." } when dedup/single-trade
      // guard rejects — surface to UI so the trader sees a toast
      // instead of silent no-op.
      if (trade?.error) {
        send("app:error", { source: "trade:accept", message: trade.error, level: "warn" });
        return { ok: false, error: trade.error, openTradeId: trade.openTradeId };
      }
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
    const briefsBySymbol = session ? await getBriefsBySymbolForToday(session) : {};
    return { ok: true, session, brief, briefsBySymbol };
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

  ipcMain.handle("review:export_session", async (_evt, { date, session } = {}) => {
    // Bundles brief + summary + setups + trades for one session into a
    // single JSON file at ~/Downloads/session-<date>-<session>.json.
    // Use case: trader exports the day's journal for spreadsheet / review
    // outside the app. Returns { ok, path } so the renderer can show
    // "saved to <path>".
    try {
      if (!date || !session) throw new Error("date and session required");
      const journal = await getJournalFor({ date, session });
      if (!journal) throw new Error("no journal found for that session");
      const { app: electronApp } = await import("electron");
      const downloads = electronApp.getPath("downloads");
      const outPath = path.join(downloads, `session-${date}-${session}.json`);
      await fs.writeFile(outPath, JSON.stringify(journal, null, 2), "utf8");
      return { ok: true, path: outPath };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("prep:prior_brief_get", async (_evt, args = {}) => {
    // Returns the most recent brief.json for the same session that's NOT
    // today. Used by the "what changed since last brief" diff panel.
    try {
      const prior = await getPriorBrief({
        session: args.session,
        excludeDate: args.excludeDate,
      });
      return { ok: true, prior };
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

  ipcMain.handle("calendar:this-week", async () => {
    try {
      const payload = await readCalendarCache();
      return { ok: true, ...payload };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // Backtest IPC — start/stop/decision/list/get/delete + backtest:event stream
  registerBacktestIpc(win);

  return { send };
}

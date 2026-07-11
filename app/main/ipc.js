// IPC handlers — the bridge between the renderer's UI and main's services.

import { ipcMain } from "electron";
import { userTurn, cancelCurrentTurn, resetSession, addActivityListener } from "./sdk.js";
import { startDetector, stopDetector } from "./bar-close.js";
import { relaunchTvWithCdp } from "./tv-launcher.js";
import { record as recordMetric, readRows as loadMetricRows } from "./metrics.js";
import { summarizeUsage, todayET } from "./usage.js";
import { getPersistentMemory } from "./persistent-memory.js";
import { acceptSetup, rejectSetup } from "./trades.js";
import { activeSessionDir } from "./sessions.js";
import { foldOpenTrades } from "../../cli/lib/trade-outcomes.js";
import { parseJsonlTolerant } from "../../cli/lib/jsonl.js";
import { startAlertPolling, stopAlertPolling, getAlertsSnapshot } from "./alerts.js";
import { setMode } from "./mode.js";
import { noteManualStop, noteManualStart, nudgeSupervisor } from "./session-supervisor.js";
import { listFixtures, runFixture, runAllFixtures, readFixtureExpected } from "./fixtures.js";
import { tvAlertCreate, tvAlertDeleteOne } from "./tools/tv-alerts.js";
import { runManualRefresh, getBriefForToday, getBriefsBySymbolForToday, activeOrImminentSession, getAiPrepForToday, saveAiPrepForToday } from "./session-brief.js";
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
  //
  // Critical: the detector process alone is not enough. handleBar() gates
  // every analysis turn on isLive(); when the PREP/LIVE/REVIEW tabs became
  // popovers, the old mode:switch IPC was removed. Without setting mode here,
  // LIVE HUNT could show a running detector while isLive() stayed false — no
  // bars.jsonl, scans, walkers, deterministic truth, setups, or trades.
  ipcMain.handle("detector:start", async () => {
    try { noteManualStart(); setMode("live"); startDetector({ send }); ipc.send("mode:current", { mode: "live" }); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });
  ipcMain.handle("detector:stop", async () => {
    // noteManualStop tells the session supervisor not to auto-re-arm for the
    // remainder of this session — a deliberate stop must stay stopped.
    try { noteManualStop(); stopDetector(); setMode("prep"); send("health:update", { detector: "stopped" }); ipc.send("mode:current", { mode: "prep" }); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // Auto-journal (plan 2026-07-09 Task 5): the dismissible note prompt writes
  // back to the day's journal row; the day read backs REVIEW's closes list.
  ipcMain.handle("journal:note", async (_evt, arg = {}) => {
    try { const { addNote } = await import("./journal.js"); return addNote(arg); }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });
  ipcMain.handle("journal:day", async (_evt, arg = {}) => {
    try { const { readJournal } = await import("./journal.js"); return { ok: true, rows: readJournal(arg) }; }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // Relaunch TV Desktop with the CDP debug flag (hard constraint #1 recipe).
  // No detector restart needed: the poll loop retries connection errors every
  // bar boundary, so it self-heals the moment 9225 answers again.
  ipcMain.handle("tv:relaunch", async () => {
    try { return await relaunchTvWithCdp(); }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // Kick the session supervisor's watchdog now (re-checks readiness, auto-arms,
  // and restarts a stale detector out of band). This is the real "restart
  // supervision" — distinct from detector:start (which only starts the detector).
  ipcMain.handle("supervisor:nudge", async () => {
    try { await nudgeSupervisor(); return { ok: true, mode: "nudged" }; }
    catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // Read-only fixtures runner (System page). Lists + runs the hand-graded
  // regression fixtures via the existing smoke/verify scripts; no writes.
  ipcMain.handle("fixtures:list", async () => {
    try { return listFixtures(); } catch (err) { return { ok: false, error: String(err?.message || err), fixtures: [] }; }
  });
  ipcMain.handle("fixtures:run", async (_evt, { id } = {}) => {
    try { if (!id) throw new Error("id required"); return await runFixture(id); }
    catch (err) { return { ok: false, status: "fail", error: String(err?.message || err) }; }
  });
  ipcMain.handle("fixtures:run_all", async () => {
    try { return await runAllFixtures(); } catch (err) { return { ok: false, status: "fail", error: String(err?.message || err) }; }
  });
  ipcMain.handle("fixtures:expected", async (_evt, { id } = {}) => {
    try { if (!id) throw new Error("id required"); return readFixtureExpected(id); }
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

  // On-demand PREP/LIVE deep read (Track 2 §2b item 3). Runs under the isolated
  // "analysis" purpose on its own `analysis:*` channel — NOT the shared chat
  // channel — so a deep read never pollutes the chat session/context and its
  // prose never leaks into the CLAUDE/BRAIN feed. resetSession fires per run
  // (inside runAnalysisTurn), so each read is a fresh, independent question.
  ipcMain.handle("analysis:run", async (_evt, { text, provider } = {}) => {
    const { runAnalysisTurn } = await import("./analysis-turn.js");
    return runAnalysisTurn({
      text,
      provider,
      onEvent: (ev) => {
        if (ev.type === "chunk") send("analysis:chunk", ev);
        else if (ev.type === "tool_call") send("analysis:tool_call", ev);
        else if (ev.type === "turn_complete") send("analysis:turn_complete", ev);
        else if (ev.type === "queued") send("analysis:queued", ev);
        else if (ev.type === "queue_ready") send("analysis:queue_ready", ev);
        else if (ev.type === "error") send("app:error", { source: "ipc:analysis", message: ev.message, provider: ev.provider });
      },
    });
  });

  // On-demand anomaly explainer (Track 2 §2b item 5). When readiness goes red or
  // an app:error fires, the operator clicks EXPLAIN on the System page. Runs under
  // the isolated "explain" purpose on its own `explain:*` channel — never the
  // chat channel. The renderer passes the anomaly `event` + a fresh `readiness`
  // snapshot (from the readiness:get IPC); we add the last health snapshot
  // (getLastHealth) here so the whole context is main-authoritative. A failure is
  // relayed on `explain:error` (rendered inline on the System page), NOT on
  // app:error — so explaining an app:error can't spawn a fresh app:error into the
  // very list the explanation renders in. The main-side in-flight gate (inside
  // runExplainTurn) rejects a second concurrent EXPLAIN.
  ipcMain.handle("explain:run", async (_evt, { event, readiness, provider } = {}) => {
    const { runExplainTurn } = await import("./explain-turn.js");
    const { getLastHealth } = await import("./health.js");
    return runExplainTurn({
      event,
      readiness: readiness ?? null,
      health: getLastHealth(),
      provider,
      onEvent: (ev) => {
        if (ev.type === "chunk") send("explain:chunk", ev);
        else if (ev.type === "turn_complete") send("explain:turn_complete", ev);
        else if (ev.type === "error") send("explain:error", { source: "ipc:explain", message: ev.message, provider: ev.provider });
      },
    });
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

  // Cached last-known armed list (no CDP call) — initial paint for bells/counts.
  ipcMain.handle("alerts:get", async () => ({ ok: true, ...getAlertsSnapshot() }));

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
      // Tolerant parse (C20): a torn line must not blank the REVIEW/LIVE lists.
      const { records: events } = parseJsonlTolerant(txt);
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

  // AI Prep — saved one-shot AI brief beside the deterministic one.
  ipcMain.handle("prep:aiGet", async (_evt, { symbol } = {}) => {
    const session = activeOrImminentSession();
    const record = session ? await getAiPrepForToday(session, symbol) : null;
    return { ok: true, session, record };
  });

  ipcMain.handle("prep:aiSave", async (_evt, { symbol, record } = {}) => {
    try {
      const session = activeOrImminentSession();
      if (!session) return { ok: false, error: "no active session" };
      return await saveAiPrepForToday(session, symbol, record);
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
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

  // Weekly coach narration (Track 2 §2b item 2). Read the persisted coach.md
  // (absent → no card); the renderer parses/sanitizes the raw text. Also compute
  // the CURRENT digest hash so the card can flag a stale read (stored != current)
  // — the stored hash rode in on the coach.md frontmatter.
  ipcMain.handle("review:coach_get", async () => {
    try {
      const { readCoachRaw, parseStoredDigestHash, computeCurrentDigestHash } = await import("./coach-assist.js");
      const { getRecentJournals } = await import("./review.js");
      const coach = await readCoachRaw();
      if (!coach) return { ok: true, coach: null };
      const stored_hash = parseStoredDigestHash(coach);
      let current_hash = null;
      try { current_hash = await computeCurrentDigestHash({ loadJournals: getRecentJournals }); } catch { /* best-effort */ }
      return { ok: true, coach, stored_hash, current_hash };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // On-demand: build the deterministic digest over recent sessions and run one
  // coach turn. The session fold runs INSIDE the in-flight gate (passed as a lazy
  // loader), so a rapid double-click is rejected before it double-folds disk. On
  // any failure NO file is written and the error is surfaced via app:error so
  // the renderer shows a toast and re-enables the button.
  ipcMain.handle("review:coach_generate", async (_evt, args = {}) => {
    try {
      const { getRecentJournals } = await import("./review.js");
      const { generateCoach, COACH_DEFAULT_SESSIONS } = await import("./coach-assist.js");
      const limit = Number(args?.limit) > 0 ? Number(args.limit) : COACH_DEFAULT_SESSIONS;
      const res = await generateCoach({ loadJournals: getRecentJournals, limit });
      if (!res.ok && !res.inFlight) {
        send("app:error", { source: "review:coach", level: "warn", message: res.error || "coach read failed" });
      }
      return res;
    } catch (err) {
      send("app:error", { source: "review:coach", level: "warn", message: String(err?.message || err) });
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

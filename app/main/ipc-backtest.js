// app/main/ipc-backtest.js
// IPC layer for the Backtest popover. Wraps the deterministic engine in
// start/stop/decision handlers + provides list/get/delete against the
// on-disk store. Broadcasts every "backtest:event" emitted by the engine to
// all browser windows so the renderer's useBacktest hook can react.
//
// Production deps (2026-06-12 deterministic rewrite): the engine records a
// replay-stepped tape via packages/core CDP calls, folds it through the
// REAL walker chain (bar-close __test truth fn), and grades outcomes from
// the recorded bars. No LLM anywhere in the loop — cost is $0.
//
// Only one run can be in flight at a time (the TV chart is shared). The
// `currentBus` + `currentRunPromise` module-locals enforce that.

import { ipcMain } from "electron";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import { runBacktest } from "./backtest-engine.js";
import { readIndex, reconcileAbortedRuns, resolveRunDir } from "./backtest-store.js";
import { PROD_DEPS, STATE_DIR } from "./backtest-deps.js";
import { readBaseline, readHistory, refoldBaseline } from "./backtest-baseline.js";

// ─────────────────────────────────────────────────────────────────────
// Singleton run state — enforces exclusive mode.
// ─────────────────────────────────────────────────────────────────────
let currentBus = null;
let currentRunPromise = null;

export function isBacktestRunning() {
  return currentRunPromise !== null;
}

export function registerBacktestIpc(win, { deps = PROD_DEPS } = {}) {
  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle("backtest:start", async (_evt, { date, session, mode, symbol }) => {
    if (currentRunPromise) throw new Error("a backtest is already running");
    if (!date || !session || !mode) throw new Error("date, session, mode required");

    currentBus = new EventEmitter();
    currentBus.on("backtest:event", (e) => send("backtest:event", e));

    currentRunPromise = (async () => {
      try {
        return await runBacktest({ date, session, mode, symbol, bus: currentBus, stateDir: STATE_DIR, deps });
      } finally {
        currentBus = null;
        currentRunPromise = null;
      }
    })().catch((err) => {
      // Surface but don't crash the main process. The engine already
      // persisted an error summary; this line puts it in the main log too.
      // eslint-disable-next-line no-console
      console.error("[backtest] run failed:", err.message);
      send("backtest:event", { type: "error", message: err.message });
      return null;
    });

    return { started: true };
  });

  ipcMain.handle("backtest:stop", async () => {
    if (!currentBus) return { stopped: false, reason: "no_active_run" };
    currentBus.emit("backtest:command", { type: "stop" });
    return { stopped: true };
  });

  ipcMain.handle("backtest:decision", async (_evt, { choice, setupId, reason }) => {
    if (!currentBus) throw new Error("no active run to decide on");
    currentBus.emit("backtest:command", { type: "decision", choice, setupId, reason });
    return { ok: true };
  });

  ipcMain.handle("backtest:list", async () => {
    const ix = readIndex({ stateDir: STATE_DIR });
    const aborted = reconcileAbortedRuns({ stateDir: STATE_DIR });
    return { runs: [...ix.runs, ...aborted] };
  });

  ipcMain.handle("backtest:get", async (_evt, { runId }) => {
    const ix = readIndex({ stateDir: STATE_DIR });
    const entry = ix.runs.find((r) => r.run_id === runId) ?? null;
    if (!entry) return { entry: null, setups: [], activity: [] };
    const sessionDir = resolveRunDir({ stateDir: STATE_DIR, runId });
    return {
      entry,
      setups: readJsonl(path.join(sessionDir, "setups.jsonl")),
      activity: readJsonl(path.join(sessionDir, "activity.jsonl")),
      summaryMd: readTextIfExists(path.join(sessionDir, "summary.md")),
    };
  });

  ipcMain.handle("backtest:delete", async (_evt, { runId }) => {
    const ix = readIndex({ stateDir: STATE_DIR });
    const next = { runs: ix.runs.filter((r) => r.run_id !== runId) };
    const indexFile = path.join(STATE_DIR, "backtest", "index.json");
    if (fs.existsSync(path.dirname(indexFile))) {
      fs.writeFileSync(indexFile, JSON.stringify(next, null, 2));
    }
    const folder = path.join(STATE_DIR, "backtest", runId);
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    return { deleted: true };
  });

  ipcMain.handle("backtest:status", async () => ({
    running: isBacktestRunning(),
  }));

  // ── Faithful baseline (fold-week regen + AM->PM carry) ────────────────
  // get is cheap (reads the cached file); refold re-folds the corpus (pure
  // compute, no TV) and can take ~1-2 min for a full symbol corpus.
  ipcMain.handle("backtest:baseline:get", async (_evt, { symbol }) => ({
    baseline: readBaseline({ stateDir: STATE_DIR, symbol }),
  }));

  ipcMain.handle("backtest:baseline:history", async (_evt, { symbol }) => ({
    history: readHistory({ stateDir: STATE_DIR, symbol }),
  }));

  ipcMain.handle("backtest:baseline:refold", async (_evt, { symbol, reason }) => {
    const baseline = await refoldBaseline({ stateDir: STATE_DIR, symbol, reason });
    return { baseline };
  });
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .trim().split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

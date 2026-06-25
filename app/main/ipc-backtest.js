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
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { runBacktest } from "./backtest-engine.js";
import { readIndex, reconcileAbortedRuns, resolveRunDir } from "./backtest-store.js";
import { PROD_DEPS, STATE_DIR } from "./backtest-deps.js";
import {
  readBaseline, readHistory, refoldBaseline,
  listTests, readTest, writeTestVerdict, deleteTest,
} from "./backtest-baseline.js";
import { acquireChartForBacktest, releaseChartAfterBacktest } from "./backtest-lock.js";
import { stopDetector } from "./bar-close.js";
import { setMode } from "./mode.js";
import { nudgeSupervisor } from "./session-supervisor.js";

// Pause the live loop and hand TV to the backtest — both drive the one chart
// (CDP 9225). Idempotent (safe to call per study job): stop the detector, drop
// out of live mode, and hold the coordination lock so the supervisor stands
// down. Live re-arms automatically once the lock releases.
function pauseLiveForBacktest() {
  acquireChartForBacktest();
  try { stopDetector(); } catch { /* not running */ }
  try { setMode("prep"); } catch { /* best-effort */ }
}

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

    // Take the chart from the live loop for the duration of this run/study.
    pauseLiveForBacktest();

    currentRunPromise = (async () => {
      try {
        return await runBacktest({ date, session, mode, symbol, bus: currentBus, stateDir: STATE_DIR, deps });
      } finally {
        currentBus = null;
        currentRunPromise = null;
        // Debounced — a multi-job study's next job re-acquires before this
        // fires, so the lock holds across the whole study; when it finally
        // clears, nudge the supervisor to re-arm live now.
        releaseChartAfterBacktest({ onRelease: nudgeSupervisor });
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

  // ── Fold-tests (accept/reject records; created out-of-band by the script) ──
  ipcMain.handle("backtest:tests:list", async (_evt, { symbol }) => ({
    tests: listTests({ stateDir: STATE_DIR, symbol }),
  }));

  ipcMain.handle("backtest:tests:get", async (_evt, { id }) => ({
    test: readTest({ stateDir: STATE_DIR, id }),
  }));

  ipcMain.handle("backtest:tests:verdict", async (_evt, { id, status, reason }) => ({
    test: writeTestVerdict({ stateDir: STATE_DIR, id, status, reason }),
  }));

  ipcMain.handle("backtest:tests:delete", async (_evt, { id }) => deleteTest({ stateDir: STATE_DIR, id }));

  // Fold a treatment over the corpus from the UI (replaces the CLI
  // save-fold-test.mjs step). Runs in a CHILD process so the treatment env gate
  // is isolated from the live chain — never sets a gate on the main process.
  // Pure compute (no chart), so it's safe even during a live session.
  ipcMain.handle("backtest:tests:run", async (_evt, { symbol, label, env } = {}) => {
    if (!symbol || !label) return { ok: false, error: "symbol and label required" };
    const repo = path.dirname(STATE_DIR);
    const script = path.join(repo, "scripts", "save-fold-test.mjs");
    const childEnv = { ...process.env, ...(env && typeof env === "object" ? env : {}) };
    return await new Promise((resolve) => {
      const child = spawn("node", [script, symbol, label], { cwd: repo, env: childEnv });
      let out = "", err = "";
      child.stdout.on("data", (b) => { out += b.toString(); });
      child.stderr.on("data", (b) => { err += b.toString(); });
      child.on("error", (e) => resolve({ ok: false, error: String(e?.message || e) }));
      child.on("close", (code) => {
        if (code === 0) {
          const m = out.match(/saved test (\S+):/);
          resolve({ ok: true, id: m?.[1] ?? null, stdout: out.trim() });
        } else {
          resolve({ ok: false, error: (err || out).slice(-300).replace(/\s+/g, " ").trim() || `exit ${code}` });
        }
      });
    });
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

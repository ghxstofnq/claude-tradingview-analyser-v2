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
import { fileURLToPath } from "node:url";

import { runBacktest } from "./backtest-engine.js";
import { readIndex, reconcileAbortedRuns, resolveRunDir } from "./backtest-store.js";
import { loadDayContext, contextFromBriefPayloads } from "./backtest-context.js";
import { analyzePairBundle, buildDirectSessionBriefPayloads } from "./direct-session-brief.js";
import { gradeOpenTrade } from "./backtest-grader.js";
import { __test as barCloseTruth } from "./bar-close.js";
import { recordEntries } from "../../cli/lib/tape-recorder.js";
import { parseIctEngineTable, findIctEngineRows } from "../../cli/lib/ict-engine-parser.js";
import * as replay from "../../packages/core/replay.js";
import * as chart from "../../packages/core/chart.js";
import * as data from "../../packages/core/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const STATE_DIR = path.join(REPO_ROOT, "state");
const SYMBOL_SETTLE_MS = 600;

const REPLAY_ANCHORS = { "ny-am": "09:30", "ny-pm": "13:00", london: "03:00" };

async function pinChart(leader) {
  if (!leader) return;
  const state = await chart.getState();
  if (state.symbol.replace(/^[A-Z_]+:/, "") !== leader.replace(/^[A-Z_]+:/, "")) {
    await chart.setSymbol({ symbol: leader });
    await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
  }
  if (state.resolution !== "1") {
    await chart.setTimeframe({ timeframe: "1" });
    await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
  }
}

const CDP_RECORDER_DEPS = {
  startReplay: (args) => replay.start(args),
  stepReplay: () => replay.step(),
  stopReplay: () => replay.stop(),
  readBars: () => data.getOhlcv({ summary: true }),
  readEngine: async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables())),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const PROD_DEPS = {
  loadDayContext: ({ date, session }) => loadDayContext({ date, session }),

  // No day state: capture a pair bundle with the chart anchored at the
  // session open of the historic date (replay shows HTF as-of that date),
  // build the deterministic brief payloads, synthesize a grade-capped
  // context. Payloads are persisted in the run dir for audit.
  async runDirectBrief({ runId, session, date }) {
    const runDir = resolveRunDir({ stateDir: STATE_DIR, runId });
    let bundle = null;
    try {
      await replay.start({ date, time: REPLAY_ANCHORS[session] ?? "09:30" });
      bundle = await analyzePairBundle({ out: path.join(runDir, "brief-bundle.json") });
    } finally {
      try { await replay.stop(); } catch { /* best-effort */ }
    }
    if (!bundle) return null;
    const payloads = buildDirectSessionBriefPayloads({ session, bundle });
    fs.writeFileSync(path.join(runDir, "brief-payloads.json"), JSON.stringify(payloads, null, 2));
    return contextFromBriefPayloads({ session, payloads });
  },

  async recordEntries({ context, date, fromEt, toEt, onBar, isStopped }) {
    await pinChart(context?.leader);
    return recordEntries({
      context, date, fromEt, toEt,
      deps: CDP_RECORDER_DEPS,
      onBar, isStopped,
    });
  },

  truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
  gradeFn: gradeOpenTrade,
};

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

  ipcMain.handle("backtest:start", async (_evt, { date, session, mode }) => {
    if (currentRunPromise) throw new Error("a backtest is already running");
    if (!date || !session || !mode) throw new Error("date, session, mode required");

    currentBus = new EventEmitter();
    currentBus.on("backtest:event", (e) => send("backtest:event", e));

    currentRunPromise = (async () => {
      try {
        return await runBacktest({ date, session, mode, bus: currentBus, stateDir: STATE_DIR, deps });
      } finally {
        currentBus = null;
        currentRunPromise = null;
      }
    })().catch((err) => {
      // Surface but don't crash the main process
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

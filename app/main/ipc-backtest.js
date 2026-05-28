// app/main/ipc-backtest.js
// IPC layer for the Backtest popover. Wraps the engine in start/stop/decision
// handlers + provides list/get/delete against the on-disk store. Broadcasts
// every "backtest:event" emitted by the engine to all browser windows so the
// renderer's useBacktest hook can react.
//
// Only one run can be in flight at a time (the TV chart is shared). The
// `currentBus` + `currentRun` module-locals enforce that.

import { ipcMain } from "electron";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBacktest } from "./backtest-engine.js";
import { readIndex, reconcileAbortedRuns, resolveRunDir } from "./backtest-store.js";
import { userTurn } from "./sdk.js";
import { tvAnalyzeFast } from "./tools/tv-analyze.js";
import * as replay from "../../packages/core/replay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const STATE_DIR = path.join(REPO_ROOT, "state");

// Production injectors: wrap the live module exports into the shape the
// engine expects so engine code stays test-friendly. The engine speaks
// `tv.replay.start/step/stop` and `tv.analyzePillar3()`.
const PROD_TV = {
  replay: {
    start: (opts) => replay.start(opts),
    step: () => replay.step(),
    stop: () => replay.stop(),
  },
  analyzePillar3: async () => tvAnalyzeFast({}),
};

// Engine calls sdk.userTurn — adapter so the production userTurn signature
// (text, purpose, onEvent, timeoutMs, backtestContext) matches what the
// engine wants. We supply a placeholder `text` derived from the purpose;
// the LLM gets the analysis bundle via its own `tvAnalyzeFast` tool call,
// not via the prompt.
const PROD_SDK = {
  async userTurn({ purpose, backtestContext, bundle }) {
    void bundle;  // not consumed in production — LLM fetches via tool
    const text = textForPurpose(purpose);
    let cost = 0;
    let surfacedSetup = null;
    await userTurn({
      purpose,
      text,
      backtestContext,
      onEvent: (ev) => {
        if (ev.type === "turn_complete" && ev.usage?.total_cost_usd != null) {
          cost = ev.usage.total_cost_usd;
        }
        if (ev.type === "tool_call" && ev.name === "surface_setup") {
          // The surface_setup args are the setup object
          surfacedSetup = normalizeSurfacedSetup(ev.args);
        }
      },
    });
    return { cost, surfacedSetup };
  },
};

function textForPurpose(purpose) {
  switch (purpose) {
    case "brief": return "Run the session brief for today.";
    case "bar-close": return "1m bar closed. Analyze and surface a setup if one is in play.";
    case "catch-up": return "Backfill the open-reaction window for the current session.";
    case "wrap": return "Wrap the session — emit the summary.";
    default: return `Run ${purpose} turn.`;
  }
}

function normalizeSurfacedSetup(args) {
  // Pull just the fields the engine + grader need. Tolerant of slight
  // shape differences between the surface_setup tool args and what the
  // engine consumes (id, side, entry, stop, tp1, grade, model).
  if (!args || typeof args !== "object") return null;
  const id = args.id ?? args.setup_id ?? `setup-${Date.now()}`;
  const side = (args.side ?? "").toLowerCase();
  const entry = numericish(args.entry);
  const stop = numericish(args.stop);
  const tp1 = numericish(args.tp1 ?? args.target ?? args.tp);
  if (!side || entry == null || stop == null || tp1 == null) return null;
  return {
    id, side, entry, stop, tp1,
    tp2: numericish(args.tp2),
    grade: args.grade ?? null,
    model: args.model ?? args.entry_model ?? null,
    rationale: args.rationale ?? args.why ?? null,
    ts: args.ts ?? new Date().toISOString(),
  };
}

function numericish(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Singleton run state — enforces exclusive mode.
// ─────────────────────────────────────────────────────────────────────
let currentBus = null;
let currentRunPromise = null;

export function isBacktestRunning() {
  return currentRunPromise !== null;
}

export function registerBacktestIpc(win, { tv = PROD_TV, sdk = PROD_SDK } = {}) {
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
        return await runBacktest({ date, session, mode, tv, sdk, bus: currentBus, stateDir: STATE_DIR });
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

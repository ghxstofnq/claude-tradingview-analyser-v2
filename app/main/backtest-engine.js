// app/main/backtest-engine.js
// Orchestrates one backtest run end-to-end.
//
// Contract:
//   - Caller passes injected `tv` and `sdk` so the engine is testable with
//     mocks. In production these are the live module exports.
//   - Caller passes a `bus` (EventEmitter) for bidirectional comms:
//       outbound: bus.emit("backtest:event", { type, ... })
//       inbound:  bus.on("backtest:command", (cmd) => ...) — e.g. {type:"stop"}
//   - Run state lives at stateDir/backtest/<run-id>/<session>/...
//   - Live state (state/session/...) is never touched because every sdk.userTurn
//     call carries a backtestContext that redirects activeSessionDir() via
//     sessions.js's setBacktestSessionContext.
//
// Backwards-compat: live behavior is unchanged. This file is only invoked
// from ipc-backtest.js when the user starts a run from the popover.

import fs from "node:fs";
import path from "node:path";
import { generateRunId, resolveRunDir, writeIndexEntry } from "./backtest-store.js";
import { gradeOpenTrade } from "./backtest-grader.js";

// Replay anchor = the bar the chart sits on when the run starts.
// Set to session-OPEN, not brief-time: the chart at session-open already
// shows the full HTF + overnight history, so the brief turn has everything
// it needs without us advancing the chart silently from 08:30 → 09:30.
const ANCHORS = {
  "ny-am": "09:30",   // NY AM session open
  "ny-pm": "13:00",   // NY PM session open
  london: "03:00",    // London session open
};

function round2(n) { return Math.round(n * 100) / 100; }

export async function runBacktest({
  date, session, mode,
  tv, sdk, bus,
  stateDir = "state",
  maxBars = 180,
}) {
  // Required-arg validation
  if (!date || !session || !mode) {
    throw new Error("runBacktest requires { date, session, mode }");
  }
  if (!tv || !sdk || !bus) {
    throw new Error("runBacktest requires { tv, sdk, bus } dependencies");
  }

  const runId = generateRunId({ session, date });
  const sessionDir = resolveRunDir({ stateDir, runId });
  fs.mkdirSync(sessionDir, { recursive: true });

  const ctx = { runId, session, sessionDir };
  const startedAt = Date.now();
  let stopped = false;
  const stopHandler = (cmd) => { if (cmd?.type === "stop") stopped = true; };
  bus.on("backtest:command", stopHandler);

  bus.emit("backtest:event", { type: "start", runId, session, date, mode });

  let totalCost = 0;
  let aborted = false;
  let errorMessage = null;
  const openTrades = [];      // setups accepted, awaiting outcome
  const closedTrades = [];    // setups with a resolved outcome (win/loss)
  const setupsPath = path.join(sessionDir, "setups.jsonl");

  function appendSetupRow(row) {
    fs.appendFileSync(setupsPath, JSON.stringify(row) + "\n");
  }

  try {
    await tv.replay.start({ date, time: ANCHORS[session] ?? "08:30" });

    // brief
    bus.emit("backtest:event", { type: "progress", runId, bar: 0, total: maxBars, cost: 0, phase: "brief" });
    const briefRes = await sdk.userTurn({ purpose: "brief", backtestContext: ctx });
    totalCost += briefRes?.cost ?? 0;

    // main loop
    for (let bar = 0; bar < maxBars && !stopped; bar++) {
      await tv.replay.step();
      const bundle = await tv.analyzePillar3();
      const res = await sdk.userTurn({ purpose: "bar-close", backtestContext: ctx, bundle });
      totalCost += res?.cost ?? 0;

      // Mode-specific accept behavior
      if (res?.surfacedSetup) {
        const setup = res.surfacedSetup;
        if (mode === "auto") {
          openTrades.push(setup);
          appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "auto", ...setup });
          bus.emit("backtest:event", { type: "setup_surfaced", runId, setup });
        } else if (mode === "pause") {
          bus.emit("backtest:event", { type: "paused", runId, setup });
          const decision = await waitForDecision(bus, () => stopped);
          if (stopped) {
            // user stopped the run during the decision — skip this setup
            appendSetupRow({ type: "stopped_during_decision", ts: Date.now(), setup_id: setup.id });
          } else if (decision.choice === "accept") {
            openTrades.push(setup);
            appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "user", ...setup });
            bus.emit("backtest:event", { type: "setup_accepted", runId, setupId: setup.id });
          } else {
            appendSetupRow({ type: "rejected", ts: Date.now(), setup_id: setup.id, reason: decision.reason ?? null });
            bus.emit("backtest:event", { type: "setup_rejected", runId, setupId: setup.id });
          }
        }
      }

      // After this bar, walk open trades and resolve any that hit stop/TP.
      const lastBar = bundle?.bars?.last_bar;
      if (lastBar) {
        for (const trade of [...openTrades]) {
          const verdict = gradeOpenTrade(trade, lastBar);
          if (verdict.outcome === "pending") continue;
          appendSetupRow({
            type: "outcome",
            ts: Date.now(),
            setup_id: trade.id,
            outcome: verdict.outcome,
            exit: verdict.exit,
            conflict_bar: verdict.conflict_bar,
          });
          closedTrades.push({ ...trade, ...verdict });
          openTrades.splice(openTrades.indexOf(trade), 1);
          bus.emit("backtest:event", {
            type: "setup_outcome",
            runId, setupId: trade.id,
            outcome: verdict.outcome, exit: verdict.exit,
          });
        }
      }

      bus.emit("backtest:event", {
        type: "progress",
        runId, bar: bar + 1, total: maxBars,
        cost: round2(totalCost), phase: "bar-close",
      });
    }

    aborted = stopped;

    // wrap (always fires, even on stop, so the run has a summary)
    const wrapRes = await sdk.userTurn({ purpose: "wrap", backtestContext: ctx });
    totalCost += wrapRes?.cost ?? 0;
  } catch (e) {
    errorMessage = e.message;
    bus.emit("backtest:event", { type: "error", runId, message: e.message });
    bus.off("backtest:command", stopHandler);
    try { await tv.replay.stop(); } catch {}
    throw e;
  }

  // Always stop replay + write summary in the happy path
  try { await tv.replay.stop(); } catch {}
  bus.off("backtest:command", stopHandler);

  const elapsed_ms = Date.now() - startedAt;
  const totalSetups = closedTrades.length + openTrades.length;
  const wins = closedTrades.filter((t) => t.outcome === "tp1_hit").length;
  const losses = closedTrades.filter((t) => t.outcome === "stop_hit").length;
  // Simple R model in v1: TP1 hit = +1R, stop hit = -1R, open at session end = 0
  const total_r = wins * 1 - losses * 1;
  const modelCounts = closedTrades.reduce((acc, t) => {
    if (!t.model) return acc;
    acc[t.model] = (acc[t.model] ?? 0) + (t.outcome === "tp1_hit" ? 1 : 0);
    return acc;
  }, {});
  const best_model = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const setups_by_grade = closedTrades.concat(openTrades).reduce((acc, t) => {
    const g = t.grade ?? "B";
    acc[g] = (acc[g] ?? 0) + 1;
    return acc;
  }, {});
  const wins_by_grade = closedTrades.reduce((acc, t) => {
    if (t.outcome !== "tp1_hit") return acc;
    const g = t.grade ?? "B";
    acc[g] = (acc[g] ?? 0) + 1;
    return acc;
  }, {});

  const summary = {
    run_id: runId,
    date, session, mode,
    created_at: new Date(startedAt).toISOString(),
    elapsed_ms,
    cost_usd: round2(totalCost),
    setups: totalSetups,
    wins, losses,
    no_trades: totalSetups === 0 ? 1 : 0,
    total_r,
    best_model,
    setups_by_grade,
    wins_by_grade,
    your_agreement: { agreed: 0, disagreed: 0, ungraded: totalSetups },
    chain_status: aborted ? "user-stopped" : (errorMessage ? `error:${errorMessage}` : "clean"),
  };
  fs.writeFileSync(path.join(sessionDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeIndexEntry({ stateDir, entry: summary });

  bus.emit("backtest:event", { type: "done", runId, summary });
  return { runId, summary };
}

// Wait for a {type:"decision", choice:"accept"|"reject"} command on the bus.
// Resolves early if the run is stopped via {type:"stop"} so the engine can
// unwind cleanly when the user clicks STOP RUN mid-decision.
function waitForDecision(bus, isStopped) {
  return new Promise((resolve) => {
    const onCmd = (cmd) => {
      if (!cmd) return;
      if (cmd.type === "decision") {
        bus.off("backtest:command", onCmd);
        resolve(cmd);
      } else if (cmd.type === "stop") {
        bus.off("backtest:command", onCmd);
        resolve({ choice: "stopped" });
      }
    };
    bus.on("backtest:command", onCmd);
    // Defensive: if the stop flag was already set before the listener attached,
    // unwind immediately.
    if (isStopped && isStopped()) {
      bus.off("backtest:command", onCmd);
      resolve({ choice: "stopped" });
    }
  });
}

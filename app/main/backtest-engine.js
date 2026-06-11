// app/main/backtest-engine.js
// Deterministic backtest: record a replay-stepped tape, fold it through the
// REAL production truth function (the same walker chain that trades live),
// grade outcomes from the recorded bars.
//
// Rewritten 2026-06-12. The previous engine ran one sdk.userTurn per replayed
// bar: the `bundle` it passed wasn't a userTurn parameter (silently ignored,
// so the LLM got a blank prompt with none of the live path's candidate/hint
// enrichment), outcomes were graded off `bundle.bars.last_bar` which doesn't
// exist in the analyze bundle (trades could never resolve), and the walker
// chain — the actual live brain since PR #12/#14 — never ran at all. Neither
// run on disk ever completed. This engine costs $0, finishes in roughly
// replay-stepping time, and every run persists a tape.json promotable into
// tests/tapes/ after hand-grading.
//
// Contract with ipc-backtest.js (event shapes unchanged so the popover +
// useBacktest keep working):
//   outbound bus events: start, progress, setup_surfaced, setup_accepted,
//                        paused, setup_rejected, setup_outcome, done, error
//   inbound bus commands: { type: "stop" }, { type: "decision", choice }
//
// deps (all injected; production wiring lives in ipc-backtest.js):
//   recordEntries({ context, date, fromEt, toEt, onBar, isStopped })
//     → { entries, warnings } — replay-stepping recorder (cli/lib/tape-recorder)
//   loadDayContext({ date, session }) → context | null — that day's recorded
//     brief + ltf-bias from state/session/<date>/<session>/
//   runDirectBrief({ session }) → context | null — deterministic brief at the
//     replay anchor when no day state exists (grade_cap B, backfilled status)
//   truthFn — buildDeterministicPacketTruthFromInputs (the live chain)
//   gradeFn — gradeOpenTrade (pure outcome grader)

import fs from "node:fs";
import path from "node:path";
import { generateRunId, resolveRunDir, writeIndexEntry } from "./backtest-store.js";

const SESSION_WINDOWS = {
  "ny-am": { from: "09:30", to: "12:00" },
  "ny-pm": { from: "13:00", to: "16:00" },
  london: { from: "03:00", to: "06:00" },
};

function round2(n) { return Math.round(n * 100) / 100; }

function lastClosedBarOf(entry) {
  const bars = entry?.inputs?.bundle?.bars?.last_5_bars ?? [];
  return bars[bars.length - 1] ?? null;
}

export async function runBacktest({
  date, session, mode,
  bus,
  stateDir = "state",
  deps,
}) {
  if (!date || !session || !mode) {
    throw new Error("runBacktest requires { date, session, mode }");
  }
  if (!bus || !deps?.recordEntries || !deps?.truthFn || !deps?.gradeFn) {
    throw new Error("runBacktest requires { bus, deps: { recordEntries, truthFn, gradeFn } }");
  }

  const runId = generateRunId({ session, date });
  const sessionDir = resolveRunDir({ stateDir, runId });
  fs.mkdirSync(sessionDir, { recursive: true });

  const startedAt = Date.now();
  let stopped = false;
  const stopHandler = (cmd) => { if (cmd?.type === "stop") stopped = true; };
  bus.on("backtest:command", stopHandler);
  bus.emit("backtest:event", { type: "start", runId, session, date, mode });

  const setupsPath = path.join(sessionDir, "setups.jsonl");
  const activityPath = path.join(sessionDir, "activity.jsonl");
  const appendSetupRow = (row) => fs.appendFileSync(setupsPath, JSON.stringify(row) + "\n");
  const appendActivity = (row) => fs.appendFileSync(activityPath, JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");

  const surfaced = [];
  const openTrades = [];
  const closedTrades = [];
  let contextSource = "none";
  let chainStatus = "clean";
  let errorMessage = null;
  let entries = [];
  let warnings = [];

  try {
    // 1. Context: the day's recorded chain state if it exists, else a
    //    deterministic brief at the replay anchor (grade_cap B — same rule
    //    as the live catch_up backfill).
    let context = await deps.loadDayContext?.({ date, session });
    if (context) {
      contextSource = "day_state";
    } else if (deps.runDirectBrief) {
      context = await deps.runDirectBrief({ runId, session, date });
      if (context) {
        contextSource = "direct_brief";
        chainStatus = "backfilled:brief_only";
      }
    }
    if (!context) {
      // Honest data gap — no recorded chain state and no brief could be
      // built. Mirrors constraint #9's data_gap separation: this is a
      // capture problem, not a market verdict.
      chainStatus = "no_context:data_gap";
      const summary = buildSummary({
        runId, date, session, mode, startedAt,
        surfaced: [], closedTrades: [], openTrades: [], chainStatus, contextSource,
      });
      fs.writeFileSync(path.join(sessionDir, "summary.json"), JSON.stringify(summary, null, 2));
      writeIndexEntry({ stateDir, entry: summary });
      bus.emit("backtest:event", { type: "done", runId, summary });
      bus.off("backtest:command", stopHandler);
      return { runId, summary };
    }
    appendActivity({ kind: "context", source: contextSource });

    // 2. Record: one replay pass, engine recomputed per bar.
    const window = SESSION_WINDOWS[session] ?? SESSION_WINDOWS["ny-am"];
    const recording = await deps.recordEntries({
      context, date,
      fromEt: window.from, toEt: window.to,
      isStopped: () => stopped,
      onBar: ({ bar, total }) => {
        bus.emit("backtest:event", { type: "progress", runId, bar, total, cost: 0, phase: "recording" });
      },
    });
    entries = recording.entries ?? [];
    warnings = recording.warnings ?? [];
    appendActivity({ kind: "recorded", bars: entries.length, warnings: warnings.length });
    fs.writeFileSync(path.join(sessionDir, "tape.json"), JSON.stringify({
      fixture: `${date}-${session}-backtest`,
      date, session,
      source: "backtest-engine",
      verified: false,
      context_source: contextSource,
      expected: { outcome: "no_trade" },
      entries,
    }, null, 2));

    // 3. Fold: the real chain, walker state carried bar to bar (same
    //    semantics as cli/lib/day-tape.js#foldTape).
    let walkers = [];
    const seenPacketIds = new Set();
    for (let i = 0; i < entries.length && !stopped; i += 1) {
      const entry = entries[i];
      const truth = await deps.truthFn({
        inputs: entry.inputs,
        previousWalkers: walkers,
        event: entry.event,
        session,
      });
      walkers = truth?.walkers ?? walkers;

      if (truth?.bestPacket && truth?.surfacePayload) {
        const payload = truth.surfacePayload;
        const setup = {
          id: payload.id ?? `setup-${i}`,
          model: payload.model ?? null,
          side: payload.side ?? null,
          entry: payload.entry ?? null,
          stop: payload.stop ?? null,
          tp1: payload.tp1 ?? null,
          tp2: payload.tp2 ?? null,
          grade: payload.grade ?? null,
          rationale: payload.rationale ?? null,
          event_ts: entry.event?.ts ?? null,
        };
        if (!seenPacketIds.has(setup.id)) {
          seenPacketIds.add(setup.id);
          surfaced.push(setup);
          bus.emit("backtest:event", { type: "setup_surfaced", runId, setup });
          appendActivity({ kind: "packet", id: setup.id, model: setup.model, side: setup.side });

          if (mode === "pause") {
            bus.emit("backtest:event", { type: "paused", runId, setup });
            const decision = await waitForDecision(bus, () => stopped);
            if (decision.choice === "accept") {
              openTrades.push(setup);
              appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "user", ...setup });
              bus.emit("backtest:event", { type: "setup_accepted", runId, setupId: setup.id });
            } else if (decision.choice === "stopped") {
              appendSetupRow({ type: "stopped_during_decision", ts: Date.now(), setup_id: setup.id });
            } else {
              appendSetupRow({ type: "rejected", ts: Date.now(), setup_id: setup.id, reason: decision.reason ?? null });
              bus.emit("backtest:event", { type: "setup_rejected", runId, setupId: setup.id });
            }
          } else {
            openTrades.push(setup);
            appendSetupRow({ type: "open", ts: Date.now(), accepted_by: "auto", ...setup });
          }
        }
      }

      // 4. Outcomes: walk open trades against this bar's recorded close.
      //    Entry fills at the confirmation close, so grading starts on the
      //    bar AFTER the one that surfaced the packet.
      const bar = lastClosedBarOf(entry);
      if (bar) {
        for (const trade of [...openTrades]) {
          if (trade.event_ts === entry.event?.ts) continue; // packet bar itself
          const verdict = deps.gradeFn(trade, bar);
          if (verdict.outcome === "pending") continue;
          appendSetupRow({
            type: "outcome", ts: Date.now(), setup_id: trade.id,
            outcome: verdict.outcome, exit: verdict.exit, conflict_bar: verdict.conflict_bar,
            event_ts: entry.event?.ts ?? null,
          });
          closedTrades.push({ ...trade, ...verdict });
          openTrades.splice(openTrades.indexOf(trade), 1);
          bus.emit("backtest:event", {
            type: "setup_outcome", runId, setupId: trade.id,
            outcome: verdict.outcome, exit: verdict.exit,
          });
        }
      }

      bus.emit("backtest:event", {
        type: "progress", runId, bar: i + 1, total: entries.length, cost: 0, phase: "folding",
      });
    }

    if (stopped) chainStatus = "user-stopped";
  } catch (e) {
    errorMessage = e.message;
    chainStatus = `error:${e.message}`;
    bus.emit("backtest:event", { type: "error", runId, message: e.message });
    bus.off("backtest:command", stopHandler);
    throw e;
  }

  bus.off("backtest:command", stopHandler);
  const summary = buildSummary({
    runId, date, session, mode, startedAt,
    surfaced, closedTrades, openTrades, chainStatus, contextSource,
    warnings: warnings.length, bars: entries.length, errorMessage,
  });
  fs.writeFileSync(path.join(sessionDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeIndexEntry({ stateDir, entry: summary });
  bus.emit("backtest:event", { type: "done", runId, summary });
  return { runId, summary };
}

function buildSummary({ runId, date, session, mode, startedAt, surfaced = [], closedTrades, openTrades, chainStatus, contextSource, warnings = 0, bars = 0, errorMessage = null }) {
  // `setups` counts what the chain SURFACED — a rejected setup still
  // happened; only acceptance routes it into the outcome walk.
  const totalSetups = surfaced.length;
  const wins = closedTrades.filter((t) => t.outcome === "tp1_hit").length;
  const losses = closedTrades.filter((t) => t.outcome === "stop_hit").length;
  // Simple R model: TP1 hit = +1R, stop hit = -1R, open at session end = 0.
  const total_r = wins - losses;
  const winsByModel = closedTrades.reduce((acc, t) => {
    if (!t.model || t.outcome !== "tp1_hit") return acc;
    acc[t.model] = (acc[t.model] ?? 0) + 1;
    return acc;
  }, {});
  const best_model = Object.entries(winsByModel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const setups_by_grade = surfaced.reduce((acc, t) => {
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
  return {
    run_id: runId,
    date, session, mode,
    created_at: new Date(startedAt).toISOString(),
    elapsed_ms: Date.now() - startedAt,
    cost_usd: 0,
    engine: "deterministic-walker-chain",
    context_source: contextSource,
    bars,
    recording_warnings: warnings,
    setups: totalSetups,
    wins, losses,
    no_trades: totalSetups === 0 ? 1 : 0,
    total_r: round2(total_r),
    best_model,
    setups_by_grade,
    wins_by_grade,
    your_agreement: { agreed: 0, disagreed: 0, ungraded: totalSetups },
    chain_status: errorMessage ? `error:${errorMessage}` : chainStatus,
  };
}

// Wait for a {type:"decision", choice:"accept"|"reject"} command on the bus.
// Resolves early on {type:"stop"} so the engine unwinds cleanly.
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
    if (isStopped && isStopped()) {
      bus.off("backtest:command", onCmd);
      resolve({ choice: "stopped" });
    }
  });
}

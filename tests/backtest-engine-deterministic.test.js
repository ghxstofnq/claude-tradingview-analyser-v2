// Deterministic backtest engine (2026-06-12): record a replay-stepped tape,
// fold it through the REAL production truth function (the same walker chain
// that trades live), grade outcomes from the recorded bars. No LLM in the
// loop — the old engine fired blank sdk.userTurn calls per bar (its `bundle`
// arg wasn't even a userTurn parameter) and graded outcomes off a
// `bars.last_bar` field that doesn't exist in the bundle, so no run ever
// resolved a trade. Folding the June 9 tape here proves the engine drives
// the same brain as live.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runBacktest } from "../app/main/backtest-engine.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test } from "../app/main/bar-close.js";

const JUNE9 = JSON.parse(fs.readFileSync(path.resolve("tests/tapes/2026-06-09-ny-am-replay.tape.json"), "utf8"));

function makeDeps({ entries, context = null }) {
  const calls = { recorded: 0, briefRuns: 0 };
  return {
    calls,
    deps: {
      recordEntries: async ({ onBar }) => {
        calls.recorded += 1;
        entries.forEach((_, i) => onBar?.({ bar: i + 1, total: entries.length }));
        return { entries, warnings: [] };
      },
      loadDayContext: async () => context ?? { session: "ny-am", leader: "MNQ1!" },
      runDirectBrief: async () => { calls.briefRuns += 1; return null; },
      truthFn: __test.buildDeterministicPacketTruthFromInputs,
      gradeFn: gradeOpenTrade,
    },
  };
}

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bt-engine-"));
}

function collectEvents(bus) {
  const events = [];
  bus.on("backtest:event", (e) => events.push(e));
  return events;
}

test("AUTO mode: June 9 tape folds to exactly one Inversion short packet through the real chain", async () => {
  const stateDir = tmpStateDir();
  const bus = new EventEmitter();
  const events = collectEvents(bus);
  const { deps } = makeDeps({ entries: JUNE9.entries });

  const { summary, runId } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "auto",
    bus, stateDir, deps,
  });

  assert.equal(summary.setups, 1);
  assert.equal(summary.cost_usd, 0);
  assert.equal(summary.best_model, null); // no tp1 hit inside the 22-bar window
  assert.equal(summary.wins, 0);
  assert.equal(summary.losses, 0);
  assert.equal(summary.chain_status, "clean");

  const surfaced = events.filter((e) => e.type === "setup_surfaced");
  assert.equal(surfaced.length, 1);
  assert.equal(surfaced[0].setup.model, "Inversion");
  assert.equal(surfaced[0].setup.side, "short");
  assert.equal(surfaced[0].setup.entry, 29792);
  assert.equal(surfaced[0].setup.stop, 29847);
  assert.equal(surfaced[0].setup.tp1, 29302.5);

  const rows = fs.readFileSync(path.join(stateDir, "backtest", runId, "ny-am", "setups.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.filter((r) => r.type === "open").length, 1);
  assert.ok(fs.existsSync(path.join(stateDir, "backtest", runId, "ny-am", "tape.json")), "recorded tape persisted for promotion");
  assert.ok(events.some((e) => e.type === "done"));
});

test("outcome grading: a later bar through TP1 resolves the trade as a win from recorded bars", async () => {
  const stateDir = tmpStateDir();
  const bus = new EventEmitter();
  const events = collectEvents(bus);

  const last = JUNE9.entries[JUNE9.entries.length - 1];
  const winBar = structuredClone(last);
  // Next 1m bar trades down through tp1 29302.5.
  const bars = winBar.inputs.bundle.bars.last_5_bars;
  const prev = bars[bars.length - 1];
  const t = Number(prev.time) + 60;
  bars.push({ time: t, open: prev.close, high: prev.close, low: 29300, close: 29301 });
  winBar.event = { ...winBar.event, ts: new Date((t + 60) * 1000).toISOString() };
  winBar.inputs.bundle.quote = { ...winBar.inputs.bundle.quote, last: 29301, time: t + 60 };

  const { deps } = makeDeps({ entries: [...JUNE9.entries, winBar] });
  const { summary } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "auto",
    bus, stateDir, deps,
  });

  assert.equal(summary.setups, 1);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 0);
  assert.equal(summary.total_r, 1);
  assert.equal(summary.best_model, "Inversion");
  const outcome = events.find((e) => e.type === "setup_outcome");
  assert.equal(outcome.outcome, "tp1_hit");
});

test("PAUSE mode: pauses on the packet and a reject decision records the rejection", async () => {
  const stateDir = tmpStateDir();
  const bus = new EventEmitter();
  const events = collectEvents(bus);
  bus.on("backtest:event", (e) => {
    if (e.type === "paused") {
      setImmediate(() => bus.emit("backtest:command", { type: "decision", choice: "reject", reason: "not my read" }));
    }
  });

  const { deps } = makeDeps({ entries: JUNE9.entries });
  const { summary, runId } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "pause",
    bus, stateDir, deps,
  });

  assert.ok(events.some((e) => e.type === "paused"));
  assert.ok(events.some((e) => e.type === "setup_rejected"));
  assert.equal(summary.setups, 1);
  assert.equal(summary.wins, 0);

  const rows = fs.readFileSync(path.join(stateDir, "backtest", runId, "ny-am", "setups.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(rows.some((r) => r.type === "rejected" && r.reason === "not my read"));
});

test("no day context and no brief context → run completes honestly as no_trade data gap", async () => {
  const stateDir = tmpStateDir();
  const bus = new EventEmitter();
  const events = collectEvents(bus);
  const deps = {
    recordEntries: async () => { throw new Error("must not record without context"); },
    loadDayContext: async () => null,
    runDirectBrief: async () => null,
    truthFn: __test.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };

  const { summary } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "auto",
    bus, stateDir, deps,
  });
  assert.equal(summary.setups, 0);
  assert.equal(summary.chain_status, "no_context:data_gap");
  assert.ok(events.some((e) => e.type === "done"));
});

test("stop command during recording aborts cleanly with a summary", async () => {
  const stateDir = tmpStateDir();
  const bus = new EventEmitter();
  const { deps } = makeDeps({ entries: JUNE9.entries });
  deps.recordEntries = async ({ onBar, isStopped }) => {
    onBar?.({ bar: 1, total: 22 });
    bus.emit("backtest:command", { type: "stop" });
    // engine exposes isStopped so the recorder can bail between steps
    assert.equal(typeof isStopped, "function");
    return { entries: JUNE9.entries.slice(0, 3), warnings: [], aborted: isStopped() };
  };

  const { summary } = await runBacktest({
    date: "2026-06-09", session: "ny-am", mode: "auto",
    bus, stateDir, deps,
  });
  assert.equal(summary.chain_status, "user-stopped");
});

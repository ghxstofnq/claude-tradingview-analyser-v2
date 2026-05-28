// tests/backtest-engine.test.js
// Engine unit tests — uses injected fake TV + SDK so we don't touch a real
// chart or LLM. State writes go to a fresh tmpdir so we don't pollute
// state/backtest/ under the repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";

function fakeTv() {
  const calls = [];
  return {
    calls,
    replay: {
      async start({ date, time }) { calls.push(["replay.start", date, time]); },
      async step() { calls.push(["replay.step"]); return { ok: true }; },
      async stop() { calls.push(["replay.stop"]); },
    },
    async analyzePillar3() {
      return { quote: { last: 100 }, bars: { last_bar: { high: 100, low: 99 } } };
    },
  };
}

function fakeSdk({ onTurn } = {}) {
  return {
    async userTurn({ purpose, backtestContext, bundle }) {
      if (onTurn) return await onTurn({ purpose, backtestContext, bundle });
      return { ok: true, purpose, runId: backtestContext?.runId, cost: 0.01 };
    },
  };
}

function tmpState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bt-engine-"));
}

test("runBacktest — emits start + done events and calls replay.start + replay.stop", async () => {
  const tv = fakeTv();
  const sdk = fakeSdk();
  const events = [];
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => events.push(e));
  const stateDir = tmpState();

  await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, stateDir, maxBars: 3,
  });

  const replayCalls = tv.calls.map((c) => c[0]);
  assert.ok(replayCalls.includes("replay.start"));
  assert.ok(replayCalls.includes("replay.stop"));
  assert.ok(events.some((e) => e.type === "start"));
  assert.ok(events.some((e) => e.type === "done"));
});

test("runBacktest — generates run_id and creates session folder + summary.json", async () => {
  const tv = fakeTv();
  const sdk = fakeSdk();
  const bus = new EventEmitter();
  const stateDir = tmpState();

  const result = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, stateDir, maxBars: 1,
  });

  assert.match(result.runId, /^\d{8}-\d{6}-am-2026-05-20$/);
  const sessionDir = path.join(stateDir, "backtest", result.runId, "ny-am");
  assert.ok(fs.existsSync(sessionDir));
  assert.ok(fs.existsSync(path.join(sessionDir, "summary.json")));
});

test("runBacktest — sdk.userTurn receives backtestContext with runId + session", async () => {
  const seen = [];
  const tv = fakeTv();
  const sdk = fakeSdk({
    onTurn: async ({ purpose, backtestContext }) => {
      seen.push({ purpose, ctx: backtestContext });
      return { cost: 0 };
    },
  });
  const bus = new EventEmitter();
  const stateDir = tmpState();

  await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, stateDir, maxBars: 2,
  });

  // brief, 2 bar-close, wrap — all should carry the backtestContext
  assert.ok(seen.length >= 3);
  for (const turn of seen) {
    assert.ok(turn.ctx?.runId, `expected runId on turn purpose=${turn.purpose}`);
    assert.equal(turn.ctx.session, "ny-am");
  }
  const purposes = seen.map((s) => s.purpose);
  assert.ok(purposes.includes("brief"));
  assert.ok(purposes.includes("bar-close"));
  assert.ok(purposes.includes("wrap"));
});

test("runBacktest — STOP command aborts mid-loop", async () => {
  const tv = fakeTv();
  const sdk = fakeSdk();
  const bus = new EventEmitter();
  const stateDir = tmpState();
  let progressSeen = 0;
  bus.on("backtest:event", (e) => {
    if (e.type === "progress") {
      progressSeen++;
      if (progressSeen === 2) bus.emit("backtest:command", { type: "stop" });
    }
  });

  await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, stateDir, maxBars: 100,
  });

  const stepCount = tv.calls.filter((c) => c[0] === "replay.step").length;
  assert.ok(stepCount < 100, `expected <100 steps after stop, got ${stepCount}`);
});

test("runBacktest — cost accumulates from each turn", async () => {
  const tv = fakeTv();
  const sdk = fakeSdk({
    onTurn: async () => ({ cost: 0.05 }),
  });
  const bus = new EventEmitter();
  const stateDir = tmpState();

  const { runId } = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, stateDir, maxBars: 3,
  });

  // brief + 3 bar-close + wrap = 5 turns × 0.05 = 0.25
  const summary = JSON.parse(fs.readFileSync(path.join(stateDir, "backtest", runId, "ny-am", "summary.json"), "utf8"));
  assert.ok(summary.cost_usd > 0.2);
  assert.ok(summary.cost_usd < 0.3);
});

test("runBacktest — auto mode auto-opens a trade on surfaced setup and grades it", async () => {
  const tv = {
    replay: {
      async start() {}, async stop() {},
      async step() { return {}; },
    },
    _barIdx: 0,
    async analyzePillar3() {
      this._barIdx++;
      // Bar 3 has low <= tp1 (89), so the short surfaced on bar 2 hits TP1
      if (this._barIdx === 3) return { bars: { last_bar: { high: 96, low: 88 } } };
      return { bars: { last_bar: { high: 96, low: 92 } } };
    },
  };
  let barCount = 0;
  const sdk = {
    async userTurn({ purpose }) {
      if (purpose === "bar-close") {
        barCount++;
        if (barCount === 2) {
          return {
            cost: 0.01,
            surfacedSetup: {
              id: "s1", side: "short", entry: 95, stop: 105, tp1: 89,
              grade: "A+", model: "MSS", ts: "09:42 ET",
            },
          };
        }
      }
      return { cost: 0.01 };
    },
  };
  const bus = new EventEmitter();
  const events = [];
  bus.on("backtest:event", (e) => events.push(e));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-engine-"));

  const { runId } = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, stateDir, maxBars: 5,
  });

  // The bar after the surfaced setup has low=88 ≤ tp1=89 → TP1 hit
  const outcomeEvents = events.filter((e) => e.type === "setup_outcome");
  assert.equal(outcomeEvents.length, 1);
  assert.equal(outcomeEvents[0].outcome, "tp1_hit");

  // setups.jsonl has the open + outcome rows
  const setupsPath = path.join(stateDir, "backtest", runId, "ny-am", "setups.jsonl");
  const lines = fs.readFileSync(setupsPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(lines.some((l) => l.type === "open" && l.id === "s1"));
  assert.ok(lines.some((l) => l.type === "outcome" && l.setup_id === "s1" && l.outcome === "tp1_hit"));

  // Summary reflects the win
  const summary = JSON.parse(fs.readFileSync(path.join(stateDir, "backtest", runId, "ny-am", "summary.json"), "utf8"));
  assert.equal(summary.setups, 1);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 0);
});

test("runBacktest — pause mode awaits user decision (ACCEPT) before opening trade", async () => {
  const tv = {
    replay: { async start() {}, async stop() {}, async step() { return {}; } },
    async analyzePillar3() { return { bars: { last_bar: { high: 96, low: 92 } } }; },
  };
  let barCount = 0;
  const sdk = {
    async userTurn({ purpose }) {
      if (purpose === "bar-close") {
        barCount++;
        if (barCount === 1) return {
          cost: 0,
          surfacedSetup: { id: "s1", side: "short", entry: 95, stop: 105, tp1: 89, grade: "A+", model: "MSS" },
        };
      }
      return { cost: 0 };
    },
  };
  const bus = new EventEmitter();
  let pausedSeen = false;
  bus.on("backtest:event", (e) => {
    if (e.type === "paused") {
      pausedSeen = true;
      // Simulate user ACCEPT after a short delay
      setTimeout(() => bus.emit("backtest:command", { type: "decision", choice: "accept", setupId: e.setup.id }), 5);
    }
  });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-engine-"));

  const { runId } = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "pause",
    tv, sdk, bus, stateDir, maxBars: 3,
  });

  assert.equal(pausedSeen, true);
  const setupsPath = path.join(stateDir, "backtest", runId, "ny-am", "setups.jsonl");
  const lines = fs.readFileSync(setupsPath, "utf8").trim().split("\n").map(JSON.parse);
  const opened = lines.find((l) => l.type === "open" && l.id === "s1");
  assert.ok(opened, "ACCEPT should have opened a trade");
  assert.equal(opened.accepted_by, "user");
});

test("runBacktest — pause mode REJECT skips the trade", async () => {
  const tv = {
    replay: { async start() {}, async stop() {}, async step() { return {}; } },
    async analyzePillar3() { return { bars: { last_bar: { high: 96, low: 92 } } }; },
  };
  let barCount = 0;
  const sdk = {
    async userTurn({ purpose }) {
      if (purpose === "bar-close") {
        barCount++;
        if (barCount === 1) return {
          cost: 0,
          surfacedSetup: { id: "s2", side: "short", entry: 95, stop: 105, tp1: 89, grade: "B" },
        };
      }
      return { cost: 0 };
    },
  };
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "paused") {
      setTimeout(() => bus.emit("backtest:command", { type: "decision", choice: "reject", setupId: e.setup.id, reason: "RR too tight" }), 5);
    }
  });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-engine-"));

  const { runId } = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "pause",
    tv, sdk, bus, stateDir, maxBars: 3,
  });

  const setupsPath = path.join(stateDir, "backtest", runId, "ny-am", "setups.jsonl");
  const lines = fs.readFileSync(setupsPath, "utf8").trim().split("\n").map(JSON.parse);
  const opened = lines.find((l) => l.type === "open");
  assert.equal(opened, undefined, "REJECT must not open a trade");
  const rejected = lines.find((l) => l.type === "rejected");
  assert.ok(rejected, "expected a rejected row");
  assert.equal(rejected.setup_id, "s2");
});

test("runBacktest — auto mode marks a stopped trade as a loss", async () => {
  const tv = {
    replay: { async start() {}, async stop() {}, async step() { return {}; } },
    _barIdx: 0,
    async analyzePillar3() {
      this._barIdx++;
      // Bar 3 has high >= stop (105) → stop hit on the short
      if (this._barIdx === 3) return { bars: { last_bar: { high: 106, low: 98 } } };
      return { bars: { last_bar: { high: 96, low: 92 } } };
    },
  };
  let barCount = 0;
  const sdk = {
    async userTurn({ purpose }) {
      if (purpose === "bar-close") {
        barCount++;
        if (barCount === 2) return {
          cost: 0.01,
          surfacedSetup: { id: "s2", side: "short", entry: 95, stop: 105, tp1: 89, grade: "B", model: "Trend" },
        };
      }
      return { cost: 0.01 };
    },
  };
  const bus = new EventEmitter();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-engine-"));
  const { runId } = await runBacktest({
    date: "2026-05-20", session: "ny-am", mode: "auto",
    tv, sdk, bus, stateDir, maxBars: 5,
  });
  const summary = JSON.parse(fs.readFileSync(path.join(stateDir, "backtest", runId, "ny-am", "summary.json"), "utf8"));
  assert.equal(summary.setups, 1);
  assert.equal(summary.wins, 0);
  assert.equal(summary.losses, 1);
});

test("runBacktest — replay.stop is called even if loop throws", async () => {
  const tv = fakeTv();
  const sdk = {
    async userTurn({ purpose }) {
      if (purpose === "bar-close") throw new Error("simulated LLM failure");
      return { cost: 0 };
    },
  };
  const bus = new EventEmitter();
  const stateDir = tmpState();

  await assert.rejects(
    () => runBacktest({
      date: "2026-05-20", session: "ny-am", mode: "auto",
      tv, sdk, bus, stateDir, maxBars: 3,
    }),
    /simulated LLM failure/,
  );

  // Cleanup still happens
  const replayCalls = tv.calls.map((c) => c[0]);
  assert.ok(replayCalls.includes("replay.stop"));
});

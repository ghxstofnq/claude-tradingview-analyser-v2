// Multiple trades per day: every distinct packet surfaces as its own setup
// (unique walker-derived ids), but AUTO mode trades one position at a time —
// a setup surfaced while a trade is open is recorded as skipped, and the
// next setup AFTER the trade closes opens normally.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";

function entryAt(iso, close) {
  return {
    event: { ts: iso, tf: "1m" },
    inputs: {
      bundle: { chart: { symbol: "MNQ1!" }, quote: { last: close }, bars: { last_5_bars: [{ time: Date.parse(iso) / 1000 - 60, open: close, high: close + 2, low: close - 2, close }] }, engine: {}, gates: { engine: { pillar1: { sweeps: [] }, pillar3: {} } } },
      leader: "MNQ1!", ltf_bias_context: null, session_state: null, untaken_targets: null,
    },
  };
}

function pkt(id, entry) {
  return {
    bestPacket: { model: "MSS", side: "short", grade: "B" },
    surfacePayload: { id, model: "MSS", side: "short", entry, stop: entry + 10, tp1: entry - 15, grade: "B" },
  };
}

test("AUTO trades one position at a time; setups surfaced meanwhile are skipped, next after close opens", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-multi-"));
  const bus = new EventEmitter();
  const entries = [
    entryAt("2026-06-09T13:58:00.000Z", 29700), // packet A surfaces + opens
    entryAt("2026-06-09T14:00:00.000Z", 29699), // packet B surfaces, skipped (A open)
    entryAt("2026-06-09T14:05:00.000Z", 29684), // A hits tp1 (29685)
    entryAt("2026-06-09T14:10:00.000Z", 29680), // packet C surfaces + opens
    entryAt("2026-06-09T14:20:00.000Z", 29664), // C hits tp1 (29665)
  ];
  const byBar = {
    0: pkt("D-aaa-1", 29700),
    1: pkt("D-bbb-2", 29699),
    3: pkt("D-ccc-3", 29680),
  };
  let bar = -1;
  const deps = {
    recordEntries: async () => ({ entries, warnings: [] }),
    loadDayContext: async () => ({
      session: "ny-am", leader: "MNQ1!",
      ltf_bias_context: { bias: "bearish", htf_ltf_alignment: "aligned", is_retrace_day: false, entry_model_priority: "MSS", grade_cap: "B" },
      session_state: { pillar1: { status: "pass", htfBias: "bearish" }, pillar2: { status: "pass", verdict: "good" } },
      untaken_targets: { untaken_above: [], untaken_below: [] },
      brief_digest: { htf_destination: {}, primary_draw: {} },
    }),
    runDirectBrief: async () => null,
    truthFn: async () => { bar += 1; return { walkers: [], ...(byBar[bar] ?? { bestPacket: null, surfacePayload: null }) }; },
    gradeFn: (trade, b) => {
      if (trade.side === "short" && b.low <= trade.tp1) return { outcome: "tp1_hit", exit: trade.tp1 };
      if (trade.side === "short" && b.high >= trade.stop) return { outcome: "stop_hit", exit: trade.stop };
      return { outcome: "pending" };
    },
  };
  const { summary, runId } = await runBacktest({ date: "2026-06-09", session: "ny-am", mode: "auto", bus, stateDir: dir, deps });

  assert.equal(summary.setups, 3);          // all three surfaced
  assert.equal(summary.wins, 2);            // A and C traded to tp1
  const rows = fs.readFileSync(path.join(dir, "backtest", runId, "ny-am", "setups.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const skipped = rows.filter((r) => r.type === "skipped_active_trade");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].setup_id, "D-bbb-2");
});

// User correction 2026-06-12: a TP1 hit books the trade's ACTUAL realized
// R multiple (|tp1-entry|/|entry-stop|), not a flat +1R — swing TP1s pay
// >=2R by rule. Stops book -1R.
test("total_r sums realized R multiples, not flat win counts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-r-"));
  const bus = new EventEmitter();
  const entries = [
    entryAt("2026-06-09T13:58:00.000Z", 29700), // opens: entry 29700, stop 29710, tp1 29675 → 2.5R short
    entryAt("2026-06-09T14:05:00.000Z", 29674), // tp1 hit
    entryAt("2026-06-09T14:10:00.000Z", 29670), // opens second: 2R short
    entryAt("2026-06-09T14:20:00.000Z", 29681), // stop hit
  ];
  const byBar = {
    0: { bestPacket: { model: "MSS", side: "short", grade: "B" }, surfacePayload: { id: "D-r1", model: "MSS", side: "short", entry: 29700, stop: 29710, tp1: 29675, grade: "B" } },
    2: { bestPacket: { model: "MSS", side: "short", grade: "B" }, surfacePayload: { id: "D-r2", model: "MSS", side: "short", entry: 29670, stop: 29680, tp1: 29650, grade: "B" } },
  };
  let bar = -1;
  const deps = {
    recordEntries: async () => ({ entries, warnings: [] }),
    loadDayContext: async () => ({
      session: "ny-am", leader: "MNQ1!",
      ltf_bias_context: { bias: "bearish", htf_ltf_alignment: "aligned", is_retrace_day: false, entry_model_priority: "MSS", grade_cap: "B" },
      session_state: { pillar1: { status: "pass", htfBias: "bearish" }, pillar2: { status: "pass", verdict: "good" } },
      untaken_targets: { untaken_above: [], untaken_below: [] },
      brief_digest: { htf_destination: {}, primary_draw: {} },
    }),
    runDirectBrief: async () => null,
    truthFn: async () => { bar += 1; return { walkers: [], ...(byBar[bar] ?? { bestPacket: null, surfacePayload: null }) }; },
    gradeFn: (trade, b) => {
      if (trade.side === "short" && b.low <= trade.tp1) return { outcome: "tp1_hit", exit: trade.tp1 };
      if (trade.side === "short" && b.high >= trade.stop) return { outcome: "stop_hit", exit: trade.stop };
      return { outcome: "pending" };
    },
  };
  const { summary } = await runBacktest({ date: "2026-06-09", session: "ny-am", mode: "auto", bus, stateDir: dir, deps });
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  // win: |29700-29675| / |29700-29710| = 2.5R; loss: -1R → net +1.5R
  assert.equal(summary.total_r, 1.5);
});

// User ruling 2026-06-12: the session halts at -3R realized. Once the
// day's closed trades sum to -3R or worse, no NEW positions open — later
// setups are recorded as session_halted (June 11 AM chop: 9 straight
// stops = -9R; with the halt it ends at -3R).
test("session halts at -3R: the fourth setup after three stops is not traded", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-halt-"));
  const bus = new EventEmitter();
  const mk = (iso, close) => entryAt(iso, close);
  const entries = [
    mk("2026-06-09T13:58:00.000Z", 29700), // A opens (short, stop 29710)
    mk("2026-06-09T14:00:00.000Z", 29711), // A stops (-1)
    mk("2026-06-09T14:02:00.000Z", 29700), // B opens
    mk("2026-06-09T14:04:00.000Z", 29711), // B stops (-2)
    mk("2026-06-09T14:06:00.000Z", 29700), // C opens
    mk("2026-06-09T14:08:00.000Z", 29711), // C stops (-3) → HALT
    mk("2026-06-09T14:10:00.000Z", 29700), // D surfaces — must NOT open
    mk("2026-06-09T14:12:00.000Z", 29650),
  ];
  const pktAt = { 0: "D-h1", 2: "D-h2", 4: "D-h3", 6: "D-h4" };
  let bar = -1;
  const deps = {
    recordEntries: async () => ({ entries, warnings: [] }),
    loadDayContext: async () => ({
      session: "ny-am", leader: "MNQ1!",
      ltf_bias_context: { bias: "bearish", htf_ltf_alignment: "aligned", is_retrace_day: false, entry_model_priority: "MSS", grade_cap: "B" },
      session_state: { pillar1: { status: "pass", htfBias: "bearish" }, pillar2: { status: "pass", verdict: "good" } },
      untaken_targets: { untaken_above: [], untaken_below: [] },
      brief_digest: { htf_destination: {}, primary_draw: {} },
    }),
    runDirectBrief: async () => null,
    truthFn: async () => {
      bar += 1;
      const id = pktAt[bar];
      return id
        ? { walkers: [], bestPacket: { model: "MSS", side: "short", grade: "B" }, surfacePayload: { id, model: "MSS", side: "short", entry: 29700, stop: 29710, tp1: 29650, grade: "B" } }
        : { walkers: [], bestPacket: null, surfacePayload: null };
    },
    gradeFn: (trade, b) => {
      if (b.high >= trade.stop) return { outcome: "stop_hit", exit: trade.stop };
      if (b.low <= trade.tp1) return { outcome: "tp1_hit", exit: trade.tp1 };
      return { outcome: "pending" };
    },
  };
  const { summary, runId } = await runBacktest({ date: "2026-06-09", session: "ny-am", mode: "auto", bus, stateDir: dir, deps });

  assert.equal(summary.losses, 3);
  assert.equal(summary.total_r, -3);
  assert.equal(summary.session_halted, true);
  const rows = fs.readFileSync(path.join(dir, "backtest", runId, "ny-am", "setups.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(rows.some((r) => r.type === "session_halted" && r.setup_id === "D-h4"));
  assert.equal(rows.filter((r) => r.type === "open").length, 3);
});

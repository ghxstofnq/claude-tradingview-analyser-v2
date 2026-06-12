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

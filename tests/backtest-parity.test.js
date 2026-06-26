// Backtest == live parity guards (2026-06-26, commit 1459970).
//
// The replay backtest fired ZERO setups on every day while live fired trades.
// Root cause: the recorder froze the pre-open `no-trade: open_unconfirmed` grade
// as session_state.pillar1.status='fail' into every tape bar, and the engine
// re-injected ltf_bias_context per bar but NOT pillar1 — so the walker stayed
// Pillar-1-blocked all session. These tests lock the two engine-side invariants
// (per-bar pillar1 injection + honest no-context labeling). The context-side
// invariant (pillar1.status from the draw, not the lean grade) lives in
// backtest-context.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { tmpStateDir } from "./helpers/tmp-state.js";
import { runBacktest, openReactionWindowMs } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { resolveRunDir } from "../app/main/backtest-store.js";

const DATE = "2026-06-09";
const SESSION = "ny-am";

function isoAtEt(hhmm) {
  const { startMs } = openReactionWindowMs({ date: DATE, session: SESSION });
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(startMs + ((h - 9) * 60 + (m - 30)) * 60_000).toISOString();
}

function entryAt(hhmm) {
  const ts = isoAtEt(hhmm);
  const closeSec = Date.parse(ts) / 1000;
  return {
    event: { ts, tf: "1m" },
    inputs: {
      bundle: {
        chart: { symbol: "MNQ1!" },
        quote: { symbol: "MNQ1!", last: 100, time: closeSec },
        bars: { last_5_bars: [{ time: closeSec - 60, open: 99, high: 101, low: 98, close: 100 }] },
        engine: {},
        gates: { engine: { pillar1: { sweeps: [] }, pillar3: { failure_swings: [], most_recent_structure: null, fvgs: [] } } },
      },
      leader: "MNQ1!",
      ltf_bias_context: null,
      session_state: null,
      untaken_targets: null,
    },
  };
}

// A drawful PRE-OPEN no-trade brief: pillar_grade no-trade / open_unconfirmed,
// but a primary_draw IS present → Pillar 1 is satisfied (status pass).
const PREOPEN_NO_TRADE_BRIEF = {
  symbol: "MNQ1!",
  pillar_grade: "no-trade",
  no_trade_reason: "open_unconfirmed",
  pillar2_verdict: "marginal",
  primary_draw: { tf: "h4", kind: "fvg", dir: "bear", top: 95, bottom: 90, ce: 92.5, cite: "engine_by_tf.h4.fvgs[0]" },
  overnight_block: { untaken_above: [], untaken_below: [{ name: "PDL", price: 90 }] },
};

test("engine injects context's pillar1 (pass) over a tape baked with status=fail", async () => {
  const entries = [entryAt("09:35"), entryAt("09:46"), entryAt("09:55")];
  const captured = [];
  const deps = {
    // Recorder bakes the STALE pre-open pillar1.status='fail' into every bar —
    // the exact condition that blocked the walker before the fix.
    recordEntries: async () => {
      for (const e of entries) {
        e.inputs.session_state = { pillar1: { status: "fail", htfBias: "below" }, pillar2: { status: "pass" } };
      }
      return { entries, warnings: [] };
    },
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session: SESSION, payloads: [PREOPEN_NO_TRADE_BRIEF] }),
    truthFn: async ({ inputs }) => {
      captured.push(inputs.session_state?.pillar1?.status ?? null);
      return { walkers: [], bestPacket: null, surfacePayload: null };
    },
    gradeFn: () => ({ outcome: "pending" }),
  };
  await runBacktest({ date: DATE, session: SESSION, mode: "auto", bus: new EventEmitter(), stateDir: tmpStateDir("bt-par-"), deps });

  assert.ok(captured.length >= 1, "the truthFn must see at least one bar");
  assert.ok(captured.every((s) => s === "pass"), `every bar's pillar1.status must be injected 'pass', got ${JSON.stringify(captured)}`);
});

// Honest no-context labeling: a null context is only a data_gap when the capture
// genuinely failed. A fresh-data no-draw day must surface its real brief reason,
// not the misleading "data_gap" (user: "there is no data gap, something is wrong").
async function chainStatusForReason(reason) {
  const dir = tmpStateDir("bt-lbl-");
  const deps = {
    loadDayContext: async () => null,
    // Mirror production: write brief-payloads.json to the run dir, then return
    // a null context (no draw). The engine reads the reason from that file.
    runDirectBrief: async ({ runId }) => {
      if (reason !== null) {
        const sessionDir = resolveRunDir({ stateDir: dir, runId });
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, "brief-payloads.json"), JSON.stringify([{ symbol: "MNQ1!", pillar_grade: "no-trade", no_trade_reason: reason }]));
      }
      return null;
    },
    recordEntries: async () => ({ entries: [], warnings: [] }),
    truthFn: async () => ({ walkers: [], bestPacket: null, surfacePayload: null }),
    gradeFn: () => ({ outcome: "pending" }),
  };
  const { summary } = await runBacktest({ date: DATE, session: SESSION, mode: "auto", bus: new EventEmitter(), stateDir: dir, deps });
  return summary.chain_status;
}

test("no-context label: a fresh-data no-draw day surfaces its real reason, not data_gap", async () => {
  assert.equal(await chainStatusForReason("open_unconfirmed"), "no_context:open_unconfirmed");
  assert.equal(await chainStatusForReason("pillar2_poor"), "no_context:pillar2_poor");
});

test("no-context label: a genuine hard reason stays data_gap; absent payloads fall back to data_gap", async () => {
  assert.equal(await chainStatusForReason("data_gap"), "no_context:data_gap");
  assert.equal(await chainStatusForReason("session_closed"), "no_context:data_gap");
  assert.equal(await chainStatusForReason(null), "no_context:data_gap");
});

// Backtest engine — future / not-yet-closed session guard.
//
// 2026-06-19: a custom date range with an end past the last completed session
// generated and ran jobs for today (pre-open) and all of next week. Those
// sessions have no replayable data, so the recorder stepped live/empty bars and
// left aborted runs. The engine must refuse a session that hasn't closed yet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { tmpStateDir } from "./helpers/tmp-state.js";
import { runBacktest, sessionHasClosed } from "../app/main/backtest-engine.js";

// 2026-06-19 (Fri) 10:00 ET = 14:00 UTC (EDT).
const NOW = Date.UTC(2026, 5, 19, 14, 0);

test("sessionHasClosed — past closed, today-pre-close and future not", () => {
  assert.equal(sessionHasClosed("2026-06-18", "ny-am", NOW), true);
  assert.equal(sessionHasClosed("2026-06-19", "london", NOW), true);  // closes 06:00 ET
  assert.equal(sessionHasClosed("2026-06-19", "ny-am", NOW), false);  // closes 12:00 ET
  assert.equal(sessionHasClosed("2026-06-22", "ny-pm", NOW), false);  // future weekday
});

function deps(recordedRef) {
  return {
    recordEntries: async () => { recordedRef.n += 1; return { entries: [], warnings: [] }; },
    loadDayContext: async () => ({
      session: "ny-am", leader: "MNQ1!",
      ltf_bias_context: { bias: "bearish", htf_ltf_alignment: "aligned", is_retrace_day: false, entry_model_priority: "MSS", grade_cap: "B" },
      session_state: { pillar1: { status: "pass", htfBias: "bearish" }, pillar2: { status: "pass", verdict: "good" } },
      untaken_targets: { untaken_above: [], untaken_below: [] },
      brief_digest: { htf_destination: {}, primary_draw: {} },
    }),
    runDirectBrief: async () => null,
    truthFn: async () => ({ walkers: [] }),
    gradeFn: () => ({ outcome: "pending" }),
  };
}

test("runBacktest refuses a future session — no recording, error surfaced + persisted", async () => {
  const dir = tmpStateDir("bt-future-");
  const bus = new EventEmitter();
  const events = [];
  bus.on("backtest:event", (e) => events.push(e));
  const recorded = { n: 0 };

  // A far-future date is always after its session close, regardless of when the
  // suite runs — so the guard fires deterministically.
  await assert.rejects(
    () => runBacktest({ date: "2099-01-02", session: "ny-am", mode: "auto", bus, stateDir: dir, deps: deps(recorded) }),
    /session_not_closed/,
  );

  assert.equal(recorded.n, 0, "recorder must not run for a session that hasn't closed");
  assert.ok(events.some((e) => e.type === "error" && /session_not_closed/.test(e.message)), "an error event is emitted");

  // Persisted like any other failed run (reconstructable from disk).
  const runs = fs.readdirSync(path.join(dir, "backtest")).filter((f) => f !== "index.json");
  assert.equal(runs.length, 1);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "backtest", runs[0], "ny-am", "summary.json"), "utf8"));
  assert.match(summary.chain_status, /^error:session_not_closed/);
});

test("runBacktest still runs a fully past session", async () => {
  const dir = tmpStateDir("bt-past-");
  const bus = new EventEmitter();
  const recorded = { n: 0 };
  const { summary } = await runBacktest({ date: "2026-06-09", session: "ny-am", mode: "auto", bus, stateDir: dir, deps: deps(recorded) });
  assert.equal(recorded.n, 1, "recorder runs for a closed session");
  assert.equal(summary.chain_status, "clean");
});

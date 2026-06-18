// Backtest engine — failure observability + cleanup.
//
// 2026-06-12 incident: a popover run died in recordEntries; the error went
// only to the renderer event stream, nothing was persisted (no summary.json,
// no index entry, no log line), and the chart was left stranded in replay
// mode — which would have contaminated the next live capture. These tests
// pin the contract: a crashed run writes an error summary + index entry,
// and deps.cleanup runs on success, failure, and stop.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpStateDir } from "./helpers/tmp-state.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";

function baseDeps(overrides = {}) {
  return {
    recordEntries: async () => ({ entries: [], warnings: [] }),
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
    ...overrides,
  };
}

async function runIn(dir, deps) {
  const bus = new EventEmitter();
  return runBacktest({ date: "2026-06-09", session: "ny-am", mode: "auto", bus, stateDir: dir, deps });
}

test("crashed run persists an error summary and index entry", async () => {
  const dir = tmpStateDir("bt-fail-");
  const deps = baseDeps({
    recordEntries: async () => { throw new Error("CDP went away"); },
  });
  await assert.rejects(() => runIn(dir, deps), /CDP went away/);

  const runs = fs.readdirSync(path.join(dir, "backtest")).filter((f) => f !== "index.json");
  assert.equal(runs.length, 1);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "backtest", runs[0], "ny-am", "summary.json"), "utf8"));
  assert.match(summary.chain_status, /^error:CDP went away/);

  const index = JSON.parse(fs.readFileSync(path.join(dir, "backtest", "index.json"), "utf8"));
  assert.equal(index.runs.length, 1);
  assert.match(index.runs[0].chain_status, /^error:/);
});

test("deps.cleanup runs after a successful run", async () => {
  const dir = tmpStateDir("bt-fail-");
  let cleaned = 0;
  await runIn(dir, baseDeps({ cleanup: async () => { cleaned += 1; } }));
  assert.equal(cleaned, 1);
});

test("deps.cleanup runs after a crashed run", async () => {
  const dir = tmpStateDir("bt-fail-");
  let cleaned = 0;
  const deps = baseDeps({
    recordEntries: async () => { throw new Error("boom"); },
    cleanup: async () => { cleaned += 1; },
  });
  await assert.rejects(() => runIn(dir, deps), /boom/);
  assert.equal(cleaned, 1);
});

test("cleanup failures never mask the run result", async () => {
  const dir = tmpStateDir("bt-fail-");
  const { summary } = await runIn(dir, baseDeps({
    cleanup: async () => { throw new Error("cleanup exploded"); },
  }));
  assert.ok(summary);
  assert.equal(summary.chain_status, "clean");
});

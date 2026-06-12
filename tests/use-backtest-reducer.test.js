// useBacktest reducer — engine events must drive the UI state on their own.
//
// 2026-06-12: a popover run started through window.api.backtest.start (the
// same preload call the form makes) streamed start/progress events while the
// topbar badge sat on IDLE — only the form's optimistic START dispatch ever
// reached AUTO_RUNNING. If the app restarts mid-run, or anything but the
// form starts a run, the UI must still follow the engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { reducer } from "../app/renderer/src/hooks/useBacktest.js";

const idle = { ui: "IDLE", currentRun: null, surfacedSetup: null, library: { runs: [], loading: true }, detail: null };

test("engine start event moves IDLE to AUTO_RUNNING", () => {
  const s = reducer(idle, { type: "ENGINE_EVENT", event: { type: "start", runId: "r1", date: "2026-06-11", session: "ny-am", mode: "auto" } });
  assert.equal(s.ui, "AUTO_RUNNING");
  assert.equal(s.currentRun.runId, "r1");
});

test("engine progress event recovers AUTO_RUNNING when UI missed the start", () => {
  const s = reducer(idle, { type: "ENGINE_EVENT", event: { type: "progress", bar: 12, total: 150, cost: 0, phase: "recording" } });
  assert.equal(s.ui, "AUTO_RUNNING");
  assert.equal(s.currentRun.progress.bar, 12);
});

test("pause-mode start event moves to AUTO_RUNNING until a pause arrives", () => {
  const s = reducer(idle, { type: "ENGINE_EVENT", event: { type: "start", runId: "r2", date: "2026-06-11", session: "ny-am", mode: "pause" } });
  assert.equal(s.ui, "AUTO_RUNNING");
});

test("progress while PAUSE_AWAITING does not stomp the decision state", () => {
  const awaiting = { ...idle, ui: "PAUSE_AWAITING" };
  const s = reducer(awaiting, { type: "ENGINE_EVENT", event: { type: "progress", bar: 50, total: 150 } });
  assert.equal(s.ui, "PAUSE_AWAITING");
});

test("done event still lands on DONE", () => {
  const running = { ...idle, ui: "AUTO_RUNNING", currentRun: { runId: "r1", setups: [] } };
  const s = reducer(running, { type: "ENGINE_EVENT", event: { type: "done", summary: { setups: 0 } } });
  assert.equal(s.ui, "DONE");
});

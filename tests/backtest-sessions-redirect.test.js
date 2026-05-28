// tests/backtest-sessions-redirect.test.js
// activeSessionDir() should return state/backtest/<run-id>/<session>/ when
// a backtest context is set, and the normal state/session/<date>/<session>/
// path otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  activeSessionDir,
  setBacktestSessionContext,
  clearBacktestSessionContext,
} from "../app/main/sessions.js";

test("activeSessionDir — backtest context redirects to state/backtest/<run-id>/<session>/", async () => {
  setBacktestSessionContext({
    runId: "20260528-103047-am-2026-05-20",
    session: "ny-am",
  });
  try {
    const dir = await activeSessionDir();
    assert.ok(dir.includes("/state/backtest/20260528-103047-am-2026-05-20/ny-am"),
      `expected backtest path; got ${dir}`);
  } finally {
    clearBacktestSessionContext();
  }
});

test("activeSessionDir — no context returns normal live path", async () => {
  clearBacktestSessionContext();
  const dir = await activeSessionDir();
  assert.ok(dir.includes("/state/session/"), `expected live session path; got ${dir}`);
  assert.ok(!dir.includes("/backtest/"));
});

test("setBacktestSessionContext + clearBacktestSessionContext — round-trip", async () => {
  setBacktestSessionContext({ runId: "rid-1", session: "ny-pm" });
  const inBt = (await activeSessionDir()).includes("/backtest/rid-1/ny-pm");
  clearBacktestSessionContext();
  const out = (await activeSessionDir()).includes("/backtest/");
  assert.equal(inBt, true);
  assert.equal(out, false);
});

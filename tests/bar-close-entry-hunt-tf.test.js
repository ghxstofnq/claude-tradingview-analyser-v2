import { test } from "node:test";
import assert from "node:assert/strict";
import { entryHuntChartTf } from "../app/main/bar-close.js";

// Regression for the London 2026-06-17 divergence: live folded 160 bars → 0
// setups while the all-1m backtest of the same session folded 5. Root cause —
// preflightChartState pinned the analysis chart to 5m on every 5m-boundary
// event (`ev.tf === "5m" ? "5" : "1"`), so ~1-in-5 walker folds ran against the
// coarse 5m engine table, scrambling 1m walker tracking. The walker fold is the
// strategy's 1m setup search (filters-dont-separate: 1m entry is load-bearing;
// 5m-confirmation tested -55R); the 5m event tag is a NARRATION cadence only.
test("entry-hunt fold always pins the analysis chart to 1m, even on a 5m-boundary event", () => {
  assert.equal(entryHuntChartTf({ tf: "5m", is_5m_close: true }), "1");
  assert.equal(entryHuntChartTf({ tf: "1m" }), "1");
  assert.equal(entryHuntChartTf({}), "1");
  assert.equal(entryHuntChartTf(), "1");
});

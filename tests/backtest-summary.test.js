// tests/backtest-summary.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { __test } from "../app/main/backtest-engine.js";

const { buildSummary } = __test;

function summarize(closedTrades, surfaced = closedTrades) {
  return buildSummary({
    runId: "T", date: "2026-06-16", session: "ny-pm", mode: "auto",
    startedAt: Date.now(), surfaced, closedTrades, openTrades: [],
    chainStatus: "clean", contextSource: "direct_brief",
  });
}

describe("buildSummary win/loss classification", () => {
  it("a profitable 16:00 close counts as a win (user ruling 2026-06-17)", () => {
    const s = summarize([
      { outcome: "tp1_hit", realized_r: 4.79, grade: "B", model: "Inversion" },
      { outcome: "tp1_hit", realized_r: 2.13, grade: "B", model: "Inversion" },
      { outcome: "closed_1600", realized_r: 3.2, grade: "B", model: "Inversion" },
    ]);
    assert.equal(s.wins, 3);          // was 2 — the EOD close now counts
    assert.equal(s.losses, 0);
    assert.equal(s.closed_eod, 1);    // still tracked informationally
    assert.equal(s.total_r, 10.12);
  });

  it("a losing 16:00 close counts as a loss", () => {
    const s = summarize([
      { outcome: "stop_hit", realized_r: -1 },
      { outcome: "closed_1600", realized_r: -2 },
    ]);
    assert.equal(s.wins, 0);
    assert.equal(s.losses, 2);
    assert.equal(s.closed_eod, 1);
    assert.equal(s.total_r, -3);
  });

  it("a scratch (exactly 0R) 16:00 close is neither win nor loss", () => {
    const s = summarize([{ outcome: "closed_1600", realized_r: 0 }]);
    assert.equal(s.wins, 0);
    assert.equal(s.losses, 0);
    assert.equal(s.closed_eod, 1);
  });

  it("TP and stop outcomes are unchanged", () => {
    const s = summarize([
      { outcome: "tp2_hit", realized_r: 6 },
      { outcome: "stop_hit", realized_r: -1 },
    ]);
    assert.equal(s.wins, 1);
    assert.equal(s.losses, 1);
    assert.equal(s.closed_eod, 0);
  });
});

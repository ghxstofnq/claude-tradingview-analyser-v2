// Unit tests for app/renderer/src/Live.helpers.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  modelLabel,
  normalizeSide,
} from "../app/renderer/src/Live.helpers.js";

describe("normalizeSide", () => {
  it("maps order vocabulary buy/sell → long/short", () => {
    assert.equal(normalizeSide("buy"), "long");
    assert.equal(normalizeSide("sell"), "short");
  });

  it("maps TradingView position vocabulary long/short (the DOM-read 'Side' column)", () => {
    // tv-adapter.js:67 lowercases TV's positions-table Side column ("Long"/"Short").
    // The old `=== "buy" ? "long" : "short"` check flipped a long to "short".
    assert.equal(normalizeSide("long"), "long");
    assert.equal(normalizeSide("short"), "short");
    assert.equal(normalizeSide("Long"), "long");
    assert.equal(normalizeSide("SHORT"), "short");
  });

  it("maps numeric / signed feed values", () => {
    assert.equal(normalizeSide(1), "long");
    assert.equal(normalizeSide(-1), "short");
    assert.equal(normalizeSide("1"), "long");
    assert.equal(normalizeSide("-1"), "short");
  });

  it("returns null for flat / unknown / empty", () => {
    assert.equal(normalizeSide("empty"), null);
    assert.equal(normalizeSide(""), null);
    assert.equal(normalizeSide(null), null);
    assert.equal(normalizeSide(undefined), null);
    assert.equal(normalizeSide("garbage"), null);
  });
});

describe("selectPillar3", () => {
  const pillars = [
    { name: "Draw & Bias", status: "pass", elements: [] },
    { name: "Price-Action Quality", status: "weak", elements: [] },
    { name: "Entry Model + Confirmation", status: "pending", elements: [] },
  ];

  it("finds Pillar 3 by 'entry' substring", () => {
    const p = selectPillar3(pillars);
    assert.equal(p.status, "pending");
  });

  it("finds Pillar 3 by 'confirmation' substring even if reordered", () => {
    const reordered = [pillars[2], pillars[0], pillars[1]];
    const p = selectPillar3(reordered);
    assert.equal(p.status, "pending");
  });

  it("returns null when no pillar matches", () => {
    assert.equal(selectPillar3([pillars[0]]), null);
  });

  it("returns null on non-array input", () => {
    assert.equal(selectPillar3(undefined), null);
    assert.equal(selectPillar3(null), null);
  });
});

describe("pillar3ToConfirmationRows", () => {
  it("maps four rows in fixed order, matched by name substring", () => {
    const pillar3 = {
      elements: [
        { name: "1m close past structure", status: "pass", detail: "21 322.50 close > 21 320" },
        { name: "PD-array tap", status: "pass", detail: "wick tapped 4H FVG" },
        { name: "Clean delivery", status: "pending", detail: "" },
        { name: "5m close past structure", status: "weak", detail: "wick only, no close" },
      ],
    };
    const rows = pillar3ToConfirmationRows(pillar3);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].label, "PD-array tap");
    assert.equal(rows[0].status, "pass");
    assert.match(rows[0].detail, /wick tapped/);
    assert.equal(rows[1].label, "1m close past structure");
    assert.equal(rows[1].status, "pass");
    assert.equal(rows[2].label, "5m close past structure");
    assert.equal(rows[2].status, "weak");
    assert.equal(rows[3].label, "Clean delivery");
    assert.equal(rows[3].status, "pending");
  });

  it("renders missing elements as 'missing' status with em-dash detail", () => {
    const rows = pillar3ToConfirmationRows({ elements: [] });
    assert.equal(rows.every((r) => r.status === "missing"), true);
    assert.equal(rows.every((r) => r.detail === "—"), true);
  });

  it("tolerates null pillar3 input", () => {
    const rows = pillar3ToConfirmationRows(null);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].status, "missing");
  });
});

describe("liveGridFromTrade", () => {
  const longTrade = {
    side: "long",
    entry: 21322.50,
    stop: 21285.00,
    tp1: 21385.00,
    tp2: 21420.00,
    tp1_hit: false,
  };

  it("computes the 4 cells for a long trade", () => {
    const grid = liveGridFromTrade(longTrade, 21358.25);
    assert.match(grid.price.v, /21 358\.25/);
    assert.match(grid.price.sub, /\+35\.75 from entry/);
    assert.equal(grid.pnl.tone, "green");
    assert.match(grid.toTp1.v, /^26\.75/);  // |21385 - 21358.25| = 26.75
    assert.equal(grid.toTp1.tone, "green");
    assert.match(grid.toStop.v, /^73\.25/); // 21358.25 - 21285 = 73.25
    assert.equal(grid.toStop.tone, "red");
  });

  it("flips P&L tone red when below entry on a long", () => {
    const grid = liveGridFromTrade(longTrade, 21300);
    assert.equal(grid.pnl.tone, "red");
  });

  it("annotates stop as BE when tp1_hit", () => {
    const grid = liveGridFromTrade({ ...longTrade, tp1_hit: true }, 21358.25);
    assert.match(grid.toStop.sub, /\(BE\)/);
  });

  it("computes correctly for a short trade", () => {
    const shortTrade = { side: "short", entry: 21400, stop: 21430, tp1: 21340, tp2: 21290 };
    const grid = liveGridFromTrade(shortTrade, 21380);
    // For a short: fromEntry = entry - lastClose = 20 (positive = winning)
    assert.match(grid.price.sub, /\+20 from entry/);
    assert.equal(grid.pnl.tone, "green");
    // toTp1 = lastClose - tp1 = 40 (still 40 pts to TP1)
    assert.match(grid.toTp1.v, /^40/);
  });

  it("returns em-dash placeholders when lastClose is missing", () => {
    const grid = liveGridFromTrade(longTrade, null);
    assert.equal(grid.price.v, "—");
    assert.equal(grid.pnl.v, "—");
  });

  it("returns em-dash placeholders when trade is missing", () => {
    const grid = liveGridFromTrade(null, 21358);
    assert.equal(grid.price.v, "—");
  });
});

// (deriveAddCandidate + trancheStackFromState removed 2026-06-23 — scale-in
// deleted; the LIVE panel trades one position at a time.)

describe("modelLabel (Stage F — 2×2 entry-model framing)", () => {
  it("MSS → Reversal · MSS", () => {
    assert.equal(modelLabel({ model: "MSS" }), "Reversal · MSS");
  });
  it("Trend → Continuation · Trend", () => {
    assert.equal(modelLabel({ model: "Trend" }), "Continuation · Trend");
  });
  it("Inversion → Inversion", () => {
    assert.equal(modelLabel({ model: "Inversion" }), "Inversion");
  });
  it("unknown model falls back to the raw string; missing → —", () => {
    assert.equal(modelLabel({ model: "Custom" }), "Custom");
    assert.equal(modelLabel({}), "—");
  });
});

// Unit tests for app/renderer/src/Live.helpers.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  latestBarReadMessage,
  deriveAddCandidate,
  trancheStackFromState,
} from "../app/renderer/src/Live.helpers.js";

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

describe("latestBarReadMessage", () => {
  it("finds the latest bar-read in a mixed message list", () => {
    const messages = [
      { type: "user", body: "hello", t: "09:30" },
      { type: "bar-read", body: "first read", t: "09:31" },
      { type: "reply", body: "answer", t: "09:32" },
      { type: "bar-read", body: "latest read", t: "09:33" },
      { type: "reply", body: "another answer", t: "09:34" },
    ];
    const m = latestBarReadMessage(messages);
    assert.equal(m.body, "latest read");
  });

  it("returns null when no bar-read exists", () => {
    const messages = [
      { type: "user", body: "hi" },
      { type: "reply", body: "hi" },
    ];
    assert.equal(latestBarReadMessage(messages), null);
  });

  it("returns null on empty array", () => {
    assert.equal(latestBarReadMessage([]), null);
  });

  it("returns null on non-array input", () => {
    assert.equal(latestBarReadMessage(undefined), null);
    assert.equal(latestBarReadMessage(null), null);
  });
});

describe("deriveAddCandidate", () => {
  const longSetup = { side: "long", entry: 105, stop: 100, tp1: 120, model: "Trend" };
  const shortSetup = { side: "short", entry: 105, stop: 110, tp1: 90, model: "MSS" };
  const longPos = { side: "buy", qty: 1, avgFill: 100, sl: 95, tp: 110 };
  const shortPos = { side: "sell", qty: 1, avgFill: 110, sl: 115, tp: 100 };

  it("returns null with no position", () => {
    assert.equal(deriveAddCandidate({ position: null, activeSetup: longSetup, price: 106 }), null);
  });

  it("returns null with no activeSetup", () => {
    assert.equal(deriveAddCandidate({ position: longPos, activeSetup: null, price: 106 }), null);
  });

  it("returns null when sides differ (no reversing via add)", () => {
    assert.equal(deriveAddCandidate({ position: longPos, activeSetup: shortSetup, price: 106 }), null);
  });

  it("returns null when the anchor is not green-lit (<50% to TP1)", () => {
    // long: entry 100, tp 110, price 104 → progress 0.4
    assert.equal(deriveAddCandidate({ position: longPos, activeSetup: longSetup, price: 104 }), null);
  });

  it("returns the candidate when same side and green-lit (>=50% to TP1) — long", () => {
    // long: entry 100, tp 110, price 105 → progress 0.5
    assert.equal(deriveAddCandidate({ position: longPos, activeSetup: longSetup, price: 105 }), longSetup);
  });

  it("returns the candidate when same side and green-lit — short", () => {
    // short: entry 110, tp 100, price 105 → progress 0.5
    assert.equal(deriveAddCandidate({ position: shortPos, activeSetup: shortSetup, price: 105 }), shortSetup);
  });

  it("returns null when TP is missing / equal to entry (can't judge green-lit)", () => {
    assert.equal(deriveAddCandidate({ position: { ...longPos, tp: null }, activeSetup: longSetup, price: 109 }), null);
    assert.equal(deriveAddCandidate({ position: { ...longPos, tp: 100 }, activeSetup: longSetup, price: 109 }), null);
  });

  it("returns null when price is not finite", () => {
    assert.equal(deriveAddCandidate({ position: longPos, activeSetup: longSetup, price: undefined }), null);
  });
});

describe("trancheStackFromState", () => {
  it("maps open journal trades to stack rows, anchor first then adds by seq", () => {
    const trades = [
      { id: "T-0002", tranche_role: "add", tranche_seq: 1, side: "long", grade: "B", entry: 105, stop: 102, tp1: 112, state: "filled" },
      { id: "T-0001", tranche_role: "anchor", tranche_seq: 0, side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, state: "filled" },
    ];
    const rows = trancheStackFromState(trades, 108);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].role, "anchor");
    assert.equal(rows[0].id, "T-0001");
    assert.equal(rows[1].role, "add");
  });
  it("excludes closed tranches", () => {
    const trades = [
      { id: "T-0001", tranche_role: "anchor", side: "long", grade: "A+", entry: 100, stop: 95, tp1: 110, state: "closed" },
      { id: "T-0002", tranche_role: "add", side: "long", grade: "B", entry: 105, stop: 102, tp1: 112, state: "filled" },
    ];
    const rows = trancheStackFromState(trades, 108);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "T-0002");
  });
  it("returns [] for empty / non-array", () => {
    assert.deepEqual(trancheStackFromState(null, 100), []);
    assert.deepEqual(trancheStackFromState([], 100), []);
  });
});

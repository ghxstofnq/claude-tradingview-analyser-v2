// Unit tests for app/renderer/src/Prep.helpers.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
} from "../app/renderer/src/Prep.helpers.js";

describe("groupLevelsByPrice", () => {
  const levels = [
    { name: "PWH", price: 21420, state: "untaken" },
    { name: "PDH", price: 21385, state: "untaken" },
    { name: "AS.H", price: 21380, state: "taken" },
    { name: "AS.L", price: 21290, state: "untaken" },
    { name: "PDL", price: 21230, state: "taken" },
  ];

  it("partitions levels into above and below currentPrice", () => {
    const { above, below } = groupLevelsByPrice(levels, 21350);
    // currentPrice = 21350. Above: PWH (70 away), PDH (35), AS.H (30) — closest first.
    assert.deepEqual(above.map((l) => l.name), ["AS.H", "PDH", "PWH"]);
    // Below: AS.L (60), PDL (120) — closest first.
    assert.deepEqual(below.map((l) => l.name), ["AS.L", "PDL"]);
  });

  it("places level exactly at currentPrice into 'below'", () => {
    const { below } = groupLevelsByPrice([{ name: "X", price: 100 }], 100);
    assert.equal(below[0].name, "X");
  });

  it("returns { above: null, below: null, all: sorted-high-to-low } when currentPrice is missing", () => {
    const { above, below, all } = groupLevelsByPrice(levels, null);
    assert.equal(above, null);
    assert.equal(below, null);
    assert.deepEqual(all.map((l) => l.name), ["PWH", "PDH", "AS.H", "AS.L", "PDL"]);
  });

  it("filters out items with non-numeric price", () => {
    const { above } = groupLevelsByPrice(
      [{ name: "X", price: "PDH" }, { name: "Y", price: 100 }],
      50,
    );
    assert.equal(above.length, 1);
    assert.equal(above[0].name, "Y");
  });

  it("returns empty arrays when no valid levels exist", () => {
    const { above, below } = groupLevelsByPrice([], 100);
    assert.deepEqual(above, []);
    assert.deepEqual(below, []);
  });
});

describe("selectPillar", () => {
  const pillars = [
    { name: "Draw & Bias", status: "pass", elements: [] },
    { name: "Price-Action Quality", status: "weak", elements: [] },
    { name: "Entry Model + Confirmation", status: "pending", elements: [] },
  ];

  it("finds Pillar 1 by name substring", () => {
    const p = selectPillar(pillars, /draw.*bias/i);
    assert.equal(p.status, "pass");
  });

  it("finds Pillar 2 by name substring", () => {
    const p = selectPillar(pillars, /price.*action|quality/i);
    assert.equal(p.status, "weak");
  });

  it("returns null when no pillar matches", () => {
    assert.equal(selectPillar(pillars, /nope/i), null);
  });

  it("returns null when pillars is not an array", () => {
    assert.equal(selectPillar(undefined, /.*/), null);
    assert.equal(selectPillar(null, /.*/), null);
  });
});

describe("pillar2ToRows", () => {
  it("maps three rows in fixed order, matched by name substring", () => {
    const pillar2 = {
      elements: [
        { name: "15m/5m candle quality", status: "weak", detail: "avg body 0.42" },
        { name: "3h range size", status: "pass", detail: "132pt" },
        { name: "4H displacement", status: "weak", detail: "disp_score 4" },
      ],
    };
    const rows = pillar2ToRows(pillar2);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].k, "3h range");
    assert.match(rows[0].v, /PASS/);
    assert.equal(rows[0].tone, "green");
    assert.equal(rows[1].k, "4H/1H displacement");
    assert.equal(rows[1].tone, "amber");
    assert.equal(rows[2].k, "15m/5m candles");
    assert.equal(rows[2].tone, "amber");
  });

  it("renders missing elements as '—' with dim tone", () => {
    const rows = pillar2ToRows({ elements: [] });
    assert.equal(rows.every((r) => r.v === "—"), true);
    assert.equal(rows.every((r) => r.tone === "dim"), true);
  });

  it("tolerates null pillar2 input", () => {
    const rows = pillar2ToRows(null);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].v, "—");
  });
});

describe("formatChainChip", () => {
  it("hides for null / undefined", () => {
    assert.equal(formatChainChip(null).visible, false);
    assert.equal(formatChainChip(undefined).visible, false);
  });

  it("hides for 'clean'", () => {
    assert.equal(formatChainChip("clean").visible, false);
  });

  it("shows amber for non-clean non-stale states", () => {
    const r = formatChainChip("degraded:pillar2_poor");
    assert.equal(r.visible, true);
    assert.equal(r.tone, "warn");
    assert.equal(r.label, "degraded:pillar2_poor");
  });

  it("shows red for stale:N", () => {
    const r = formatChainChip("stale:18");
    assert.equal(r.visible, true);
    assert.equal(r.tone, "stale");
  });
});

// tests/day-chip.test.js
// The top-bar day chip formatter (app/renderer/src/shell/dayChip.helpers.js).
// Display-only: it must surface existing grade/vote fields, never re-derive.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDayChip, daySizeLabel } from "../app/renderer/src/shell/dayChip.helpers.js";

// ET weekdays, fixed dates (2026-07-06 = Monday).
const MON = new Date("2026-07-06T15:00:00Z");
const THU = new Date("2026-07-09T15:00:00Z");
const FRI = new Date("2026-07-10T15:00:00Z");
const SAT = new Date("2026-07-11T15:00:00Z");

describe("daySizeLabel", () => {
  it("Mon/Fri half, Tue–Thu full, weekend none (strategy.risk-and-management)", () => {
    assert.deepEqual(daySizeLabel(MON), { day: "MON", sizeText: "HALF" });
    assert.deepEqual(daySizeLabel(THU), { day: "THU", sizeText: "FULL" });
    assert.deepEqual(daySizeLabel(FRI), { day: "FRI", sizeText: "HALF" });
    assert.deepEqual(daySizeLabel(SAT), { day: "SAT", sizeText: null });
  });
});

describe("buildDayChip", () => {
  it("no brief and no resolver context → honest NO BRIEF state", () => {
    const chip = buildDayChip({ now: THU });
    assert.equal(chip.state, "none");
    assert.equal(chip.text, "NO BRIEF");
  });

  it("brief-only pre-open: grade from pillar_grade, votes counted from existing rows", () => {
    const chip = buildDayChip({
      brief: { pillar_grade: "B", pillar1_votes: { htf: "bullish", overnight: "bullish" } },
      now: THU,
    });
    assert.equal(chip.state, "ok");
    assert.equal(chip.tone, "amber");
    assert.equal(chip.text, "B · 2/3 · THU FULL");
  });

  it("live resolver cap outranks the brief grade", () => {
    const chip = buildDayChip({
      brief: { pillar_grade: "A+", pillar1_votes: { htf: "bullish", overnight: "bullish" } },
      ltf: { bias: "bullish", htf_ltf_alignment: "aligned", grade_cap: "B" },
      now: THU,
    });
    assert.equal(chip.text, "B · 3/3 · THU FULL");
    assert.equal(chip.tone, "amber");
    assert.match(chip.title, /live cap/);
  });

  it("aligned 3/3 A+ day renders green", () => {
    const chip = buildDayChip({
      brief: { pillar_grade: "A+", pillar1_votes: { htf: "bearish", overnight: "bearish" } },
      ltf: { bias: "bearish", htf_ltf_alignment: "aligned" },
      now: MON,
    });
    assert.equal(chip.tone, "green");
    assert.equal(chip.text, "A+ · 3/3 · MON HALF");
  });

  it("open reversing the bias → HANDS OFF (daily-bias.md §4)", () => {
    const chip = buildDayChip({
      brief: { pillar_grade: "B", pillar1_votes: { htf: "bullish", overnight: "bullish" } },
      ltf: { bias: "bearish", htf_ltf_alignment: "divergent" },
      now: THU,
    });
    assert.equal(chip.state, "handsoff");
    assert.match(chip.text, /^HANDS OFF/);
    assert.equal(chip.tone, "red");
  });

  it("no-trade brief renders red NO-TRADE", () => {
    const chip = buildDayChip({
      brief: { pillar_grade: "no-trade", pillar1_votes: { htf: "none", overnight: "bullish" } },
      now: THU,
    });
    assert.equal(chip.tone, "red");
    assert.match(chip.text, /^NO-TRADE · 1\/3/);
  });
});

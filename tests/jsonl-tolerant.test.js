// Regression for audit C20/C21: a torn tail line in a money-path journal must
// not throw (which silently halted outcome tracking / failed the loss-halt open).
import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonlTolerant } from "../cli/lib/jsonl.js";
import { consecutiveLossStreak } from "../cli/lib/trade-outcomes.js";

const ACCEPT = (id) => JSON.stringify({ type: "accept", id, side: "long", entry: 21000, stop: 20990, tp1: 21050, grade: "B" });
const LOSS = (id) => JSON.stringify({ type: "outcome", id, status: "STOPPED", r_realized: -1 });

test("parseJsonlTolerant drops only the torn line and reports the count", () => {
  const good = ACCEPT("T-1");
  const torn = '{"type":"outcome","id":"T-1","stat';
  const buf = good + "\n" + torn;

  // Before-fix behavior: the naive parse the money path used throws.
  assert.throws(() => buf.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));

  // After-fix: tolerant parse keeps the good record, flags the drop.
  const { records, dropped } = parseJsonlTolerant(buf);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, "T-1");
  assert.equal(dropped, 1);
});

test("loss-halt streak is computed correctly across a torn tail line", () => {
  // Three consecutive losers, then a crash left a partial 4th line.
  const buf = [ACCEPT("A"), LOSS("A"), ACCEPT("B"), LOSS("B"), ACCEPT("C"), LOSS("C")].join("\n") + '\n{"type":"acce';
  const { records, dropped } = parseJsonlTolerant(buf);
  assert.equal(dropped, 1);
  assert.ok(consecutiveLossStreak(records) >= 3, "3-loss halt must still trip on the good lines");
});

test("blank lines are ignored, not counted as corruption", () => {
  const { records, dropped } = parseJsonlTolerant(ACCEPT("T-1") + "\n\n  \n" + LOSS("T-1") + "\n");
  assert.equal(records.length, 2);
  assert.equal(dropped, 0);
});

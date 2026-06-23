import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRunnerStructure } from "../cli/lib/runner-structure.js";

// Minimal engine shape: gates.engine.pillar3.{swings.swing[], most_recent_structure}
const engineWith = ({ swings = [], mrs = null, last = null } = {}) => ({
  price_context: last != null ? { last } : undefined,
  pillar3: { swings: { swing: swings }, most_recent_structure: mrs },
});

test("absent engine / bad side → inert", () => {
  assert.deepEqual(deriveRunnerStructure(null, "long", 100), { protectiveLevel: null, structureBreakAgainst: false });
  assert.deepEqual(deriveRunnerStructure(engineWith(), "sideways", 100), { protectiveLevel: null, structureBreakAgainst: false });
});

test("long: protective level = highest swing LOW below price", () => {
  const eng = engineWith({ swings: [
    { is_high: false, level: 90, tier: "swing" },
    { is_high: false, level: 95, tier: "swing" },   // highest HL under price
    { is_high: false, level: 102, tier: "swing" },  // above price — ignored
    { is_high: true, level: 96, tier: "swing" },    // a high — ignored for a long
  ]});
  assert.equal(deriveRunnerStructure(eng, "long", 100).protectiveLevel, 95);
});

test("short: protective level = lowest swing HIGH above price", () => {
  const eng = engineWith({ swings: [
    { is_high: true, level: 110, tier: "swing" },
    { is_high: true, level: 105, tier: "swing" },   // lowest LH over price
    { is_high: true, level: 98, tier: "swing" },    // below price — ignored
  ]});
  assert.equal(deriveRunnerStructure(eng, "short", 100).protectiveLevel, 105);
});

test("no protective pivot on the right side of price → null", () => {
  const eng = engineWith({ swings: [{ is_high: false, level: 105, tier: "swing" }] });
  assert.equal(deriveRunnerStructure(eng, "long", 100).protectiveLevel, null);
});

test("refPrice falls back to engine.price_context.last", () => {
  const eng = engineWith({ swings: [{ is_high: false, level: 95, tier: "swing" }], last: 100 });
  assert.equal(deriveRunnerStructure(eng, "long").protectiveLevel, 95);
});

test("structure break against a long: swing-tier displaced bearish break → exit", () => {
  const eng = engineWith({ mrs: { tier: "swing", dir: "bearish", event: "mss", validation: "break", displacement: true } });
  assert.equal(deriveRunnerStructure(eng, "long", 100).structureBreakAgainst, true);
});

test("structure break against a short: swing-tier displaced bullish break → exit", () => {
  const eng = engineWith({ mrs: { tier: "swing", dir: "bull", event: "mss", validation: "break", displacement: true } });
  assert.equal(deriveRunnerStructure(eng, "short", 100).structureBreakAgainst, true);
});

test("a same-direction break does NOT exit (structure still with you)", () => {
  const eng = engineWith({ mrs: { tier: "swing", dir: "bullish", validation: "break", displacement: true } });
  assert.equal(deriveRunnerStructure(eng, "long", 100).structureBreakAgainst, false);
});

test("a sweep (not a break) or non-displaced opposing structure does NOT exit", () => {
  const sweep = engineWith({ mrs: { tier: "swing", dir: "bearish", validation: "sweep", displacement: true } });
  assert.equal(deriveRunnerStructure(sweep, "long", 100).structureBreakAgainst, false);
  const noDisp = engineWith({ mrs: { tier: "swing", dir: "bearish", validation: "break", displacement: false } });
  assert.equal(deriveRunnerStructure(noDisp, "long", 100).structureBreakAgainst, false);
});

test("an internal-tier opposing break does NOT exit (swing-tier only)", () => {
  const eng = engineWith({ mrs: { tier: "internal", dir: "bearish", validation: "break", displacement: true } });
  assert.equal(deriveRunnerStructure(eng, "long", 100).structureBreakAgainst, false);
});

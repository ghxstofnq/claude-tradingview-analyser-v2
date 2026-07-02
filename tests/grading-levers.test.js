// Lever mechanics for the grading group (audit C2/C5/C6). Each lever is
// default-OFF; these assert the OFF behavior is unchanged and the ON behavior
// matches the spec-derived rule. End-to-end fold coverage is the tape gate
// (npm run tapes) — this file locks the unit-level switch behavior.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __test as ep } from "../app/main/strategy/walkers/execution-packet.js";
import { buildMssWalkerKillRequests } from "../app/main/strategy/walkers/mss-lifecycle.js";

const { deriveGrade } = ep;
afterEach(() => {
  delete process.env.GOFNQ_D5_ELEVATION_RESPECTS_CAP;
  delete process.env.GOFNQ_LEGACY_GRADE_B_CAP;
  delete process.env.GOFNQ_MSS_KILL_ANCHOR_SWEPT_LOW;
});

// A 2/3 (b_elevatable) day with a multi-alignment entry. gradeCap models the
// open-reaction resolver verdict: 'A+' on an aligned day, 'B' on a divergent one.
function twoOfThreeCtx(gradeCap) {
  return {
    pillar1: { status: "pass" }, pillar2: { status: "pass", atr14: 15 },
    // A DISTINCT same-dir (bull) 5m FVG that took liquidity and overlaps the
    // entry zone [20950,20970] — the "two-and-one" hasMultiAlignment requires.
    pillar3: { fvgs5m: [{ top: 20990, bottom: 20960, took_liq: true, dir: "bull" }] },
    sessionChain: {
      drawBiasPillar: "clear-2of3", bElevatable: true, aPlusEligible: false,
      gradeCap, ltfBias: "bullish", htfLtfAlignment: gradeCap === "A+" ? "aligned" : "divergent",
    },
  };
}
// An INVERSION long entry whose zone the 5m FVG above overlaps (the two-and-one).
const multiAlignWalker = {
  model: "inversion", side: "long",
  evidence: { pdArray: { rawPayload: { bottom: 20950, top: 20970 } } },
};

describe("C5 GOFNQ_D5_ELEVATION_RESPECTS_CAP", () => {
  it("OFF: an aligned 2/3 multi-alignment day is A+ (02-09 behavior preserved)", () => {
    assert.equal(deriveGrade({ context: twoOfThreeCtx("A+"), walker: multiAlignWalker }), "A+");
  });
  it("ON: an ALIGNED 2/3 day still elevates to A+ (cap is A+ → no change)", () => {
    process.env.GOFNQ_D5_ELEVATION_RESPECTS_CAP = "1";
    assert.equal(deriveGrade({ context: twoOfThreeCtx("A+"), walker: multiAlignWalker }), "A+");
  });
  it("ON: a DIVERGENT 2/3 day is held at B (elevation respects the divergence cap)", () => {
    process.env.GOFNQ_D5_ELEVATION_RESPECTS_CAP = "1";
    const g = deriveGrade({ context: twoOfThreeCtx("B"), walker: multiAlignWalker });
    assert.equal(g, "B");
  });
  it("OFF: a DIVERGENT 2/3 day still returns raw A+ (the finding's behavior)", () => {
    // Only asserts the switch flips something on divergent days; the exact OFF
    // value is 'A+' per the current bypass.
    const g = deriveGrade({ context: twoOfThreeCtx("B"), walker: multiAlignWalker });
    assert.equal(g, "A+");
  });
});

describe("C6 GOFNQ_LEGACY_GRADE_B_CAP", () => {
  // Legacy fallback: no nested drawBiasPillar; aligned + clean displacement.
  const legacyCtx = {
    pillar1: { status: "pass" }, pillar2: { status: "pass", displacement: "clean" },
    sessionChain: { drawBiasPillar: null, ltfBias: "bullish", htfLtfAlignment: "aligned", gradeCap: "A+" },
  };
  const walker = { model: "mss", side: "long", evidence: {} };
  it("OFF: legacy path awards A+ from the displacement proxy (the finding)", () => {
    delete process.env.GOFNQ_LEGACY_GRADE_B_CAP;
    assert.equal(deriveGrade({ context: legacyCtx, walker }), "A+");
  });
  it("ON: legacy path caps at B (no 3/3 count, no two-and-one → not A+)", () => {
    process.env.GOFNQ_LEGACY_GRADE_B_CAP = "1";
    assert.equal(deriveGrade({ context: legacyCtx, walker }), "B");
  });
});

describe("C2 GOFNQ_MSS_KILL_ANCHOR_SWEPT_LOW", () => {
  // A swing-grab MSS long: synthesized sweep price is the broken LH (21050);
  // the FVG protective edge (bottom) is 20950. Current close 21000 is BELOW the
  // LH (would kill) but ABOVE the FVG low (should survive).
  const ctxAt = (close) => ({ pillar3: { ohlcv1m: [{ close }] } });
  const walker = {
    model: "MSS", side: "long", stage: "tap_seen",
    evidence: {
      sweep: { rawPayload: { price: 21050, source: "swept_swing" } },
      pdArray: { rawPayload: { bottom: 20950, top: 20970 } },
    },
  };
  it("OFF: kills on the broken-LH anchor (close 21000 < LH 21050) — the bug", () => {
    delete process.env.GOFNQ_MSS_KILL_ANCHOR_SWEPT_LOW;
    const reqs = buildMssWalkerKillRequests(ctxAt(21000), [walker]);
    assert.equal(reqs.length, 1, "legacy anchor kills the walker mid-retrace");
  });
  it("ON: anchors on the FVG low (close 21000 > 20950) — walker survives the retrace", () => {
    process.env.GOFNQ_MSS_KILL_ANCHOR_SWEPT_LOW = "1";
    const reqs = buildMssWalkerKillRequests(ctxAt(21000), [walker]);
    assert.equal(reqs.length, 0, "swept-low anchor lets the reversal survive the normal retrace");
  });
  it("ON: still kills when price closes BELOW the FVG low (real invalidation)", () => {
    process.env.GOFNQ_MSS_KILL_ANCHOR_SWEPT_LOW = "1";
    const reqs = buildMssWalkerKillRequests(ctxAt(20940), [walker]);
    assert.equal(reqs.length, 1, "close below the FVG low is a genuine dead premise");
  });
});

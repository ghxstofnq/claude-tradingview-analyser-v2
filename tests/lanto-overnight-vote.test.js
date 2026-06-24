import { test } from "node:test";
import assert from "node:assert/strict";
import { overnightVote } from "../cli/lib/lanto-overnight-vote.js";

// Rubric §3: a clear bearish/bullish overnight state votes that direction;
// consolidation / chop votes none (Daily Bias 15:54 / 16:50). Driven by the
// engine's own overnight_dir classification (bull / bear / chop).

test("chop → none", () => {
  assert.equal(overnightVote({ overnight_dir: "chop", overnight_net: -81.75 }), "none");
});

test("clear bull → bull", () => {
  assert.equal(overnightVote({ overnight_dir: "bull", overnight_net: 18304.5 }), "bull");
});

test("clear bear → bear", () => {
  assert.equal(overnightVote({ overnight_dir: "bear", overnight_net: -4200 }), "bear");
});

test("missing/unknown → none", () => {
  assert.equal(overnightVote({}), "none");
  assert.equal(overnightVote({ overnight_dir: "consolidation" }), "none");
});

test("contradiction guard: dir bull but net clearly negative → none", () => {
  assert.equal(overnightVote({ overnight_dir: "bull", overnight_net: -5000 }), "none");
});

test("dir set, net absent → trust the dir", () => {
  assert.equal(overnightVote({ overnight_dir: "bear" }), "bear");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { htfVote } from "../cli/lib/lanto-htf-vote.js";

// Rubric §2: HTF votes a direction from EITHER clearly-directional momentum
// (consecutive same-sign daily/4H/1H) OR an observed reaction to a SIGNIFICANT
// near-price array (reject → continue the gap's dir; invert → flip). Conflicting
// momentum + no reaction → none. A lone insignificant array against strong
// momentum is overridden by price.

test("conflicting momentum (daily bull, 4H+1H bear), no array → none (2026-06-24 MES)", () => {
  assert.equal(htfVote({ daily: "bull", h4: "bear", h1: "bear" }), "none");
});

test("aligned bull momentum → bull", () => {
  assert.equal(htfVote({ daily: "bull", h4: "bull", h1: "bull" }), "bull");
});

test("aligned bear momentum → bear", () => {
  assert.equal(htfVote({ daily: "bear", h4: "bear", h1: "bear" }), "bear");
});

test("two agree, one none → that direction", () => {
  assert.equal(htfVote({ daily: "bull", h4: "bull", h1: "none" }), "bull");
});

test("all none → none", () => {
  assert.equal(htfVote({ daily: "none", h4: "none", h1: "none" }), "none");
});

test("significant array REJECT (bull gap) → bull, regardless of flat momentum", () => {
  const v = htfVote(
    { daily: "none", h4: "none", h1: "none" },
    { array: { dir: "bull" }, reaction: "reject", arraySignificant: true },
  );
  assert.equal(v, "bull");
});

test("significant array INVERT (bull gap) → bear (flip)", () => {
  const v = htfVote(
    { daily: "none", h4: "none", h1: "none" },
    { array: { dir: "bull" }, reaction: "invert", arraySignificant: true },
  );
  assert.equal(v, "bear");
});

test("INSIGNIFICANT array against strong momentum → momentum wins (price overrides)", () => {
  const v = htfVote(
    { daily: "bear", h4: "bear", h1: "bear" },
    { array: { dir: "bull" }, reaction: "reject", arraySignificant: false },
  );
  assert.equal(v, "bear");
});

test("a significant array reaction overrides even conflicting momentum (reaction dictates narrative)", () => {
  const v = htfVote(
    { daily: "bull", h4: "bear", h1: "bear" },
    { array: { dir: "bear" }, reaction: "reject", arraySignificant: true },
  );
  assert.equal(v, "bear");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDrawBias } from "../cli/lib/lanto-bias.js";

// Rubric §1: count components confirming one direction.
// 1 → no-trade, 2 → B, 3 → A+. openVote === null means pre-session (only HTF +
// overnight available) → ceiling B. Pick the direction with the most votes;
// no direction with ≥2 → no-trade.

test("pre-session 2/2 agree → B", () => {
  const r = computeDrawBias({ htfVote: "bull", overnightVote: "bull", openVote: null });
  assert.equal(r.grade, "B");
  assert.equal(r.count, 2);
  assert.equal(r.direction, "bull");
});

test("pre-session ceiling: never A+ even with both agreeing", () => {
  const r = computeDrawBias({ htfVote: "bear", overnightVote: "bear", openVote: null });
  assert.equal(r.grade, "B");
  assert.equal(r.direction, "bear");
});

test("pre-session single component → no-trade (1/3)", () => {
  const r = computeDrawBias({ htfVote: "bull", overnightVote: "none", openVote: null });
  assert.equal(r.grade, "no-trade");
  assert.equal(r.count, 1);
  assert.equal(r.no_trade_reason, "single_component");
});

test("2026-06-24 MES worked check: both none → no-trade", () => {
  const r = computeDrawBias({ htfVote: "none", overnightVote: "none", openVote: null });
  assert.equal(r.grade, "no-trade");
  assert.equal(r.count, 0);
  assert.equal(r.no_trade_reason, "no_directional_component");
});

test("conflict (htf bull, overnight bear) → no-trade", () => {
  const r = computeDrawBias({ htfVote: "bull", overnightVote: "bear", openVote: null });
  assert.equal(r.grade, "no-trade");
  assert.equal(r.direction, null);
  assert.equal(r.no_trade_reason, "components_conflict");
});

test("live 3/3 → A+", () => {
  const r = computeDrawBias({ htfVote: "bull", overnightVote: "bull", openVote: "bull" });
  assert.equal(r.grade, "A+");
  assert.equal(r.count, 3);
  assert.equal(r.direction, "bull");
});

test("live 2/3 (one dissent) → B", () => {
  const r = computeDrawBias({ htfVote: "bull", overnightVote: "bull", openVote: "bear" });
  assert.equal(r.grade, "B");
  assert.equal(r.count, 2);
  assert.equal(r.direction, "bull");
});

test("live 2/3 (one none) → B", () => {
  const r = computeDrawBias({ htfVote: "bull", overnightVote: "none", openVote: "bull" });
  assert.equal(r.grade, "B");
  assert.equal(r.count, 2);
});

test("votes are echoed back for surfacing", () => {
  const r = computeDrawBias({ htfVote: "bull", overnightVote: "none", openVote: null });
  assert.equal(r.votes.htf, "bull");
  assert.equal(r.votes.overnight, "none");
  assert.equal(r.votes.open, null);
});

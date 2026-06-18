// tests/open-reaction-routing.test.js — the "lock early → hunt early" gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openReactionResolvedToHunt, entryHuntStandAside } from "../app/main/bar-close.js";

test("entryHuntStandAside: a standaside decision blocks the walk; a real leader does not", () => {
  assert.equal(entryHuntStandAside({ standaside: true, leader: null, reason: "smt_unreadable_data" }), true);
  assert.equal(entryHuntStandAside({ standaside: false, leader: "MES1!" }), false);
  assert.equal(entryHuntStandAside({ leader: "MNQ1!" }), false);
  assert.equal(entryHuntStandAside(null), false);
});

test("a fresh lock with a final bias activates entry_hunt this bar", () => {
  assert.equal(openReactionResolvedToHunt({ wrote: true, locked: true, bias: "bearish" }), true);
});

test("an already-final session (lock landed on a prior bar) activates entry_hunt", () => {
  assert.equal(openReactionResolvedToHunt({ wrote: false, reason: "already_final" }), true);
});

test("still resolving (locked but pending bias) does NOT activate entry_hunt", () => {
  assert.equal(openReactionResolvedToHunt({ wrote: true, locked: false, bias: "pending" }), false);
  assert.equal(openReactionResolvedToHunt({ wrote: true, locked: true, bias: "pending" }), false);
  assert.equal(openReactionResolvedToHunt({ wrote: true, locked: true, bias: null }), false);
});

test("stand-aside is NOT tradeable — stays in open_reaction (no PAIR_PRIMARY hunt)", () => {
  assert.equal(openReactionResolvedToHunt({ wrote: true, standaside: true, bias: "stand_aside" }), false);
});

test("null / empty result does not activate entry_hunt", () => {
  assert.equal(openReactionResolvedToHunt(null), false);
  assert.equal(openReactionResolvedToHunt({}), false);
});

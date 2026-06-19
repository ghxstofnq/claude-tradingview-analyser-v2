import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalSymbol, parseRunSymbol } from "../cli/lib/run-symbol.js";

test("canonicalSymbol — normalizes every form to MNQ1!/MES1!", () => {
  assert.equal(canonicalSymbol("mnq"), "MNQ1!");
  assert.equal(canonicalSymbol("MES"), "MES1!");
  assert.equal(canonicalSymbol("MNQ1!"), "MNQ1!");
  assert.equal(canonicalSymbol("CME_MINI:MES1!"), "MES1!");
});

test("canonicalSymbol — null for anything that isn't MNQ/MES (never guesses)", () => {
  assert.equal(canonicalSymbol(undefined), null);
  assert.equal(canonicalSymbol(null), null);
  assert.equal(canonicalSymbol(""), null);
  assert.equal(canonicalSymbol("ES1!"), null);
  assert.equal(canonicalSymbol("both"), null);
});

test("parseRunSymbol — recovers the instrument from recorded-file text", () => {
  assert.equal(parseRunSymbol('{"symbol":"CME_MINI:MES1!", "x":1}'), "MES1!");
  assert.equal(parseRunSymbol("...lots of MNQ1! bars..."), "MNQ1!");
  assert.equal(parseRunSymbol("no instrument here"), null);
  assert.equal(parseRunSymbol(""), null);
});

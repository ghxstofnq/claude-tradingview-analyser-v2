// tests/use-live.test.js
// Pure-function tests for useLive reducer + deriveSubState selector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reducer, INITIAL, deriveSubState } from "../app/renderer/src/hooks/useLive.js";

test("INITIAL — idle phase, no trade, no surfaced setup", () => {
  assert.equal(INITIAL.phase, "idle");
  assert.equal(INITIAL.activeTrade, null);
  assert.equal(INITIAL.surfacedSetup, null);
  assert.equal(INITIAL.ltfBias, null);
  assert.deepEqual(INITIAL.setupHistory, []);
});

test("deriveSubState — phase='idle' + nothing else → 'idle'", () => {
  assert.equal(deriveSubState({ phase: "idle", activeTrade: null, surfacedSetup: null }), "idle");
});

test("deriveSubState — phase='open_reaction' → 'open-reaction'", () => {
  assert.equal(deriveSubState({ phase: "open_reaction", activeTrade: null, surfacedSetup: null }), "open-reaction");
});

test("deriveSubState — phase='entry_hunt' (no setup yet) → 'entry-hunt'", () => {
  assert.equal(deriveSubState({ phase: "entry_hunt", activeTrade: null, surfacedSetup: null }), "entry-hunt");
});

test("deriveSubState — surfacedSetup present (and no trade) → 'entry-hunt'", () => {
  // Even if phase is open_reaction, a surfaced setup forces entry-hunt UI
  assert.equal(deriveSubState({ phase: "open_reaction", activeTrade: null, surfacedSetup: { id: "s1" } }), "entry-hunt");
});

test("deriveSubState — activeTrade overrides everything → 'in-trade'", () => {
  assert.equal(deriveSubState({ phase: "entry_hunt", activeTrade: { id: "t1" }, surfacedSetup: { id: "s1" } }), "in-trade");
  assert.equal(deriveSubState({ phase: "idle", activeTrade: { id: "t1" }, surfacedSetup: null }), "in-trade");
});

test("deriveSubState — phase='wrap' → 'done'", () => {
  assert.equal(deriveSubState({ phase: "wrap", activeTrade: null, surfacedSetup: null }), "done");
});

test("reducer — PHASE_SET updates phase", () => {
  const s = reducer(INITIAL, { type: "PHASE_SET", phase: "entry_hunt" });
  assert.equal(s.phase, "entry_hunt");
});

test("reducer — ACTIVE_TRADE_SET stores trade", () => {
  const trade = { id: "t1", side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const s = reducer(INITIAL, { type: "ACTIVE_TRADE_SET", trade });
  assert.deepEqual(s.activeTrade, trade);
});

test("reducer — ACTIVE_TRADE_CLEAR removes the trade", () => {
  const s1 = reducer(INITIAL, { type: "ACTIVE_TRADE_SET", trade: { id: "t1" } });
  const s2 = reducer(s1, { type: "ACTIVE_TRADE_CLEAR" });
  assert.equal(s2.activeTrade, null);
});

test("reducer — SURFACED_SETUP stores the setup", () => {
  const setup = { id: "s1", side: "short", entry: 29080, stop: 29105, tp1: 29050 };
  const s = reducer(INITIAL, { type: "SURFACED_SETUP", setup });
  assert.deepEqual(s.surfacedSetup, setup);
});

test("reducer — ACCEPT_SETUP clears the surfaced setup", () => {
  const s1 = reducer(INITIAL, { type: "SURFACED_SETUP", setup: { id: "s1" } });
  const s2 = reducer(s1, { type: "ACCEPT_SETUP" });
  assert.equal(s2.surfacedSetup, null);
});

test("reducer — REJECT_SETUP clears the surfaced setup", () => {
  const s1 = reducer(INITIAL, { type: "SURFACED_SETUP", setup: { id: "s1" } });
  const s2 = reducer(s1, { type: "REJECT_SETUP" });
  assert.equal(s2.surfacedSetup, null);
});

test("reducer — LTF_BIAS_SET stores the bias", () => {
  const bias = { value: "bearish", note: "..." };
  const s = reducer(INITIAL, { type: "LTF_BIAS_SET", bias });
  assert.deepEqual(s.ltfBias, bias);
});

test("reducer — SETUP_HISTORY_SET replaces setup history list", () => {
  const setups = [{ id: "s1" }, { id: "s2" }];
  const s = reducer(INITIAL, { type: "SETUP_HISTORY_SET", setups });
  assert.deepEqual(s.setupHistory, setups);
});

test("reducer — BAR_READ_MESSAGE stores latest bar-read message", () => {
  const msg = { type: "bar-read", text: "bias holding", ts: 123 };
  const s = reducer(INITIAL, { type: "BAR_READ_MESSAGE", message: msg });
  assert.deepEqual(s.lastBarReadMessage, msg);
});

test("reducer — unknown action returns same state", () => {
  const s = reducer(INITIAL, { type: "WAT" });
  assert.equal(s, INITIAL);
});

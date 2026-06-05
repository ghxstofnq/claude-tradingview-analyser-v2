import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTurnSurfaceContract } from "../app/main/turn-surface-contract.js";

const SETUP = "mcp__tv__surface_setup";
const NO_TRADE = "mcp__tv__surface_no_trade";
const BRIEF = "mcp__tv__surface_session_brief";
const OPEN = "mcp__tv__surface_open_reaction";
const LTF = "mcp__tv__surface_ltf_bias";
const SUMMARY = "mcp__tv__surface_session_summary";
const LEADER = "mcp__tv__surface_leader_decision";
const READ = "Read";

test("entry-hunt bar-close requires exactly one setup/no_trade surface", () => {
  const text = "A new 1m bar just closed. Phase: entry_hunt.";
  assert.deepEqual(validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [READ, SETUP] }), { ok: true });
  assert.deepEqual(validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [NO_TRADE] }), { ok: true });

  assert.match(
    validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [READ] }).message,
    /exactly one of surface_setup or surface_no_trade/,
  );
  assert.match(
    validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [SETUP, NO_TRADE] }).message,
    /exactly one of surface_setup or surface_no_trade/,
  );
});

test("open-reaction bar-close requires open_reaction plus no_trade and forbids setup", () => {
  const text = "A new 1m bar just closed. Phase: open_reaction (+6m).";
  assert.deepEqual(validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [READ, OPEN, NO_TRADE] }), { ok: true });

  assert.match(
    validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [NO_TRADE] }).message,
    /must call surface_open_reaction/,
  );
  assert.match(
    validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [OPEN] }).message,
    /must end with surface_no_trade/,
  );
  assert.match(
    validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [OPEN, SETUP, NO_TRADE] }).message,
    /must not call surface_setup/,
  );
});

test("final open-reaction bar-close requires leader and ltf bias handoff", () => {
  const text = "A new 1m bar just closed. Phase: open_reaction (+14m). minutes_into_phase >= 14 — also call surface_leader_decision and surface_ltf_bias.";
  assert.deepEqual(validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [OPEN, LEADER, LTF, NO_TRADE] }), { ok: true });
  assert.match(
    validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [OPEN, LTF, NO_TRADE] }).message,
    /must call surface_leader_decision/,
  );
  assert.match(
    validateTurnSurfaceContract({ purpose: "bar-close", text, toolCalls: [OPEN, LEADER, NO_TRADE] }).message,
    /must call surface_ltf_bias/,
  );
});

test("brief and wrap must use their dedicated one-shot surface only", () => {
  assert.deepEqual(validateTurnSurfaceContract({ purpose: "brief", toolCalls: [READ, BRIEF] }), { ok: true });
  assert.match(
    validateTurnSurfaceContract({ purpose: "brief", toolCalls: [BRIEF, NO_TRADE] }).message,
    /exactly one surface_session_brief/,
  );

  assert.deepEqual(validateTurnSurfaceContract({ purpose: "wrap", toolCalls: [SUMMARY] }), { ok: true });
  assert.match(
    validateTurnSurfaceContract({ purpose: "wrap", toolCalls: [NO_TRADE] }).message,
    /exactly one surface_session_summary/,
  );
});

test("catch-up must end no_trade and never setup", () => {
  const text = "CATCH-UP TURN — Pick leader + finalize LTF bias. Call surface_leader_decision and surface_ltf_bias.";
  assert.deepEqual(validateTurnSurfaceContract({ purpose: "catch-up", text, toolCalls: [READ, LEADER, LTF, NO_TRADE] }), { ok: true });
  assert.match(
    validateTurnSurfaceContract({ purpose: "catch-up", text, toolCalls: [READ, LTF, NO_TRADE] }).message,
    /must call surface_leader_decision/,
  );
  assert.match(
    validateTurnSurfaceContract({ purpose: "catch-up", text, toolCalls: [READ, LEADER, NO_TRADE] }).message,
    /must call surface_ltf_bias/,
  );
  assert.match(
    validateTurnSurfaceContract({ purpose: "catch-up", text, toolCalls: [LEADER, LTF] }).message,
    /must end with surface_no_trade/,
  );
  assert.match(
    validateTurnSurfaceContract({ purpose: "catch-up", toolCalls: [SETUP, NO_TRADE] }).message,
    /must not call surface_setup/,
  );
});

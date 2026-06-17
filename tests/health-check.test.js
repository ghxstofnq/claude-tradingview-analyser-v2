// tests/health-check.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  classifyNoTradeReason, plumbingAlertKey, alertIfPlumbingBlock, __resetHealthAlerts,
} from "../app/main/health-check.js";

describe("classifyNoTradeReason", () => {
  it("the stand-aside reader bug (#106) is plumbing", () => {
    assert.equal(classifyNoTradeReason("cannot evaluate: strategy chain incomplete: missing_entry_model_priority, missing_grade_cap"), "plumbing");
  });
  it("missing engine rows is plumbing", () => {
    assert.equal(classifyNoTradeReason("cannot evaluate: source health failed: missing_ict_engine_rows"), "plumbing");
  });
  it("symbol_mismatch + missing draw (the #80 symptom) are plumbing", () => {
    assert.equal(classifyNoTradeReason("blocked: symbol_mismatch"), "plumbing");
    assert.equal(classifyNoTradeReason("strategy chain incomplete: missing_primary_draw, missing_htf_draw"), "plumbing");
  });
  it("no_confirmed_packet is a MARKET verdict — stays silent", () => {
    assert.equal(classifyNoTradeReason("deterministic packet blocked: no_confirmed_packet"), "market");
  });
  it("a legit stand-aside (missing_ltf_bias alone) is market — must NOT alert", () => {
    assert.equal(classifyNoTradeReason("cannot evaluate: strategy chain incomplete: missing_ltf_bias, missing_htf_ltf_alignment"), "market");
  });
  it("open-reaction observation window + session halt are market", () => {
    assert.equal(classifyNoTradeReason("open-reaction window +6m of 15 — observation only"), "market");
    assert.equal(classifyNoTradeReason("session halt: 3 losses in a row"), "market");
  });
});

describe("plumbingAlertKey", () => {
  it("collapses bar counts so the same condition de-dupes", () => {
    assert.equal(
      plumbingAlertKey("missing_ict_engine_rows on 12 bars"),
      plumbingAlertKey("missing_ict_engine_rows on 134 bars"),
    );
  });
});

describe("alertIfPlumbingBlock (throttle + routing)", () => {
  beforeEach(() => __resetHealthAlerts());

  it("fires once for a plumbing block, throttles repeats in the same session", async () => {
    const calls = [];
    const notify = async (n) => calls.push(n);
    const reason = "strategy chain incomplete: missing_entry_model_priority, missing_grade_cap";
    const r1 = await alertIfPlumbingBlock({ reason, session: "london", notify });
    const r2 = await alertIfPlumbingBlock({ reason, session: "london", notify });
    assert.equal(r1.alerted, true);
    assert.equal(r2.alerted, false);
    assert.equal(r2.throttled, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].body, /can't evaluate/);
  });

  it("does NOT fire for a market reason", async () => {
    const calls = [];
    const r = await alertIfPlumbingBlock({ reason: "no_confirmed_packet", session: "london", notify: async (n) => calls.push(n) });
    assert.equal(r.alerted, false);
    assert.equal(calls.length, 0);
  });

  it("a new session resets the throttle (re-alerts)", async () => {
    const calls = [];
    const notify = async (n) => calls.push(n);
    const reason = "source health failed: missing_ict_engine_rows";
    await alertIfPlumbingBlock({ reason, session: "ny-am", notify });
    await alertIfPlumbingBlock({ reason, session: "ny-pm", notify });
    assert.equal(calls.length, 2);
  });

  it("a DIFFERENT plumbing reason in the same session fires again", async () => {
    const calls = [];
    const notify = async (n) => calls.push(n);
    await alertIfPlumbingBlock({ reason: "missing_entry_model_priority", session: "london", notify });
    await alertIfPlumbingBlock({ reason: "symbol_mismatch", session: "london", notify });
    assert.equal(calls.length, 2);
  });

  it("emits an app:error event to the renderer when it fires", async () => {
    const events = [];
    await alertIfPlumbingBlock({
      reason: "missing_ict_engine_rows", session: "london",
      notify: async () => {}, send: (ch, p) => events.push({ ch, p }),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].ch, "app:error");
    assert.equal(events[0].p.kind, "plumbing_block");
  });
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDirectSessionWrapPayload,
  applyCodexWrapAnalysisToPayload,
  runDirectSessionWrap,
  validateCodexWrapAnalysis,
} from "../app/main/direct-session-wrap.js";
import { directRunFnForTests } from "../app/main/session-wrap.js";

const memoryText = `---
phase: ltf_bias
leader: MNQ1!
ltf_bias: bull
htf_ltf_alignment: aligned
grade_cap: B
chain_status: clean
---
# LTF Bias

## Reasoning
NY AM held the H4 bullish FVG and pushed toward EQH 30050.

SETUPS JSONL TAIL:
{"model":"MSS","side":"long","grade":"B","status":"confirmed","entry":30010,"tp1":30050,"outcome":"tp1_hit"}`;

describe("direct session wrap", () => {
  test("buildDirectSessionWrapPayload derives a valid deterministic summary from session memory", () => {
    const payload = buildDirectSessionWrapPayload({ session: "ny-am", memoryText });

    assert.equal(payload.session, "ny-am");
    assert.match(payload.bias_picture, /Direct wrap from persisted session memory/);
    assert.match(payload.what_happened, /MSS/);
    assert.equal(Array.isArray(payload.watch_next_session), true);
    assert.ok(payload.watch_next_session.length >= 1);
    assert.match(payload.prose_summary, /deterministic session wrap/i);
  });

  test("Codex wrap validation rejects packet/surface override fields", () => {
    const result = validateCodexWrapAnalysis({
      schema_version: 1,
      commentary: "Session was constructive but this tries to override state.",
      risk_challenges: [],
      missed_perspectives: [],
      confidence_note: "commentary only",
      session: "ny-pm",
      bias_picture: "override",
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /forbidden key session/);
    assert.match(result.errors.join("\n"), /forbidden key bias_picture/);
  });

  test("Codex wrap commentary merges without changing deterministic payload fields", () => {
    const payload = buildDirectSessionWrapPayload({ session: "ny-am", memoryText });
    const merged = applyCodexWrapAnalysisToPayload(payload, {
      schema_version: 1,
      commentary: "Codex notes that the setup hit TP1 but next-session draw remains unresolved.",
      risk_challenges: ["Do not over-credit one TP1 as full trend proof"],
      missed_perspectives: ["Check whether EQH was fully taken"],
      confidence_note: "Commentary only; JS owns summary payload.",
    });

    assert.equal(merged.session, payload.session);
    assert.equal(merged.bias_picture, payload.bias_picture);
    assert.match(merged.prose_summary, /Codex wrap check:/);
    assert.equal(merged.codex_analysis.authority, "commentary_only_js_surface_owner");
  });

  test("runDirectSessionWrap surfaces exactly one JS-owned session summary and fails open on invalid Codex", async () => {
    const events = [];
    const surfaced = [];
    const result = await runDirectSessionWrap("ny-am", {
      readMemoryFn: async () => memoryText,
      codexAnalysisFn: async () => ({ ok: false, errors: ["forbidden key session"] }),
      surfaceFn: async (payload) => { surfaced.push(payload); return { ok: true }; },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.ok, true);
    assert.equal(surfaced.length, 1);
    assert.equal(surfaced[0].codex_analysis, undefined);
    assert.equal(events.some((event) => event.type === "codex_analysis" && event.status === "rejected"), true);
    assert.equal(events.filter((event) => event.type === "tool_call" && event.name === "direct_surface_session_summary").length, 1);
  });

  test("session-wrap registers a directRunFn so Codex scheduled wrap does not use text-only tool path", () => {
    assert.equal(typeof directRunFnForTests, "function");
  });
});

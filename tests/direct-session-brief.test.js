import test from "node:test";
import assert from "node:assert/strict";
import { buildDirectSessionBriefPayloads, runDirectSessionBrief } from "../app/main/direct-session-brief.js";

function digestSymbol() {
  return {
    htf: {
      daily: { change_pct: "0.20%", top_fvgs: [], top_bprs: [], recent_structures: [] },
      h4: {
        change_pct: "0.40%",
        top_fvgs: [{ dir: "bull", top: 30000, bottom: 29950, ce: 29975, disp_score: 0.8, took_liq: true, state: "fresh", cite: "engine_by_tf.h4.fvgs[0]" }],
        top_bprs: [],
        recent_structures: [],
      },
      h1: { change_pct: "0.12%", top_fvgs: [], top_bprs: [], recent_structures: [] },
    },
    pillar1: {
      session_levels: {
        PDH: { price: 29920, state: "untaken", swept: false },
        PDL: { price: 29780, state: "taken", swept: true },
      },
      untaken_pools_above: [{ name: "EQH", price: 30050, cite: "brief_digest.symbols.MNQ1!.pillar1.untaken_pools_above[0]" }],
      untaken_pools_below: [],
    },
    pillar2: {
      current_tf: { range_quality: "good", displacement: "clean", candle: "normal" },
      m5: { range_quality: "good", displacement: "clean", candle: "normal" },
      m15: { range_quality: "good", displacement: "acceptable", candle: "normal" },
    },
  };
}

function bundle() {
  return {
    brief_digest: {
      symbols: {
        "MNQ1!": digestSymbol(),
        "MES1!": digestSymbol(),
      },
      leader_evidence: { reason: "primary_higher_disp_score" },
    },
  };
}

test("buildDirectSessionBriefPayloads emits two valid surface_session_brief payloads from digest without LLM tool calls", () => {
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: bundle(), sizingByGrade: { B: { r_size: 0.75 } } });
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.session, "ny-am");
    assert.match(payload.symbol, /^(MNQ1!|MES1!)$/);
    assert.equal(payload.pillar_grade, "B");
    assert.equal(payload.primary_draw.cite, "engine_by_tf.h4.fvgs[0]");
    assert.equal(payload.pillar2_verdict, "good");
    assert.ok(payload.sizing_note.includes("0.75 R"));
    assert.ok(payload.chain_status.includes("direct-codex-compatible"));
  }
});

test("runDirectSessionBrief surfaces direct payloads and emits tool-call events postValidate accepts", async () => {
  const events = [];
  const surfaced = [];
  const result = await runDirectSessionBrief({
    session: "ny-am",
    sizingByGrade: { B: { r_size: 0.75 } },
    analyzeFn: async () => bundle(),
    surfaceFn: async (payload) => { surfaced.push(payload); return { ok: true }; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(surfaced.length, 2);
  assert.equal(events.filter((e) => e.type === "tool_call" && e.name.includes("surface_session_brief")).length, 2);
});

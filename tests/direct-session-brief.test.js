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
    assert.match(payload.brief, /D:BULL \/ 4H:BULL \/ 1H:BULL/);
    assert.match(payload.brief, /Primary draw h4 bull FVG 29950-30000/);
    assert.match(payload.brief, /Target EQH 30050/);
    assert.match(payload.brief, /Price quality good/);
    assert.doesNotMatch(payload.brief, /Direct Codex-compatible brief|no MCP tool-call loop|latest paired TradingView capture/);
    assert.doesNotMatch(payload.prose_summary, /Direct Codex-compatible brief|mechanical prep context|MCP tool-calling model/);
  }
});

test("runDirectSessionBrief surfaces direct payloads and emits tool-call events postValidate accepts", async () => {
  const events = [];
  const surfaced = [];
  const result = await runDirectSessionBrief({
    session: "ny-am",
    sizingByGrade: { B: { r_size: 0.75 } },
    analyzeFn: async () => bundle(),
    codexAnalysisFn: null,
    surfaceFn: async (payload) => { surfaced.push(payload); return { ok: true }; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(surfaced.length, 2);
  assert.equal(events.filter((e) => e.type === "tool_call" && e.name.includes("surface_session_brief")).length, 2);
});

test("runDirectSessionBrief lets Codex analyze pulled digest as commentary but JS still owns surface payloads", async () => {
  const events = [];
  const surfaced = [];
  const result = await runDirectSessionBrief({
    session: "ny-am",
    sizingByGrade: { B: { r_size: 0.75 } },
    analyzeFn: async () => bundle(),
    codexAnalysisFn: async ({ deterministicPayloads }) => ({
      ok: true,
      analysis: {
        schema_version: 1,
        analyses: deterministicPayloads.map((payload) => ({
          symbol: payload.symbol,
          commentary: `${payload.symbol} Codex commentary is limited to a challenge of the deterministic digest.`,
          risk_challenges: ["Pillar 3 confirmation is still pending"],
          missed_perspectives: ["Check freshness before live handoff"],
          confidence_note: "Commentary only; deterministic JS owns packet fields.",
        })),
      },
    }),
    surfaceFn: async (payload) => { surfaced.push(payload); return { ok: true }; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(surfaced.length, 2);
  assert.match(surfaced[0].prose_summary, /Codex check:/);
  assert.equal(surfaced[0].codex_analysis.risk_challenges[0], "Pillar 3 confirmation is still pending");
  assert.equal(surfaced[0].pillar_grade, "B");
  assert.equal(events.some((e) => e.type === "codex_analysis" && e.status === "applied"), true);
});

test("runDirectSessionBrief fails open when Codex analysis is invalid so fake overrides cannot block deterministic surfacing", async () => {
  const events = [];
  const surfaced = [];
  const result = await runDirectSessionBrief({
    session: "ny-am",
    sizingByGrade: { B: { r_size: 0.75 } },
    analyzeFn: async () => bundle(),
    codexAnalysisFn: async () => ({ ok: false, errors: ["forbidden key entry"] }),
    surfaceFn: async (payload) => { surfaced.push(payload); return { ok: true }; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(surfaced.length, 2);
  assert.equal(surfaced[0].codex_analysis, undefined);
  assert.equal(events.some((e) => e.type === "codex_analysis" && e.status === "rejected"), true);
});

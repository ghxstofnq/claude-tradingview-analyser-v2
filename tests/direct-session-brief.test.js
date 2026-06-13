import test from "node:test";
import assert from "node:assert/strict";
import { buildDirectSessionBriefPayloads, runDirectSessionBrief, codexBriefAnalysisEnabled, deriveHtfBiasDir } from "../app/main/direct-session-brief.js";

// §2.1 supply-rejection (2026-06-13): a fresh, liquidity-taking bear PD array
// ABOVE price is supply price rallies into and rejects → bearish, outranking a
// rejected-low sweep that would otherwise read bullish. (June 5: the day fell
// -381 under exactly this overhead 4H bear FVG.)
test("deriveHtfBiasDir: fresh took-liq bear zone above price → bearish (§2.1 supply rejection)", () => {
  const draw = { dir: "bear", position: "above_price", state: "fresh", took_liq: true };
  assert.equal(deriveHtfBiasDir({ draw, sweeps: [{ target: "LO.L", rejected: true, swept_ms: 1 }] }), "bearish");
});

test("deriveHtfBiasDir: a NON-fresh or non-liquidity bear zone above does NOT trigger the supply rule", () => {
  assert.equal(deriveHtfBiasDir({ draw: { dir: "bear", position: "above_price", state: "mitigated", took_liq: true }, sweeps: [{ target: "LO.L", rejected: true, swept_ms: 1 }] }), "bullish");
  assert.equal(deriveHtfBiasDir({ draw: { dir: "bear", position: "above_price", state: "fresh", took_liq: false }, sweeps: [] }), "bullish");
});

test("deriveHtfBiasDir: the zone's own observed reaction still outranks the supply rule", () => {
  assert.equal(deriveHtfBiasDir({ draw: { dir: "bear", position: "above_price", state: "fresh", took_liq: true, reacted: true, reaction_dir: "bull" } }), "bullish");
});

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

// ---- grade matrix: data_gap vs htf_unclear vs constraint-#9 B (2026-06-11) ----

function digestSymbolWith({ drawTf = "h4", draw = true, p2 = "good", dataStatus = {} } = {}) {
  const ds = digestSymbol();
  for (const tf of ["daily", "h4", "h1"]) {
    ds.htf[tf].data_status = dataStatus[tf] ?? "fresh";
    ds.htf[tf].top_fvgs = (draw && tf === drawTf)
      ? [{ dir: "bull", top: 30000, bottom: 29950, ce: 29975, disp_score: 0.8, took_liq: true, state: "fresh", cite: `engine_by_tf.${tf}.fvgs[0]` }]
      : [];
  }
  if (p2 === "marginal") {
    ds.pillar2.m15 = { range_quality: "poor", displacement: "weak", candle: "doji_wick" };
  } else if (p2 === "poor") {
    ds.pillar2.m5 = { range_quality: "poor", displacement: "weak", candle: "doji_wick" };
    ds.pillar2.m15 = { range_quality: "poor", displacement: "weak", candle: "doji_wick" };
  }
  return ds;
}

function bundleWith(ds) {
  return { brief_digest: { symbols: { "MNQ1!": ds }, leader_evidence: {} } };
}

function buildOne(ds) {
  return buildDirectSessionBriefPayloads({
    session: "ny-am",
    bundle: bundleWith(ds),
    sizingByGrade: { B: { r_size: 0.75 } },
    symbols: ["MNQ1!"],
  })[0];
}

test("one weak element (p2 marginal, draw pass) grades B per constraint #9, not no-trade", () => {
  const payload = buildOne(digestSymbolWith({ p2: "marginal" }));
  assert.equal(payload.pillar_grade, "B");
  assert.equal(payload.no_trade_reason, undefined);
});

test("no draw because HTF capture is missing grades no-trade with reason data_gap, not htf_unclear", () => {
  const payload = buildOne(digestSymbolWith({ draw: false, dataStatus: { h4: "missing", h1: "missing" } }));
  assert.equal(payload.pillar_grade, "no-trade");
  assert.equal(payload.no_trade_reason, "data_gap");
  assert.equal(payload.chain_status, "degraded:data_gap");
});

test("no draw on a healthy capture stays no-trade htf_unclear (real market verdict)", () => {
  const payload = buildOne(digestSymbolWith({ draw: false }));
  assert.equal(payload.pillar_grade, "no-trade");
  assert.equal(payload.no_trade_reason, "htf_unclear");
});

test("pillar2 poor still grades no-trade pillar2_poor when a draw exists", () => {
  const payload = buildOne(digestSymbolWith({ p2: "poor" }));
  assert.equal(payload.pillar_grade, "no-trade");
  assert.equal(payload.no_trade_reason, "pillar2_poor");
});

test("2026-06-10 regression: daily draw + missing h4/h1 + marginal p2 grades B with degraded:htf_partial", () => {
  const payload = buildOne(digestSymbolWith({ drawTf: "daily", p2: "marginal", dataStatus: { h4: "missing", h1: "missing" } }));
  assert.equal(payload.pillar_grade, "B");
  assert.equal(payload.no_trade_reason, undefined);
  assert.equal(payload.chain_status, "degraded:htf_partial");
});

test("fallback-sourced HTF marks the chain degraded:htf_fallback instead of clean", () => {
  const payload = buildOne(digestSymbolWith({ dataStatus: { h4: "fallback" } }));
  assert.equal(payload.pillar_grade, "B");
  assert.equal(payload.chain_status, "degraded:htf_fallback");
});

test("htf_quality reads the digest's real h4/h1 engine quality rows, not pillar2 m5/m15", () => {
  const ds = digestSymbolWith({});
  ds.htf.h4.quality = { range_quality: "good", displacement: "clean", candle: "normal" };
  ds.htf.h1.quality = { range_quality: "tight", displacement: "acceptable", candle: "doji_wick" };
  ds.pillar2.m5 = { range_quality: "poor", displacement: "weak", candle: "doji_wick" };
  const payload = buildOne(ds);
  assert.equal(payload.htf_quality.h4.range_quality, "good");
  assert.equal(payload.htf_quality.h4.cite, "brief_digest.symbols.MNQ1!.htf.h4.quality");
  assert.equal(payload.htf_quality.h1.range_quality, "tight");
  assert.equal(payload.htf_quality.h1.cite, "brief_digest.symbols.MNQ1!.htf.h1.quality");
});


test("codexBriefAnalysisEnabled — Codex brief commentary is env opt-in, default off", () => {
  assert.equal(codexBriefAnalysisEnabled({}), false);
  assert.equal(codexBriefAnalysisEnabled({ TV_CODEX_BRIEF_ANALYSIS: "1" }), true);
  assert.equal(codexBriefAnalysisEnabled({ TV_CODEX_BRIEF_ANALYSIS: "0" }), false);
});

test("primary_draw carries reaction + position evidence for bias derivation", () => {
  const b = bundle();
  // zone above price, observed bearish reaction off it
  b.brief_digest.symbols["MNQ1!"].htf.h4.top_fvgs[0] = {
    dir: "bear", top: 30062, bottom: 29942, ce: 30002, disp_score: 0.91,
    took_liq: true, state: "fresh", reacted: true, reaction_dir: "bear",
    cite: "engine_by_tf.h4.fvgs[17]",
  };
  b.quote = { last: 29800 };
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  const draw = payloads[0].primary_draw;
  assert.equal(draw.reacted, true);
  assert.equal(draw.reaction_dir, "bear");
  assert.equal(draw.position, "above_price"); // zone ce 30002 > last 29800
});

test("primary_draw position derives from the paired symbol quote when present", () => {
  const b = bundle();
  b.pair = { symbols: { "MNQ1!": { quote: { last: 30100 } } } };
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(payloads[0].primary_draw.position, "below_price"); // ce 29975 < last 30100
});

// §2.1: "Primary charts: Daily and 4H (sometimes 1H)" — when 4H has no
// usable zone, DAILY outranks 1H. (Audit 2026-06-12: the picker searched
// h4 → h1 → daily, putting 1H above Daily, backwards from the doc.)
test("primary draw prefers daily over h1 when h4 is empty", () => {
  const b = bundle();
  const ds = b.brief_digest.symbols["MNQ1!"];
  ds.htf.h4.top_fvgs = [];
  ds.htf.h1.top_fvgs = [{ dir: "bull", top: 29500, bottom: 29450, ce: 29475, disp_score: 0.9, took_liq: true, state: "fresh", cite: "engine_by_tf.h1.fvgs[0]" }];
  ds.htf.daily.top_fvgs = [{ dir: "bear", top: 30000, bottom: 29900, ce: 29950, disp_score: 0.7, took_liq: true, state: "fresh", cite: "engine_by_tf.daily.fvgs[0]" }];
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(payloads[0].primary_draw.tf, "daily");
});

// §7 Step 2: "Decide if overnight is: Extending HTF move, or Consolidating"
// — the verdict must be computed from sweep evidence, not hardcoded.
test("overnight_verdict computes extending/retracing/consolidating from sweeps", () => {
  const b = bundle();
  const ds = b.brief_digest.symbols["MNQ1!"];
  // bearish draw + overnight swept a LOW without rejection → extending
  ds.htf.h4.top_fvgs = [{ dir: "bear", top: 30000, bottom: 29950, ce: 29975, disp_score: 0.9, took_liq: true, state: "fresh", cite: "engine_by_tf.h4.fvgs[0]" }];
  ds.pillar1.sweeps = [{ target: "PWL", price: 29300, side: "sell", swept_ms: 1, rejected: false }];
  let p = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(p[0].overnight_block.overnight_verdict, "extending_htf");
  // overnight swept a HIGH (against the bearish draw) without rejection → retracing
  ds.pillar1.sweeps = [{ target: "PDH", price: 30100, side: "buy", swept_ms: 1, rejected: false }];
  p = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(p[0].overnight_block.overnight_verdict, "retracing_htf");
  // no sweeps → consolidating
  ds.pillar1.sweeps = [];
  p = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(p[0].overnight_block.overnight_verdict, "consolidating");
});

// Doc correction (user Q2): §2.1 step 3 — bias comes from REACTIONS.
// The payload carries htf_bias derived as: zone's own reaction → latest
// REJECTED HTF-level sweep → magnet/destination (§2.3) → zone dir.
// June 9: the pre-open sharp rejection at PDH (engine: swept 09:05,
// rejected) set the bearish day despite the unreacted bear zone overhead.
test("payload htf_bias: a rejected high-sweep sets bearish despite an unreacted zone above", () => {
  const b = bundle();
  const ds = b.brief_digest.symbols["MNQ1!"];
  ds.htf.h4.top_fvgs = [{ dir: "bear", top: 30062, bottom: 29942, ce: 30002, disp_score: 0.91, took_liq: true, state: "fresh", reacted: false, cite: "engine_by_tf.h4.fvgs[17]" }];
  ds.pillar1.sweeps = [{ target: "PDH", price: 29850, side: "buy", swept_ms: 100, rejected: true }];
  b.quote = { last: 29800 };
  const p = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(p[0].htf_bias_dir, "bearish");
});

test("payload htf_bias: a fresh took-liq bear zone above price is SUPPLY → bearish (§2.1 supply rejection; corrected 2026-06-13)", () => {
  // Previously this read bullish ("unreacted zone above is a bullish magnet").
  // §2.1 corrects it: a fresh, liquidity-taking 4H bear FVG above price is
  // supply — price rallies INTO it and rejects sharply → bearish toward the
  // sell-side below. This is the June 5 case (the day fell -381 under exactly
  // this overhead zone). Refold-verified frozen-safe (June 10 trades identical).
  const b = bundle();
  const ds = b.brief_digest.symbols["MNQ1!"];
  ds.htf.h4.top_fvgs = [{ dir: "bear", top: 30062, bottom: 29942, ce: 30002, disp_score: 0.91, took_liq: true, state: "fresh", reacted: false, cite: "engine_by_tf.h4.fvgs[17]" }];
  ds.pillar1.sweeps = [];
  b.quote = { last: 29800 };
  const p = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(p[0].htf_bias_dir, "bearish");
});

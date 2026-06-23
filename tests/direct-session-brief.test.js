import test from "node:test";
import assert from "node:assert/strict";
import { buildDirectSessionBriefPayloads, runDirectSessionBrief, codexBriefAnalysisEnabled, deriveHtfBiasDir, htfTrendDir } from "../app/main/direct-session-brief.js";
import { buildBriefDigest } from "../cli/lib/brief-digest.js";

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

// §2.4 HTF trend (2026-06-14): with no zone reaction or §2.1 supply rule, the
// recent h4/daily structure direction outranks the rejected-sweep heuristic and
// the position magnet — the May 13/14 bug, where a fresh bull FVG below price
// plus a swept high both read bearish on a clean uptrend (h4 BoS bull, new highs).
test("deriveHtfBiasDir: HTF structure trend outranks the rejected-sweep heuristic", () => {
  const draw = { dir: "bull", position: "below_price", state: "fresh", took_liq: true };
  assert.equal(deriveHtfBiasDir({ draw, sweeps: [{ target: "PDH", rejected: true, swept_ms: 1 }], htfTrend: "bullish" }), "bullish");
});

test("deriveHtfBiasDir: the §2.1 supply rule still outranks the HTF trend", () => {
  const draw = { dir: "bear", position: "above_price", state: "fresh", took_liq: true };
  assert.equal(deriveHtfBiasDir({ draw, htfTrend: "bullish" }), "bearish");
});

test("deriveHtfBiasDir: falls back to the position magnet when no htfTrend", () => {
  assert.equal(deriveHtfBiasDir({ draw: { dir: "bull", position: "below_price", state: "fresh", took_liq: true } }), "bearish");
});

test("htfTrendDir: most recent non-reclaimed h4 structure, else daily, else null", () => {
  assert.equal(htfTrendDir({ htf: { h4: { recent_structures: [{ event: "bos", dir: "bull", is_reclaimed: false }] } } }), "bullish");
  assert.equal(htfTrendDir({ htf: {
    h4: { recent_structures: [{ event: "bos", dir: "bull", is_reclaimed: true }] },
    daily: { recent_structures: [{ event: "mss", dir: "bear", is_reclaimed: false }] },
  } }), "bearish");
  assert.equal(htfTrendDir({ htf: {} }), null);
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
      // Engine-partitioned untaken session draws (by side of price, nearest
      // first) — the digest forwards these so the brief's overnight_block reads
      // them instead of slicing levels by array position (2026-06-14 fix).
      untaken_buy_side_above: [{ name: "PDH", price: 29920 }],
      untaken_sell_side_below: [{ name: "LO.L", price: 29700 }, { name: "AS.L", price: 29500 }],
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

test("pillar2 grades on 5m/15m only — a current_tf doji must NOT tip a clean session to poor", () => {
  // 2026-06-18 London MNQ: current_tf candle doji_wick (the chart's current-TF
  // gauge — §7 Step 3 grades 5m/15m, not current_tf), 5m normal, 15m doji_wick.
  // Counting current_tf gave 2 bad → "poor" → no-trade and locked the leader out
  // of London. Excluding it: 1 bad (15m) → "marginal" → tradeable.
  const b = bundle();
  b.brief_digest.symbols["MNQ1!"].pillar2 = {
    current_tf: { range_quality: "good", displacement: "acceptable", candle: "doji_wick" },
    m5: { range_quality: "good", displacement: "acceptable", candle: "normal" },
    m15: { range_quality: "good", displacement: "clean", candle: "doji_wick" },
  };
  const [mnq] = buildDirectSessionBriefPayloads({ session: "london", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(mnq.pillar2_verdict, "marginal");
  assert.notEqual(mnq.pillar_grade, "no-trade");
});

test("pillar2 still fails when BOTH authoritative TFs (5m + 15m) are doji-dominated", () => {
  const b = bundle();
  b.brief_digest.symbols["MNQ1!"].pillar2 = {
    current_tf: { range_quality: "good", displacement: "clean", candle: "normal" },
    m5: { range_quality: "good", displacement: "acceptable", candle: "doji_wick" },
    m15: { range_quality: "good", displacement: "acceptable", candle: "doji_wick" },
  };
  const [mnq] = buildDirectSessionBriefPayloads({ session: "london", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(mnq.pillar2_verdict, "poor");
  assert.equal(mnq.pillar_grade, "no-trade");
});

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

// §7 Step 3 anatomy must be visible in PREP: the Price-Action-Quality pillar
// exposes per-TF elements (range / h4 / m5) and the LTF row carries BOTH 5m and
// 15m so the trader sees the actual candle anatomy, not just the verdict.
test("pillar2 elements expose 5m + 15m anatomy and h4 + h1 displacement", () => {
  const [mnq] = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: bundle(), symbols: ["MNQ1!"] });
  const p2 = mnq.pillars.find((p) => /price.*action|quality/i.test(p.name));
  const ltf = p2.elements.find((e) => /^m5\b/i.test(e.name));
  assert.ok(ltf, "expected an m5 anatomy element for the 15m/5m PREP row");
  assert.match(ltf.detail, /5m .*·.*15m /); // both timeframes rendered
  const htf = p2.elements.find((e) => /^h4\b/i.test(e.name));
  assert.ok(htf, "expected an h4 element for the 4H/1H PREP row");
  assert.match(htf.detail, /4H .*·.*1H /);
  const range = p2.elements.find((e) => /range/i.test(e.name));
  assert.ok(range, "expected a 3h range element");
});

// 2026-06-14 fix: overnight_block must split untaken draws by SIDE OF PRICE,
// not by array position. The old positional slice(-3) put above-price highs
// into untaken_below, so sell-side session lows (LO.L, AS.L) never reached the
// TP1 pool and a short reached past the London low to a deeper swing.
test("overnight_block.untaken_below carries the sell-side session lows (not above-price highs)", () => {
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: bundle(), symbols: ["MNQ1!"] });
  const ob = payloads[0].overnight_block;
  // Below = sell-side lows, nearest (highest price) first.
  assert.deepEqual(ob.untaken_below.map((l) => l.name), ["LO.L", "AS.L"]);
  assert.equal(ob.untaken_below[0].price, 29700);
  // Each below-target cites a real session_levels accessor (constraint #6).
  assert.equal(ob.untaken_below[0].cite, "brief_digest.symbols.MNQ1!.pillar1.session_levels.LO_L.price");
  // No above-price level leaks into the below list.
  assert.ok(ob.untaken_below.every((l) => l.price < 29920));
  // Above = buy-side highs + above pools, nearest (lowest price) first.
  assert.deepEqual(ob.untaken_above.map((l) => l.name), ["PDH", "EQH"]);
  assert.ok(ob.untaken_above.every((l) => l.price >= 29920));
});

// 2026-06-16 refold-path wiring: persistent session-history draws (old session
// highs/lows the engine overwrites) must flow through buildDirectSessionBriefPayloads
// whenever the brief bundle carries 1H history — so a fold-week/regen recomputes
// the same draws the live record captured (without this, a refold loses the
// June-4 PM high 30896 that a runner TP2 targets). No 1H history → no extra draws.
test("session-history draws merge into overnight_block when bundle.h1_history is present", () => {
  const h1bar = (iso, high, low) => ({ time: Math.floor(Date.parse(iso) / 1000), high, low });
  const b = bundle();
  // June 4 NY-PM (13:00–16:00 ET = 17:00–20:00 UTC) prints a 30896 high; price
  // never trades above it through asOf → it stays an untaken upside draw.
  b.h1_history = [
    h1bar("2026-06-04T17:00:00Z", 30850, 30800),
    h1bar("2026-06-04T18:00:00Z", 30896, 30840),
    h1bar("2026-06-04T19:00:00Z", 30870, 30830),
    h1bar("2026-06-05T18:00:00Z", 30720, 30680),
  ];
  b.quote = { last: 30600, time: Math.floor(Date.parse("2026-06-08T18:00:00Z") / 1000) };
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  const above = payloads[0].overnight_block.untaken_above;
  const draw = above.find((x) => x.price === 30896);
  assert.ok(draw, "June 4 PM high 30896 should surface as an untaken upside draw");
  assert.equal(draw.name, "NYPM.H");
  assert.equal(draw.source, "session_draw");
});

test("no session-history draws merge when bundle.h1_history is absent", () => {
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: bundle(), symbols: ["MNQ1!"] });
  const above = payloads[0].overnight_block.untaken_above;
  assert.ok(above.every((x) => x.source !== "session_draw"), "no session_draw rows without h1_history");
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


// 2026-06-15 regression: the failed brief refresh. After the leader decision,
// `tv analyze --pair` short-circuits to a leader-only bundle (no `pair` block).
// buildBriefDigest must still produce brief_digest.symbols from the top-level
// bundle so the direct brief rebuilds instead of throwing
// "requires bundle.brief_digest.symbols".
test("single-symbol leader capture rebuilds the brief end-to-end (short-circuit refresh fix)", () => {
  const single = {
    chart: { symbol: "CME_MINI:MNQ1!" },
    quote: { last: 29900 },
    bars_by_tf: { daily: {}, h4: {}, h1: {} },
    engine_by_tf: {
      daily: { fvgs: [], bprs: [], structures: [], quality: null },
      h4: {
        fvgs: [{ dir: "bull", top: 30000, bottom: 29950, ce: 29975, disp_score: 0.8, took_liq: true, state: "fresh", size_quality: "normal", reacted: false, reaction_dir: "none" }],
        bprs: [], structures: [],
        quality: { range_quality: "good", displacement: "clean", candle: "normal" },
      },
      h1: { fvgs: [], bprs: [], structures: [], quality: null },
    },
    gates: {
      engine: {
        pillar1: {
          session_levels: { PDH: { name: "PDH", price: 30100, state: "untaken", swept: false } },
          untaken_buy_side_above: [{ name: "PDH", price: 30100 }],
          untaken_sell_side_below: [], untaken_pools_above: [], untaken_pools_below: [], sweeps: [],
        },
        pillar2: {
          current_tf: { range_quality: "good", displacement: "clean", candle: "normal" },
          m5: { range_quality: "good", displacement: "clean", candle: "normal" },
          m15: { range_quality: "good", displacement: "acceptable", candle: "normal" },
        },
        price_context: {},
      },
    },
  };
  const digest = buildBriefDigest(single);
  assert.ok(digest?.symbols?.["MNQ1!"], "single-symbol capture must yield brief_digest.symbols.MNQ1!");
  // tv analyze prepends the digest the same way (analyze.js).
  const bundleSingle = { brief_digest: digest, ...single };
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: bundleSingle, sizingByGrade: { B: { r_size: 0.75 } } });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].symbol, "MNQ1!");
  assert.equal(payloads[0].pillar_grade, "B");
  assert.equal(payloads[0].primary_draw.dir, "bull");
  assert.ok(payloads[0].chain_status.includes("direct-codex-compatible"));
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
  b.quote = { last: 29950 }; // zone ce ~30002 is then ~0.17% away = near (0.3% gate)
  const payloads = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  const draw = payloads[0].primary_draw;
  assert.equal(draw.reacted, true);
  assert.equal(draw.reaction_dir, "bear");
  assert.equal(draw.position, "above_price"); // zone ce 30002 > last 29800
});

test("primary_draw position derives from the paired symbol quote when present", () => {
  const b = bundle();
  b.pair = { symbols: { "MNQ1!": { quote: { last: 30050 } } } };
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

// Stage C (2026-06-23): htf_bias_dir now comes from the ARRAY-STATE vote (the
// reaction off the significant near-price PD array — fresh bear = supply,
// inverted = flipped), NOT the old rejected-sweep / §2.1-supply heuristics. A
// fresh near-price bear FVG votes bearish on its own; the sweep no longer sets
// direction. (Open calibration: the near-price gate is 0.3%; a 4H supply zone
// ~0.5-0.7% above — the June-5 case — is now too far to be the pre-open draw.
// Revisit the HTF near-threshold against the Discord calls.)
test("payload htf_bias: a fresh near-price bear FVG votes bearish (array-state vote)", () => {
  const b = bundle();
  const ds = b.brief_digest.symbols["MNQ1!"];
  ds.htf.h4.top_fvgs = [{ dir: "bear", top: 30062, bottom: 29942, ce: 30002, disp_score: 0.91, took_liq: true, state: "fresh", reacted: false, cite: "engine_by_tf.h4.fvgs[17]" }];
  ds.pillar1.sweeps = [{ target: "PDH", price: 29850, side: "buy", swept_ms: 100, rejected: true }];
  b.quote = { last: 29950 }; // zone ce ~30002 is then ~0.17% away = near (0.3% gate)
  const p = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(p[0].htf_bias_dir, "bearish");
});

test("payload htf_bias: a fresh took-liq bear zone (supply) near price votes bearish", () => {
  const b = bundle();
  const ds = b.brief_digest.symbols["MNQ1!"];
  ds.htf.h4.top_fvgs = [{ dir: "bear", top: 30062, bottom: 29942, ce: 30002, disp_score: 0.91, took_liq: true, state: "fresh", reacted: false, cite: "engine_by_tf.h4.fvgs[17]" }];
  ds.pillar1.sweeps = [];
  b.quote = { last: 29950 }; // zone ce ~30002 is then ~0.17% away = near (0.3% gate)
  const p = buildDirectSessionBriefPayloads({ session: "ny-am", bundle: b, symbols: ["MNQ1!"] });
  assert.equal(p[0].htf_bias_dir, "bearish");
});

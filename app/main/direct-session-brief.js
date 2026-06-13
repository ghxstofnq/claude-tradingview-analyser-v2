import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PAIR_DEFAULT, PAIR_PRIMARY, PAIR_SECONDARY } from "./config.js";
import { surfaceSessionBrief } from "./tools/surface.js";
import { applyCodexAnalysisToBriefPayloads, runCodexStructuredAnalysis } from "./codex-structured-analysis.js";
import { biasFromDraw } from "./backtest-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const LAST_ANALYZE_PATH = path.join(REPO_ROOT, "state", "last-analyze.json");

function cite(prefix, pathPart) {
  return `${prefix}.${pathPart}`;
}

function firstNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeBiasFromChange(changePct) {
  const numeric = Number(String(changePct ?? "").replace("%", ""));
  if (!Number.isFinite(numeric)) return "NEUTRAL";
  if (numeric > 0.05) return "BULLISH";
  if (numeric < -0.05) return "BEARISH";
  return "NEUTRAL";
}

function formatPrice(value) {
  return Number.isFinite(value) ? String(value) : "0";
}

function compactBias(label) {
  if (/^bull/i.test(label || "")) return "BULL";
  if (/^bear/i.test(label || "")) return "BEAR";
  if (/^neutral/i.test(label || "")) return "NEUTRAL";
  return String(label || "—").toUpperCase();
}

function htfBiasLine(rows) {
  const byTf = new Map(rows.map((row) => [row.tf, compactBias(row.bias)]));
  return `D:${byTf.get("DAILY") || "—"} / 4H:${byTf.get("4H") || "—"} / 1H:${byTf.get("1H") || "—"}`;
}

function drawLine(draw) {
  if (!draw) return "Primary draw unavailable";
  return `Primary draw ${draw.tf} ${draw.dir} ${draw.kind.toUpperCase()} ${formatPrice(draw.bottom)}-${formatPrice(draw.top)} CE ${formatPrice(draw.ce)}`;
}

function buildDeterministicBriefText({ session, symbol, htf, draw, targetLevel, stopLevel, p2, pillarGrade }) {
  const sessionLabel = String(session || "session").toUpperCase();
  return `${symbol} ${sessionLabel} prep: ${htfBiasLine(htf)}. ${drawLine(draw)}. Target ${targetLevel.name} ${formatPrice(targetLevel.price)}; stop reference ${stopLevel.name} ${formatPrice(stopLevel.price)}. Price quality ${p2.verdict}; grade ${pillarGrade}. Wait for deterministic Pillar 3 confirmation before any entry.`;
}

function buildDeterministicProseSummary({ symbol, htf, draw, targetLevel, p2, pillarGrade }) {
  const drawText = draw ? `${draw.tf} ${draw.dir} ${draw.kind.toUpperCase()} at ${formatPrice(draw.bottom)}-${formatPrice(draw.top)}` : "no clean primary draw";
  return `${symbol}: ${htfBiasLine(htf)} with ${drawText}. Price quality is ${p2.verdict}, so pre-session grade is ${pillarGrade}. Main liquidity reference is ${targetLevel.name} ${formatPrice(targetLevel.price)}; no live trade is valid until the MSS/Trend/Inversion walker prints a confirmed execution packet.`;
}

function levelRows(symbol, digestSymbol) {
  const levels = digestSymbol?.pillar1?.session_levels ?? {};
  const rows = [];
  for (const [name, level] of Object.entries(levels)) {
    const price = firstNumber(level?.price, level?.high, level?.low, level?.value);
    if (!Number.isFinite(price)) continue;
    const state = level?.swept || level?.taken || level?.state === "taken" ? "taken" : "untaken";
    rows.push({
      name,
      price,
      state,
      cite: cite(`brief_digest.symbols.${symbol}.pillar1.session_levels.${name}`, "price"),
    });
  }
  for (const pool of digestSymbol?.pillar1?.untaken_pools_above ?? []) {
    const price = firstNumber(pool?.price, pool?.value, pool?.high, pool?.low);
    if (Number.isFinite(price)) rows.push({ name: pool?.name || "untaken_above", price, state: "untaken", cite: pool?.cite || `brief_digest.symbols.${symbol}.pillar1.untaken_pools_above` });
  }
  for (const pool of digestSymbol?.pillar1?.untaken_pools_below ?? []) {
    const price = firstNumber(pool?.price, pool?.value, pool?.high, pool?.low);
    if (Number.isFinite(price)) rows.push({ name: pool?.name || "untaken_below", price, state: "untaken", cite: pool?.cite || `brief_digest.symbols.${symbol}.pillar1.untaken_pools_below` });
  }
  return rows.sort((a, b) => b.price - a.price).slice(0, 8);
}

function htfBiasRows(symbol, digestSymbol) {
  const tfMap = [
    ["DAILY", "daily"],
    ["4H", "h4"],
    ["1H", "h1"],
  ];
  return tfMap.map(([label, key]) => {
    const block = digestSymbol?.htf?.[key] ?? {};
    const bias = normalizeBiasFromChange(block.change_pct);
    const citePath = `brief_digest.symbols.${symbol}.htf.${key}.change_pct`;
    return {
      tf: label,
      bias,
      note: `${label} momentum ${block.change_pct ?? "unknown"} (${citePath})`,
    };
  });
}

function pillar2Status(digestSymbol) {
  const p2 = digestSymbol?.pillar2 ?? {};
  const checks = [p2.current_tf, p2.m5, p2.m15].filter(Boolean);
  const bad = checks.filter((check) => /poor|chop|doji/i.test(`${check.range_quality ?? ""} ${check.displacement ?? ""} ${check.candle ?? ""}`)).length;
  if (!checks.length) return { verdict: "poor", status: "fail" };
  if (bad >= 2) return { verdict: "poor", status: "fail" };
  if (bad === 1) return { verdict: "marginal", status: "weak" };
  return { verdict: "good", status: "pass" };
}

// HTF quality from the digest's real h4/h1 engine quality rows. The previous
// version cited pillar2.m5/m15 (LTF) under HTF labels — when the capture hole
// nulled h4/h1, the brief showed "na" quality with an HTF cite that pointed at
// the wrong data, feeding the htf_unclear misdiagnosis.
function htfQualityRow(symbol, digestSymbol, tf) {
  const q = digestSymbol?.htf?.[tf]?.quality;
  return {
    range_quality: q?.range_quality ?? "unknown",
    displacement: q?.displacement ?? "unknown",
    candle: q?.candle ?? "unknown",
    cite: `brief_digest.symbols.${symbol}.htf.${tf}.quality`,
  };
}

function pickPrimaryDraw(digestSymbol, { price = null } = {}) {
  // §2.1: "Primary charts: Daily and 4H (sometimes 1H)" + "prefers 4H PD
  // arrays when possible" — so 4H first, then DAILY, then 1H. (The previous
  // h4→h1→daily order put 1H above Daily, backwards from the doc.)
  for (const tf of ["h4", "daily", "h1"]) {
    const block = digestSymbol?.htf?.[tf] ?? {};
    const candidates = [...(block.top_fvgs ?? []), ...(block.top_bprs ?? [])];
    const found = candidates.find((row) => Number.isFinite(row?.top) && Number.isFinite(row?.bottom) && row?.cite);
    if (found) {
      const kind = /bprs/.test(found.cite) ? "bpr" : "fvg";
      const dir = /bear/i.test(found.direction ?? found.dir ?? "") ? "bear" : "bull";
      const ce = Number.isFinite(found.ce) ? found.ce : (found.top + found.bottom) / 2;
      return {
        tf,
        kind,
        dir,
        top: found.top,
        bottom: found.bottom,
        ce,
        disp_score: Number.isFinite(found.disp_score) ? found.disp_score : 0,
        took_liq: !!found.took_liq,
        state: found.state || "fresh",
        // Reaction + position evidence for downstream bias derivation
        // (strategy §2.1 step 3: reactions off the PD array set bias;
        // §2.3: an unreacted zone is a destination — path toward it).
        reacted: !!found.reacted,
        ...(found.reaction_dir ? { reaction_dir: found.reaction_dir } : {}),
        ...(Number.isFinite(price) ? { position: ce > price ? "above_price" : "below_price" } : {}),
        cite: found.cite,
      };
    }
  }
  return null;
}

// §7 Step 2 / §2.2: decide whether overnight is extending the HTF move or
// consolidating — computed from sweep evidence, never hardcoded. The most
// recent sweep's resulting direction (a rejection flips the break, mirroring
// the open-reaction resolver) is compared to the HTF draw direction: with
// the draw → extending_htf; against → retracing_htf; no sweeps in the table
// (or no derivable bias) → consolidating.
function computeOvernightVerdict({ sweeps = [], htfBias = null } = {}) {
  if (!htfBias || !sweeps.length) return "consolidating";
  const last = sweeps.reduce((a, b) => ((b?.swept_ms ?? 0) >= (a?.swept_ms ?? 0) ? b : a));
  const high = /H$/.test(String(last?.target ?? ""));
  const rejected = last?.rejected === true;
  const dir = high ? (rejected ? "bearish" : "bullish") : (rejected ? "bullish" : "bearish");
  return dir === htfBias ? "extending_htf" : "retracing_htf";
}

// Doc-corrected HTF bias (user Q2, 2026-06-12; §2.1 supply-rejection 2026-06-13).
// §2.1 step 3: "use reactions off those HTF PD arrays to set bias" — precedence:
//   1. The zone's own observed reaction.
//   2. §2.1 supply/demand rejection: a FRESH, liquidity-taking PD array price
//      has not yet reached is WHERE price reacts. A bear FVG/BPR ABOVE price is
//      4H supply — price rallies INTO it and rejects sharply → bearish toward
//      the lower sell-side (the doc's own "trades into a 4H BPR ... rejects
//      sharply → bearish" example). Longs heading up into that zone are
//      lower-conviction, so the HTF read is bearish, not a clean bullish draw.
//      (June 5: this zone sat overhead and the day fell -381; June 9/10/11 all
//      carried the same overhead supply and traded bearish — refold-verified
//      frozen-safe: June 10 flips divergent→aligned with identical trades.)
//   3. The latest REJECTED level sweep (the pre-open "rejects sharply").
//   4. §2.3 destination magnet: the path toward an unreacted zone.
//   5. Zone direction (no evidence at all).
export function deriveHtfBiasDir({ draw, sweeps = [] } = {}) {
  const asBias = (d) => /^bear/i.test(d || "") ? "bearish" : /^bull/i.test(d || "") ? "bullish" : null;
  if (draw?.reacted && asBias(draw.reaction_dir)) return asBias(draw.reaction_dir);
  if ((draw?.state ?? "fresh") === "fresh" && draw?.took_liq
      && /^bear/i.test(draw?.dir || "") && draw?.position === "above_price") {
    return "bearish";
  }
  const rejected = sweeps.filter((s) => s?.rejected === true);
  if (rejected.length) {
    const last = rejected.reduce((a, b) => ((b?.swept_ms ?? 0) >= (a?.swept_ms ?? 0) ? b : a));
    return /H$/.test(String(last?.target ?? "")) ? "bearish" : "bullish";
  }
  if (draw?.position === "above_price") return "bullish";
  if (draw?.position === "below_price") return "bearish";
  return asBias(draw?.dir);
}

function symbolQuote(bundle, symbol) {
  const paired = bundle?.pair?.symbols?.[symbol]?.quote?.last;
  if (Number.isFinite(paired)) return paired;
  const single = bundle?.quote?.last;
  return Number.isFinite(single) ? single : null;
}

export function buildDirectSessionBriefPayloads({ session, bundle, sizingByGrade = {}, symbols = [PAIR_PRIMARY, PAIR_SECONDARY] } = {}) {
  const digest = bundle?.brief_digest;
  if (!digest?.symbols) throw new Error("direct session brief requires bundle.brief_digest.symbols");
  return symbols.filter((symbol) => digest.symbols[symbol]).map((symbol) => {
    const ds = digest.symbols[symbol];
    const levels = levelRows(symbol, ds);
    const htf = htfBiasRows(symbol, ds);
    const p2 = pillar2Status(ds);
    const draw = pickPrimaryDraw(ds, { price: symbolQuote(bundle, symbol) });
    const drawStatus = draw ? "pass" : "weak";
    // Capture provenance (brief_digest data_status, 2026-06-11): a missing HTF
    // capture is an instrument failure (data_gap), not a market verdict
    // (htf_unclear). 8 of 13 June briefs died as htf_unclear when the H4/H1
    // engine read had simply returned null.
    const HTF_TF_KEYS = ["daily", "h4", "h1"];
    const missingTfs = HTF_TF_KEYS.filter((tf) => ds?.htf?.[tf]?.data_status === "missing");
    const fallbackTfs = HTF_TF_KEYS.filter((tf) => ds?.htf?.[tf]?.data_status === "fallback");
    // Grade per CLAUDE.md constraint #9: one weaker element → B; no-trade only
    // when the draw is absent or price quality fails outright.
    let pillar_grade = "B";
    let no_trade_reason;
    if (!draw && missingTfs.length) { pillar_grade = "no-trade"; no_trade_reason = "data_gap"; }
    else if (p2.status === "fail") { pillar_grade = "no-trade"; no_trade_reason = "pillar2_poor"; }
    else if (!draw) { pillar_grade = "no-trade"; no_trade_reason = "htf_unclear"; }
    const targetLevel = levels.find((l) => l.state === "untaken") ?? levels[0] ?? { name: "reference", price: 0 };
    const stopLevel = [...levels].reverse().find((l) => l.price !== targetLevel.price) ?? targetLevel;
    const sizing = sizingByGrade[pillar_grade] ?? sizingByGrade.B ?? { r_size: pillar_grade === "no-trade" ? 0 : 1, override_reason: null };
    return {
      session,
      symbol,
      brief: buildDeterministicBriefText({ session, symbol, htf, draw, targetLevel, stopLevel, p2, pillarGrade: pillar_grade }),
      prose_summary: buildDeterministicProseSummary({ symbol, htf, draw, targetLevel, p2, pillarGrade: pillar_grade }),
      htf_bias: htf,
      overnight: [
        { k: "session context", v: `Levels and pools read from paired digest for ${symbol} (brief_digest.symbols.${symbol}.pillar1)`, tone: pillar_grade === "no-trade" ? "amber" : "green" },
      ],
      key_levels: levels,
      pillar_grade,
      ...(no_trade_reason ? { no_trade_reason } : {}),
      pillars: [
        { name: "Draw & Bias", status: drawStatus, elements: [{ name: "primary HTF draw", status: drawStatus }] },
        { name: "Price-Action Quality", status: p2.status, elements: [{ name: "range/displacement/chop", status: p2.status }] },
        { name: "Entry Model + Confirmation", status: "pending", elements: [{ name: "wait for Pillar 3 confirmation close", status: "pending" }] },
      ],
      plan: `Use ${symbol} only if live Pillar 3 confirms. Primary target reference: ${targetLevel.name} ${formatPrice(targetLevel.price)}. Stand aside if source health or P1/P2 chain degrades.`,
      scenarios: [{
        id: "scn-1",
        grade: pillar_grade,
        condition: `Live confirms toward ${targetLevel.name} ${formatPrice(targetLevel.price)}`,
        action: `Wait for deterministic MSS/Trend/Inversion confirmation packet; no discretionary entry.`,
        target: `${formatPrice(targetLevel.price)} (${targetLevel.cite || "brief_digest"})`,
      }],
      anchored_target: `${formatPrice(targetLevel.price)} (${targetLevel.cite || "brief_digest"})`,
      anchored_stop: `${formatPrice(stopLevel.price)} (${stopLevel.cite || "brief_digest"})`,
      sizing_note: sizing.override_reason
        ? `${sizing.r_size} R · override: ${sizing.override_reason} (strategy.sizing-table)`
        : `${sizing.r_size} R · direct ${pillar_grade} (strategy.sizing-table)`,
      ...(draw ? { primary_draw: draw, htf_bias_dir: deriveHtfBiasDir({ draw, sweeps: ds?.pillar1?.sweeps ?? [] }) } : {}),
      htf_destination: targetLevel.price >= (levels[Math.floor(levels.length / 2)]?.price ?? targetLevel.price) ? "above nearest untaken liquidity" : "below nearest untaken liquidity",
      overnight_block: {
        untaken_above: levels.filter((l) => l.state === "untaken").slice(0, 3).map((l) => ({ name: l.name, price: l.price, cite: l.cite || "brief_digest" })),
        untaken_below: levels.filter((l) => l.state === "untaken").slice(-3).map((l) => ({ name: l.name, price: l.price, cite: l.cite || "brief_digest" })),
        overnight_verdict: computeOvernightVerdict({
          sweeps: ds?.pillar1?.sweeps ?? [],
          htfBias: biasFromDraw(draw),
        }),
        path_to_destination: targetLevel.name,
      },
      htf_quality: {
        h4: htfQualityRow(symbol, ds, "h4"),
        h1: htfQualityRow(symbol, ds, "h1"),
      },
      pillar2_verdict: p2.verdict,
      chain_status: no_trade_reason ? `degraded:${no_trade_reason}`
        : missingTfs.length ? "degraded:htf_partial"
        : fallbackTfs.length ? "degraded:htf_fallback"
        : "clean:direct-codex-compatible",
    };
  });
}

export async function analyzePairBundle({ out = LAST_ANALYZE_PATH, pair = PAIR_DEFAULT } = {}) {
  // pair=null → single-symbol capture on the chart's current symbol. Used by
  // the backtest anchor brief: symbol switches under active replay reload the
  // whole chart per TF and the second symbol's capture flakes (2026-06-12).
  const args = [
    path.join(REPO_ROOT, "cli", "index.js"), "analyze",
    ...(pair ? ["--pair", pair] : []),
    "--out", out,
  ];
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`direct analyze failed with code ${code}: ${stderr || stdout}`));
      else resolve(stdout);
    });
  });
  let savedTo = out;
  try {
    const parsed = JSON.parse(output);
    savedTo = parsed.saved_to || parsed.savedTo || out;
  } catch { /* keep requested out */ }
  return JSON.parse(await fs.readFile(savedTo, "utf8"));
}

// Codex structured commentary is opt-in (2026-06-12): it spawns the codex
// CLI and a hang there delays brief.json past the scheduler timeout — the
// deterministic payloads are the substance, commentary only decorates.
export function codexBriefAnalysisEnabled(env = process.env) {
  return env.TV_CODEX_BRIEF_ANALYSIS === '1';
}

export async function runDirectSessionBrief({ session, sizingByGrade = {}, analyzeFn = analyzePairBundle, codexAnalysisFn = (codexBriefAnalysisEnabled() ? runCodexStructuredAnalysis : null), surfaceFn = surfaceSessionBrief, onEvent } = {}) {
  const bundle = await analyzeFn();
  let payloads = buildDirectSessionBriefPayloads({ session, bundle, sizingByGrade });
  if (payloads.length === 0) throw new Error("direct session brief produced no symbol payloads");

  if (codexAnalysisFn) {
    try {
      const codexResult = await codexAnalysisFn({ session, bundle, deterministicPayloads: payloads });
      if (codexResult?.ok && codexResult.analysis) {
        payloads = applyCodexAnalysisToBriefPayloads(payloads, codexResult.analysis);
        onEvent?.({ type: "codex_analysis", status: "applied", symbols: payloads.map((p) => p.symbol) });
      } else {
        onEvent?.({ type: "codex_analysis", status: "rejected", errors: codexResult?.errors || ["unknown Codex analysis rejection"] });
      }
    } catch (err) {
      onEvent?.({ type: "codex_analysis", status: "error", errors: [err?.message || String(err)] });
    }
  }

  for (const payload of payloads) {
    await surfaceFn(payload);
    onEvent?.({ type: "tool_call", name: "direct_surface_session_brief", payload });
  }
  onEvent?.({ type: "chunk", text: `Deterministic session brief surfaced for ${payloads.map((p) => p.symbol).join(", ")}; Codex analysis is commentary-only when present.` });
  return { ok: true, toolCalls: payloads.map(() => "direct_surface_session_brief") };
}

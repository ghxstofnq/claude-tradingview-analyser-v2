import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PAIR_DEFAULT, PAIR_PRIMARY, PAIR_SECONDARY } from "./config.js";
import { surfaceSessionBrief } from "./tools/surface.js";
import { applyCodexAnalysisToBriefPayloads, runCodexStructuredAnalysis } from "./codex-structured-analysis.js";

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

function pickPrimaryDraw(digestSymbol) {
  for (const tf of ["h4", "h1", "daily"]) {
    const block = digestSymbol?.htf?.[tf] ?? {};
    const candidates = [...(block.top_fvgs ?? []), ...(block.top_bprs ?? [])];
    const found = candidates.find((row) => Number.isFinite(row?.top) && Number.isFinite(row?.bottom) && row?.cite);
    if (found) {
      const kind = /bprs/.test(found.cite) ? "bpr" : "fvg";
      const dir = /bear/i.test(found.direction ?? found.dir ?? "") ? "bear" : "bull";
      return {
        tf,
        kind,
        dir,
        top: found.top,
        bottom: found.bottom,
        ce: Number.isFinite(found.ce) ? found.ce : (found.top + found.bottom) / 2,
        disp_score: Number.isFinite(found.disp_score) ? found.disp_score : 0,
        took_liq: !!found.took_liq,
        state: found.state || "fresh",
        cite: found.cite,
      };
    }
  }
  return null;
}

export function buildDirectSessionBriefPayloads({ session, bundle, sizingByGrade = {}, symbols = [PAIR_PRIMARY, PAIR_SECONDARY] } = {}) {
  const digest = bundle?.brief_digest;
  if (!digest?.symbols) throw new Error("direct session brief requires bundle.brief_digest.symbols");
  return symbols.filter((symbol) => digest.symbols[symbol]).map((symbol) => {
    const ds = digest.symbols[symbol];
    const levels = levelRows(symbol, ds);
    const htf = htfBiasRows(symbol, ds);
    const p2 = pillar2Status(ds);
    const draw = pickPrimaryDraw(ds);
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
      ...(draw ? { primary_draw: draw } : {}),
      htf_destination: targetLevel.price >= (levels[Math.floor(levels.length / 2)]?.price ?? targetLevel.price) ? "above nearest untaken liquidity" : "below nearest untaken liquidity",
      overnight_block: {
        untaken_above: levels.filter((l) => l.state === "untaken").slice(0, 3).map((l) => ({ name: l.name, price: l.price, cite: l.cite || "brief_digest" })),
        untaken_below: levels.filter((l) => l.state === "untaken").slice(-3).map((l) => ({ name: l.name, price: l.price, cite: l.cite || "brief_digest" })),
        overnight_verdict: "consolidating",
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

export async function analyzePairBundle({ out = LAST_ANALYZE_PATH } = {}) {
  const args = [path.join(REPO_ROOT, "cli", "index.js"), "analyze", "--pair", PAIR_DEFAULT, "--out", out];
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

export async function runDirectSessionBrief({ session, sizingByGrade = {}, analyzeFn = analyzePairBundle, codexAnalysisFn = runCodexStructuredAnalysis, surfaceFn = surfaceSessionBrief, onEvent } = {}) {
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

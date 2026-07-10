#!/usr/bin/env node
/**
 * evaluate-strategy-lever.mjs — standardized, reusable full-corpus evaluation of
 * ONE strategy lever (Task E2 of docs/plans/2026-07-09-app-and-bot-improvement-plan.md).
 *
 * It folds the certified corpus twice for each symbol — baseline (the lever's
 * env flag(s) UNSET, i.e. code default) and treatment (the flag(s) SET) — using
 * the EXISTING fold machinery (app/main/backtest-baseline.js `foldSymbol`), never
 * a reimplementation. It then emits state/backtest/tests/<lever-id>.json with the
 * per-symbol R delta, EVERY moved date/session (packet/model/side/entry/stop/
 * target/grade changes and no-trade<->trade flips, each defaulting to
 * needs_review), and the STRICT MECHANICAL FIDELITY GATE the user ruled on
 * 2026-07-10 (docs/intent/2026-07-10-unified-goal.md §Full pre-approval item 2):
 *
 *   A lever auto-enables ONLY if all three hold:
 *     (a) the full certified-corpus fold is non-negative on BOTH symbols;
 *     (b) every hand-verified oracle/tape day still passes;
 *     (c) no moved session contradicts a transcript citation.
 *   A lever failing any prong stays default-off with its report filed.
 *
 * FAIL-CLOSED: `corpus_certified` is stamped from cli/lib/corpus-certification.js.
 * The corpus is currently uncertified (rev-2 re-record pending), so this script
 * runs against whatever corpus exists and stamps `corpus_certified:false`; that
 * alone forces `auto_enable_eligible:false` so no lever can auto-enable off an
 * uncertified corpus.
 *
 * The heavy fold/certify/tape machinery is loaded via dynamic import INSIDE
 * `main()` so the pure report builders below stay import-light and unit-testable
 * (tests/strategy-lever-report.test.js) without booting the engine or a corpus.
 *
 * Constraints: no TradingView/CDP (the fold is pure compute over recorded
 * brief-bundle.json + tape.json); the LLM produces nothing here (constraints
 * #6/#7); this script MEASURES and DOCUMENTS — it never changes strategy behavior.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SYMBOLS = ["MNQ1!", "MES1!"];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Pure report builders (unit-tested; zero heavy imports) ───────────────────

// One surfaced "open" setup row -> the fields a reviewer compares.
function summarizeSetup(open = {}, realizedR = null) {
  return {
    id: open.id ?? null,
    model: open.model ?? null,
    side: open.side ?? null,
    entry: open.entry ?? null,
    stop: open.stop ?? null,
    tp1: open.tp1 ?? null,
    tp2: open.tp2 ?? null,
    grade: open.grade ?? null,
    event_ts: open.event_ts ?? null,
    realized_r: realizedR == null ? null : round2(realizedR),
  };
}

// A fold session's setups.jsonl-shaped rows -> the ordered packet summaries.
export function sessionPackets(setups = []) {
  const outcomes = new Map();
  for (const r of setups) {
    if (r?.type === "outcome") outcomes.set(r.setup_id, r.realized_r);
  }
  return setups
    .filter((r) => r?.type === "open")
    .map((o) => summarizeSetup(o, outcomes.has(o.id) ? outcomes.get(o.id) : null))
    .sort((a, b) =>
      String(a.event_ts ?? "").localeCompare(String(b.event_ts ?? "")) ||
      String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

// Stable signature of a session's packets (ignores realized_r so a pure R shift
// on identical packets is caught by the r-delta test, not the signature test).
function packetsSignature(packets = []) {
  return JSON.stringify(packets.map(({ realized_r, ...keep }) => keep));
}

function flipOf(basePackets = [], treatPackets = []) {
  const b = basePackets.length > 0;
  const t = treatPackets.length > 0;
  if (!b && !t) return "same";
  if (!b && t) return "no_trade_to_trade";
  if (b && !t) return "trade_to_no_trade";
  return packetsSignature(basePackets) === packetsSignature(treatPackets) ? "same" : "changed";
}

// Index a foldSymbol() result by "date|session" -> { r, packets }.
function indexFold(fold = {}) {
  const perDay = new Map(
    (fold.per_day ?? []).map((d) => [`${d.date}|${d.session}`, round2(d.r)]));
  const details = new Map(
    (fold.run_details ?? []).map((rd) => [
      `${rd.entry.date}|${rd.entry.session}`,
      sessionPackets(rd.setups),
    ]));
  const keys = new Set([...perDay.keys(), ...details.keys()]);
  const out = new Map();
  for (const k of keys) out.set(k, { r: perDay.get(k) ?? 0, packets: details.get(k) ?? [] });
  return out;
}

// Every date/session where the treatment fold differs from the baseline fold —
// by realized R OR by the surfaced packet set (a no-trade<->trade flip that nets
// the same R is still a move). Each row defaults to decision "needs_review".
export function movedSessions(baselineFold = {}, treatmentFold = {}) {
  const b = indexFold(baselineFold);
  const t = indexFold(treatmentFold);
  const keys = [...new Set([...b.keys(), ...t.keys()])].sort();
  const moved = [];
  for (const key of keys) {
    const bs = b.get(key) ?? { r: 0, packets: [] };
    const ts = t.get(key) ?? { r: 0, packets: [] };
    const rMoved = round2(bs.r) !== round2(ts.r);
    const sigMoved = packetsSignature(bs.packets) !== packetsSignature(ts.packets);
    if (!rMoved && !sigMoved) continue;
    const [date, session] = key.split("|");
    moved.push({
      date,
      session,
      baseline_r: round2(bs.r),
      treatment_r: round2(ts.r),
      delta: round2(ts.r - bs.r),
      flip: flipOf(bs.packets, ts.packets),
      baseline_packets: bs.packets,
      treatment_packets: ts.packets,
      decision: "needs_review", // approved | rejected | needs_review
    });
  }
  return moved;
}

// The strict mechanical fidelity gate (unified-goal §Full pre-approval item 2),
// with the corpus-certified fail-closed precondition (E2 spec item 1). Pure.
//   transcript_contradiction: null = unreviewed, false = reviewed & clear,
//   true = a moved session contradicts a transcript. Prong (c) passes only when
//   nothing moved (vacuous) or review explicitly cleared it (=== false).
export function computeFidelityGate({
  corpusCertified,
  foldNonNegativeBySymbol = {},
  oracleTapesIntact,
  transcriptContradiction = null,
  movedSessionCount = 0,
} = {}) {
  const perSymbol = { ...foldNonNegativeBySymbol };
  const foldNonNegativeBoth =
    Object.values(perSymbol).length > 0 && Object.values(perSymbol).every((v) => v === true);
  const transcriptClear =
    movedSessionCount === 0 ? true : transcriptContradiction === false;
  const autoEnableEligible =
    corpusCertified === true &&
    foldNonNegativeBoth === true &&
    oracleTapesIntact === true &&
    transcriptClear === true;
  return {
    fold_non_negative_by_symbol: perSymbol,
    fold_non_negative_both_symbols: foldNonNegativeBoth,
    oracle_tapes_intact: oracleTapesIntact === true,
    transcript_contradiction: transcriptContradiction ?? null,
    auto_enable_eligible: autoEnableEligible,
  };
}

// Human-review rollup, kept SEPARATE from the mechanical gate: any moved session
// still awaiting approval keeps the whole report at needs_review.
export function overallStatus(perSymbolMoved = {}) {
  const all = Object.values(perSymbolMoved).flat();
  if (all.some((s) => s.decision === "rejected")) return "rejected";
  if (all.some((s) => s.decision !== "approved")) return "needs_review";
  return "approved";
}

// Snapshot the full effective GOFNQ_*/TV_* lever set for the treatment world.
export function effectiveLeverSet(envFlags = {}, baseEnv = {}) {
  const out = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (/^(GOFNQ|TV)_/.test(k)) out[k] = v;
  }
  for (const [k, v] of Object.entries(envFlags)) out[k] = v;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Assemble the full lever-evaluation report. Pure — `folds` is
 * { "<SYM>": { baseline: <foldResult>, treatment: <foldResult> } }.
 */
export function buildLeverReport({
  leverId,
  envFlags = {},
  effectiveLevers = null,
  baselineManifestId = null,
  baselineSha = null,
  treatmentSha = null,
  corpusCertified,
  oracleTapesIntact,
  transcriptContradiction = null,
  folds = {},
  now = null,
} = {}) {
  if (!leverId) throw new Error("buildLeverReport: leverId is required");

  const symbols = {};
  const perSymbolMoved = {};
  const foldNonNegativeBySymbol = {};
  for (const [symbol, pair] of Object.entries(folds)) {
    const baseline = pair?.baseline ?? {};
    const treatment = pair?.treatment ?? {};
    const baselineTotal = round2(baseline.total_r ?? 0);
    const treatmentTotal = round2(treatment.total_r ?? 0);
    const moved = movedSessions(baseline, treatment);
    perSymbolMoved[symbol] = moved;
    foldNonNegativeBySymbol[symbol] = treatmentTotal >= 0;
    symbols[symbol] = {
      baseline_total_r: baselineTotal,
      treatment_total_r: treatmentTotal,
      delta: round2(treatmentTotal - baselineTotal),
      fold_non_negative: treatmentTotal >= 0,
      sessions_folded: (treatment.per_day ?? []).length,
      moved_sessions: moved,
    };
  }

  const movedSessionCount = Object.values(perSymbolMoved).reduce((s, m) => s + m.length, 0);
  const fidelity_gate = computeFidelityGate({
    corpusCertified,
    foldNonNegativeBySymbol,
    oracleTapesIntact,
    transcriptContradiction,
    movedSessionCount,
  });

  return {
    id: leverId,
    kind: "strategy-lever-evaluation",
    created_at: now ?? new Date().toISOString(),
    lever: {
      id: leverId,
      env_flags: { ...envFlags },
      effective_levers: effectiveLevers ?? effectiveLeverSet(envFlags, {}),
    },
    baseline: { manifest_id: baselineManifestId, code_sha: baselineSha },
    treatment: { code_sha: treatmentSha },
    corpus_certified: corpusCertified === true,
    symbols,
    moved_session_count: movedSessionCount,
    fidelity_gate,
    status: overallStatus(perSymbolMoved),
  };
}

// ── Runnable driver (dynamic-imports the heavy fold machinery) ───────────────

function parseArgs(argv) {
  const out = { lever: null, env: {}, symbols: DEFAULT_SYMBOLS, stateDir: null, transcriptContradiction: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--lever") out.lever = argv[++i];
    else if (a === "--env") {
      const [k, ...rest] = String(argv[++i]).split("=");
      out.env[k] = rest.join("=");
    } else if (a === "--symbols") out.symbols = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--state-dir") out.stateDir = argv[++i];
    else if (a === "--transcript-contradiction") {
      const v = String(argv[++i]).toLowerCase();
      out.transcriptContradiction = v === "true" ? true : v === "false" ? false : null;
    }
  }
  return out;
}

async function foldWithEnv({ foldSymbol, symbol, stateDir, envFlags, on }) {
  const keys = Object.keys(envFlags);
  const saved = keys.map((k) => [k, process.env[k]]);
  for (const k of keys) {
    if (on) process.env[k] = envFlags[k];
    else delete process.env[k];
  }
  try {
    return await foldSymbol({ symbol, stateDir });
  } catch (err) {
    // No corpus on disk / unfoldable symbol -> empty fold (corpus_certified will
    // be false regardless, so this stays fail-closed).
    return { symbol, total_r: 0, per_day: [], run_details: [], code_sha: null, _fold_error: String(err?.message ?? err) };
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.lever) {
    console.error("usage: node scripts/evaluate-strategy-lever.mjs --lever <id> --env KEY=VAL [--env ...] [--symbols MNQ1!,MES1!] [--state-dir <path>] [--transcript-contradiction true|false]");
    process.exit(2);
  }
  const stateDir = args.stateDir || process.env.GOFNQ_STATE_DIR || path.join(REPO_ROOT, "state");

  const { foldSymbol, writeTest } = await import("../app/main/backtest-baseline.js");
  const { certifyCorpus, DEFAULT_MANIFEST } = await import("../cli/lib/corpus-certification.js");
  const { runTapesFromDir } = await import("../cli/lib/day-tape.js");
  const { __test } = await import("../app/main/bar-close.js");

  const folds = {};
  let treatmentSha = null;
  let baselineSha = null;
  for (const symbol of args.symbols) {
    const baseline = await foldWithEnv({ foldSymbol, symbol, stateDir, envFlags: args.env, on: false });
    const treatment = await foldWithEnv({ foldSymbol, symbol, stateDir, envFlags: args.env, on: true });
    folds[symbol] = { baseline, treatment };
    baselineSha = baselineSha ?? baseline.code_sha;
    treatmentSha = treatmentSha ?? treatment.code_sha;
  }

  let corpusCertified = false;
  let manifestId = DEFAULT_MANIFEST?.manifest_id ?? null;
  try {
    const cert = certifyCorpus({ stateDir });
    corpusCertified = cert.certified === true;
    manifestId = cert.manifest_id ?? manifestId;
  } catch { /* uncertified -> fail-closed */ }

  let oracleTapesIntact = false;
  try {
    const run = await runTapesFromDir(path.join(REPO_ROOT, "tests", "tapes"), {
      truthFn: __test.buildDeterministicPacketTruthFromInputs,
    });
    oracleTapesIntact = run.ok === true;
  } catch { /* tapes broken -> fail-closed */ }

  const report = buildLeverReport({
    leverId: args.lever,
    envFlags: args.env,
    effectiveLevers: effectiveLeverSet(args.env, process.env),
    baselineManifestId: manifestId,
    baselineSha,
    treatmentSha,
    corpusCertified,
    oracleTapesIntact,
    transcriptContradiction: args.transcriptContradiction,
    folds,
  });

  writeTest({ stateDir, test: report });
  const outPath = path.join(stateDir, "backtest", "tests", `${report.id}.json`);
  console.log(JSON.stringify({
    id: report.id,
    corpus_certified: report.corpus_certified,
    moved_session_count: report.moved_session_count,
    fidelity_gate: report.fidelity_gate,
    status: report.status,
    symbols: Object.fromEntries(Object.entries(report.symbols).map(([s, v]) => [s, { delta: v.delta, treatment_total_r: v.treatment_total_r, moved: v.moved_sessions.length }])),
    written: outPath,
  }, null, 2));
  process.exit(report.fidelity_gate.auto_enable_eligible ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

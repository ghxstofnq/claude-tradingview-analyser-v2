#!/usr/bin/env node
/**
 * evaluate-strategy-lever.mjs — standardized, reusable full-corpus evaluation of
 * ONE strategy lever (Task E2 of docs/plans/2026-07-09-app-and-bot-improvement-plan.md).
 *
 * It folds the certified corpus twice for each symbol — baseline (ALL levers
 * scrubbed to code default) and treatment (the tested flag(s) applied on top of
 * scrubbed defaults) — using the EXISTING fold machinery
 * (app/main/backtest-baseline.js `foldSymbol`), never a reimplementation. It then
 * emits state/backtest/tests/<lever-id>.json with the per-symbol R delta, EVERY
 * moved date/session (packet/model/side/entry/stop/target/grade changes and
 * no-trade<->trade flips, each defaulting to needs_review), and the STRICT
 * MECHANICAL FIDELITY GATE the user ruled on 2026-07-10
 * (docs/intent/2026-07-10-unified-goal.md §Full pre-approval item 2):
 *
 *   A lever auto-enables ONLY if all three hold:
 *     (a) the full certified-corpus fold is non-negative on BOTH symbols;
 *     (b) every hand-verified oracle/tape day still passes;
 *     (c) no moved session contradicts a transcript citation.
 *   A lever failing any prong stays default-off with its report filed.
 *
 * FAIL-CLOSED, and the gate never lies about its own prongs:
 *   - `corpus_certified` is stamped from cli/lib/corpus-certification.js; the
 *     current uncertified corpus forces `auto_enable_eligible:false`.
 *   - A crashed / zero-session fold on EITHER symbol fails the fold prong AND
 *     blocks the vacuous transcript branch (a fold that produced nothing can
 *     never be "non-negative" or "moved nothing").
 *   - `fold_non_negative_both_symbols` requires the full required symbol set
 *     (MNQ1!+MES1!) to be present — a single-symbol run cannot pass it.
 *   - `oracle_tapes_intact` requires at least one VERIFIED tape to have run;
 *     an empty verified-tape set is not "intact".
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
export const LEVER_ID_RE = /^[a-z0-9._-]+$/i;
const LEVER_ENV_RE = /^(GOFNQ|TV)_/;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function isValidLeverId(id) {
  return typeof id === "string" && LEVER_ID_RE.test(id);
}

// True when an existing report carries any hand-recorded (non-default) decision,
// so an overwrite would clobber human review. Used to protect approvals.
export function hasRecordedDecisions(report) {
  if (!report?.symbols) return false;
  return Object.values(report.symbols).some((s) =>
    (s?.moved_sessions ?? []).some((m) => m?.decision && m.decision !== "needs_review"));
}

// ── Pure report builders (unit-tested; zero heavy imports) ───────────────────

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

/**
 * The strict mechanical fidelity gate (unified-goal §Full pre-approval item 2),
 * with the corpus-certified fail-closed precondition (E2 spec item 1). Pure and
 * fail-closed on every prong:
 *   - fold prong requires the full required symbol set present AND each required
 *     symbol non-negative-AND-healthy (foldNonNegativeBySymbol already folds
 *     fold health in — a crashed/zero-session symbol is false);
 *   - transcript prong: null=unreviewed, false=reviewed & clear, true=contradiction.
 *     The vacuous "nothing moved" branch is allowed ONLY when every required
 *     symbol folded ≥1 session (allSymbolsHealthy) — a crashed/empty fold that
 *     "moved nothing" cannot vacuously clear it;
 *   - oracle prong requires oracleTapesIntact AND at least one verified tape ran.
 */
export function computeFidelityGate({
  corpusCertified,
  requiredSymbols = DEFAULT_SYMBOLS,
  presentSymbols = [],
  foldNonNegativeBySymbol = {},
  allSymbolsHealthy = false,
  oracleTapesIntact,
  oracleTapesRun = 0,
  transcriptContradiction = null,
  movedSessionCount = 0,
} = {}) {
  const blockers = [];

  const missing = requiredSymbols.filter((s) => !presentSymbols.includes(s));
  if (missing.length) blockers.push(`missing required symbol(s): ${missing.join(", ")}`);
  const foldNonNegativeBoth =
    missing.length === 0 && requiredSymbols.every((s) => foldNonNegativeBySymbol[s] === true);
  if (missing.length === 0 && !foldNonNegativeBoth) {
    blockers.push("fold negative, crashed, or zero-session on a required symbol");
  }

  const oracleOk = oracleTapesIntact === true && oracleTapesRun > 0;
  if (!oracleOk) blockers.push(oracleTapesRun > 0 ? "oracle tapes failed" : "no verified oracle tapes ran");

  const canBeVacuous = movedSessionCount === 0 && allSymbolsHealthy === true;
  const transcriptClear = canBeVacuous ? true : transcriptContradiction === false;
  if (!transcriptClear) {
    blockers.push(movedSessionCount === 0
      ? "cannot vacuously clear transcript on an unhealthy/empty fold"
      : "moved sessions not cleared against transcript citations");
  }

  if (corpusCertified !== true) blockers.push("corpus not certified");

  const autoEnableEligible =
    corpusCertified === true && foldNonNegativeBoth && oracleOk && transcriptClear;

  return {
    fold_non_negative_by_symbol: { ...foldNonNegativeBySymbol },
    fold_non_negative_both_symbols: foldNonNegativeBoth,
    oracle_tapes_intact: oracleOk,
    oracle_tapes_run: oracleTapesRun,
    transcript_contradiction: transcriptContradiction ?? null,
    auto_enable_eligible: autoEnableEligible,
    blockers,
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
    if (LEVER_ENV_RE.test(k)) out[k] = v;
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
  oracleTapesRun = 0,
  transcriptContradiction = null,
  folds = {},
  requiredSymbols = DEFAULT_SYMBOLS,
  ambientLevers = null,
  now = null,
} = {}) {
  if (!leverId) throw new Error("buildLeverReport: leverId is required");
  if (!isValidLeverId(leverId)) {
    throw new Error(`buildLeverReport: invalid leverId "${leverId}" (allowed: ${LEVER_ID_RE})`);
  }

  const symbols = {};
  const perSymbolMoved = {};
  const foldNonNegativeBySymbol = {};
  // Sort symbol iteration so report key order is input-order-independent.
  for (const symbol of Object.keys(folds).sort()) {
    const pair = folds[symbol] ?? {};
    const baseline = pair?.baseline ?? {};
    const treatment = pair?.treatment ?? {};
    const foldError = treatment._fold_error ?? baseline._fold_error ?? null;
    const sessionsFolded = (treatment.per_day ?? []).length;
    const baselineSessions = (baseline.per_day ?? []).length;
    // A symbol is only trustworthy when BOTH folds ran and produced sessions.
    const healthy = !foldError && sessionsFolded > 0 && baselineSessions > 0;
    const baselineTotal = round2(baseline.total_r ?? 0);
    const treatmentTotal = round2(treatment.total_r ?? 0);
    const moved = healthy ? movedSessions(baseline, treatment) : [];
    perSymbolMoved[symbol] = moved;
    foldNonNegativeBySymbol[symbol] = healthy && treatmentTotal >= 0;
    symbols[symbol] = {
      baseline_total_r: baselineTotal,
      treatment_total_r: treatmentTotal,
      delta: round2(treatmentTotal - baselineTotal),
      sessions_folded: sessionsFolded,
      baseline_sessions_folded: baselineSessions,
      fold_error: foldError,
      healthy,
      fold_non_negative: foldNonNegativeBySymbol[symbol],
      moved_sessions: moved,
    };
  }

  const presentSymbols = Object.keys(folds);
  const allSymbolsHealthy =
    requiredSymbols.length > 0 && requiredSymbols.every((s) => symbols[s]?.healthy === true);
  const movedSessionCount = Object.values(perSymbolMoved).reduce((s, m) => s + m.length, 0);
  const fidelity_gate = computeFidelityGate({
    corpusCertified,
    requiredSymbols,
    presentSymbols,
    foldNonNegativeBySymbol,
    allSymbolsHealthy,
    oracleTapesIntact,
    oracleTapesRun,
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
    required_symbols: [...requiredSymbols],
    symbols,
    moved_session_count: movedSessionCount,
    fidelity_gate,
    status: overallStatus(perSymbolMoved),
    warnings: { ambient_levers: ambientLevers ?? {} },
  };
}

// ── Runnable driver (dynamic-imports the heavy fold machinery) ───────────────

function parseArgs(argv) {
  const out = { lever: null, env: {}, symbols: DEFAULT_SYMBOLS, stateDir: null, transcriptContradiction: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--lever") out.lever = argv[++i];
    else if (a === "--env") {
      const [k, ...rest] = String(argv[++i]).split("=");
      out.env[k] = rest.join("=");
    } else if (a === "--symbols") out.symbols = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--state-dir") out.stateDir = argv[++i];
    else if (a === "--force") out.force = true;
    else if (a === "--transcript-contradiction") {
      const v = String(argv[++i]).toLowerCase();
      out.transcriptContradiction = v === "true" ? true : v === "false" ? false : null;
    }
  }
  return out;
}

// Fold `symbol` with a reproducible env: ALL GOFNQ_*/TV_* vars scrubbed to code
// default, then (treatment only) the tested flags applied on top. Restores the
// process env afterward. A crash becomes an explicit `_fold_error` marker so the
// gate can fail closed instead of reading a swallowed 0R as "non-negative".
async function foldWithEnv({ foldSymbol, symbol, stateDir, envFlags, on }) {
  const keys = new Set(Object.keys(envFlags));
  for (const k of Object.keys(process.env)) if (LEVER_ENV_RE.test(k)) keys.add(k);
  const saved = [...keys].map((k) => [k, process.env[k]]);
  for (const k of keys) delete process.env[k]; // scrub ALL levers to code default
  if (on) for (const [k, v] of Object.entries(envFlags)) process.env[k] = v; // apply only tested flags
  try {
    return await foldSymbol({ symbol, stateDir });
  } catch (err) {
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
    console.error("usage: node scripts/evaluate-strategy-lever.mjs --lever <id> --env KEY=VAL [--env ...] [--symbols MNQ1!,MES1!] [--state-dir <path>] [--transcript-contradiction true|false] [--force]");
    process.exit(2);
  }
  if (!isValidLeverId(args.lever)) {
    console.error(`invalid --lever "${args.lever}" (allowed: ${LEVER_ID_RE})`);
    process.exit(2);
  }
  const stateDir = args.stateDir || process.env.GOFNQ_STATE_DIR || path.join(REPO_ROOT, "state");

  // Ambient levers present at launch are recorded (they are scrubbed for the fold
  // so the measurement is reproducible; the operator is warned they were set).
  const ambientLevers = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => LEVER_ENV_RE.test(k)).sort(([a], [b]) => a.localeCompare(b)));

  const { foldSymbol, writeTest, readTest } = await import("../app/main/backtest-baseline.js");
  const { certifyCorpus, DEFAULT_MANIFEST } = await import("../cli/lib/corpus-certification.js");
  const { runTapesFromDir } = await import("../cli/lib/day-tape.js");
  const { __test } = await import("../app/main/bar-close.js");

  // Overwrite protection: never clobber a report carrying hand-recorded decisions.
  const existing = readTest({ stateDir, id: args.lever });
  if (existing && hasRecordedDecisions(existing) && !args.force) {
    console.error(`refusing to overwrite ${args.lever}.json — it carries recorded decisions (approved/rejected). Re-run with --force to replace.`);
    process.exit(3);
  }

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
  let oracleTapesRun = 0;
  try {
    const run = await runTapesFromDir(path.join(REPO_ROOT, "tests", "tapes"), {
      truthFn: __test.buildDeterministicPacketTruthFromInputs,
    });
    oracleTapesIntact = run.ok === true;
    oracleTapesRun = (run.tapes ?? []).length; // VERIFIED tapes actually run (unverified are skipped)
  } catch { /* tapes broken -> fail-closed */ }

  const report = buildLeverReport({
    leverId: args.lever,
    envFlags: args.env,
    baselineManifestId: manifestId,
    baselineSha,
    treatmentSha,
    corpusCertified,
    oracleTapesIntact,
    oracleTapesRun,
    transcriptContradiction: args.transcriptContradiction,
    folds,
    requiredSymbols: DEFAULT_SYMBOLS, // fidelity standard: both symbols, regardless of --symbols
    ambientLevers,
  });

  writeTest({ stateDir, test: report });
  const outPath = path.join(stateDir, "backtest", "tests", `${report.id}.json`);
  console.log(JSON.stringify({
    id: report.id,
    corpus_certified: report.corpus_certified,
    moved_session_count: report.moved_session_count,
    fidelity_gate: report.fidelity_gate,
    status: report.status,
    warnings: report.warnings,
    symbols: Object.fromEntries(Object.entries(report.symbols).map(([s, v]) => [s, { delta: v.delta, treatment_total_r: v.treatment_total_r, sessions_folded: v.sessions_folded, fold_error: v.fold_error, moved: v.moved_sessions.length }])),
    written: outPath,
  }, null, 2));
  process.exit(report.fidelity_gate.auto_enable_eligible ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

// app/main/backtest-baseline.js
// Faithful fold-week baseline for the BACKTEST popover.
//
// The LIBRARY dashboard used to re-fold each run's raw setups.jsonl (the
// generation-time replay outcomes: stale targets, no AM->PM carry) — so it
// understated the real edge. This module folds the corpus the SAME way the
// canonical scripts/fold-week.mjs + scripts/save-fold-baseline.mjs do
// (self-healing brief regen + AM->PM carry) and emits buildAnalytics-ready
// `run_details`, so the existing Analytics.jsx renders the FAITHFUL numbers
// unchanged.
//
// foldSymbol() is pure compute over recorded brief-bundle.json + tape.json —
// it never touches TV/CDP, so it's safe to run even during a live session.
// Constraints #6/#7: every figure is code-derived from the fold; the LLM
// produces nothing here.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runBacktest } from "./backtest-engine.js";
import { contextFromBriefPayloads } from "./backtest-context.js";
import { gradeOpenTrade } from "./backtest-grader.js";
import { __test as bc } from "./bar-close.js";
import { buildBriefDigest } from "../../cli/lib/brief-digest.js";
import { buildDirectSessionBriefPayloads } from "./direct-session-brief.js";
import { tradesFromSetups } from "../../cli/lib/backtest-analytics.js";
import { computeEngineGates } from "../../cli/lib/compute-engine-gates.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Pure helpers (unit-tested without booting the engine) ────────────────

// Filesystem-safe per-symbol slug: "MNQ1!" -> "MNQ1".
export function symbolSlug(symbol) {
  return String(symbol).replace(/[^A-Za-z0-9]/g, "");
}

// One surfaced setup + its outcome event -> the two setups.jsonl-shaped rows
// buildAnalytics consumes. realized_r is the signed R from the actual exit so
// the force-close (closed_1600) case resolves; the enumerated outcomes
// (tp1_hit/tp2_hit/stop_hit/closed_be) are recomputed from levels by
// computeTradeR and agree because exit == the named level on those.
export function buildSetupRows(setup, outcome) {
  const risk = Math.abs(Number(setup.entry) - Number(setup.stop));
  const signed = round2(
    (setup.side === "long"
      ? Number(outcome.exit) - Number(setup.entry)
      : Number(setup.entry) - Number(outcome.exit)) / (risk || 1),
  );
  return [
    {
      type: "open", id: setup.id, entry: setup.entry, stop: setup.stop,
      tp1: setup.tp1, tp2: setup.tp2, grade: setup.grade, model: setup.model,
      side: setup.side, event_ts: setup.event_ts,
    },
    { type: "outcome", setup_id: setup.id, outcome: outcome.outcome, realized_r: signed },
  ];
}

// Snapshot the prior baseline into history only when it actually differs —
// a new total (corpus grew / behavior changed) or a new code_sha.
export function shouldSnapshot(oldBaseline, newBaseline) {
  if (!oldBaseline) return false;
  return oldBaseline.total_r !== newBaseline.total_r
    || oldBaseline.code_sha !== newBaseline.code_sha;
}

// Per-day comparison rows (date+session keyed) for a test vs the baseline.
export function diffPerDay(basePerDay = [], treatPerDay = []) {
  const key = (d) => `${d.date}|${d.session}`;
  const bMap = new Map(basePerDay.map((d) => [key(d), d.r]));
  const tMap = new Map(treatPerDay.map((d) => [key(d), d.r]));
  const keys = [...new Set([...bMap.keys(), ...tMap.keys()])].sort();
  return keys.map((k) => {
    const [date, session] = k.split("|");
    const b = bMap.has(k) ? bMap.get(k) : null;
    const t = tMap.has(k) ? tMap.get(k) : null;
    return { date, session, baseline_r: b, treatment_r: t, delta: round2((t ?? 0) - (b ?? 0)) };
  });
}

function gitSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim(); }
  catch { return null; }
}

// ── Corpus fold (mirrors save-fold-baseline.mjs) ─────────────────────────

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

function runLeader(runDir) {
  try { return readJson(path.join(runDir, "tape.json")).entries?.[0]?.inputs?.leader ?? null; }
  catch { return null; }
}

function findRun(BT, symbol, date, session) {
  const tag = `-${session.replace("ny-", "")}-${date}`;
  const cands = fs.readdirSync(BT).filter((d) => d.includes(tag)).sort();
  for (const d of [...cands].reverse()) {
    if (runLeader(path.join(BT, d, session)) === symbol) return d;
  }
  return null;
}

// Re-derive gates.engine.pillar1 from engine_by_tf with the CURRENT code/flags.
// The recorded brief-bundle bakes the CAPTURE-TIME pillar1, and buildBriefDigest
// forwards it (bias: p1.bias) — so a refold over old recordings would fold the
// STALE bias and silently drop the current faithfulness levers (notably
// GOFNQ_HTF_INTRADAY_DRAW, which lives in pillar1-bias). The per-bar
// open-reaction levers already re-run inside runBacktest; this restores the
// HTF-draw lever the digest path was missing. Mirrors scripts/fold-bias.mjs.
// Mutates and returns the bundle; keeps the baked gate if the recompute throws.
export function recomputeGate(bundle) {
  try {
    const c = bundle?.gates?.engine?.confirmation ?? {};
    const g = computeEngineGates({
      engine: bundle.engine, engineByTf: bundle.engine_by_tf, last: bundle?.quote?.last,
      lastBar: c.last_bar ?? null, lastBarAgeSeconds: c.last_bar_age_seconds ?? 0,
      m5LastBar: c.m5_last_bar ?? null, m15LastBar: c.m15_last_bar ?? null, quoteTimeMs: Date.now(),
    });
    if (g?.pillar1) bundle.gates = { ...bundle.gates, engine: { ...(bundle.gates?.engine || {}), pillar1: g.pillar1 } };
  } catch { /* keep the baked gate if recompute throws */ }
  return bundle;
}

// Self-healing brief: recompute payloads from the recorded bundle with CURRENT
// code (no stale baked targets); fall back to recorded payloads; null if a
// tape-only run (re-record it first).
function regen(runDir, session, symbol) {
  let rec = null;
  try { rec = readJson(path.join(runDir, "brief-payloads.json")); } catch { /* regen */ }
  const bp = path.join(runDir, "brief-bundle.json");
  if (!fs.existsSync(bp)) return rec;
  const bundle = recomputeGate(readJson(bp));
  const leader = rec?.[0]?.symbol || symbol;
  const digest = buildBriefDigest({ pair: { symbols: { [leader]: bundle } } });
  return buildDirectSessionBriefPayloads({ session, bundle: { ...bundle, brief_digest: digest }, symbols: [leader] });
}

function pmCarry(BT, symbol, date) {
  const run = findRun(BT, symbol, date, "ny-pm");
  if (!run) return [];
  try { return readJson(path.join(BT, run, "ny-pm", "tape.json")).entries ?? []; }
  catch { return []; }
}

async function foldSession(BT, symbol, runId, date, session) {
  const runDir = path.join(BT, runId, session);
  if (!fs.existsSync(path.join(runDir, "tape.json"))) return null;
  const tape = readJson(path.join(runDir, "tape.json"));
  const payloads = regen(runDir, session, symbol);
  if (!payloads) return null;

  const surfaced = new Map();
  const setups = [];
  const bus = new EventEmitter();
  bus.on("backtest:event", (e) => {
    if (e.type === "setup_surfaced") surfaced.set(e.setup.id, e.setup);
    else if (e.type === "setup_outcome") {
      const s = surfaced.get(e.setupId);
      if (s) setups.push(...buildSetupRows(s, e));
    } else if (e.type === "paused") {
      bus.emit("backtest:command", { type: "decision", choice: "accept" });
    }
  });

  const deps = {
    recordEntries: async () => ({ entries: tape.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => contextFromBriefPayloads({ session, payloads }),
    truthFn: bc.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };

  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "foldsym-"));
  try {
    const { summary } = await runBacktest({
      date: tape.date, session, mode: "auto", bus, stateDir: sd, deps,
      carryEntries: session === "ny-am" ? pmCarry(BT, symbol, date) : [],
    });
    const alignment = payloads[0]?.htf_ltf_alignment ?? null;
    return {
      total_r: round2(summary.total_r || 0),
      setups,
      open_reaction: alignment ? { htf_ltf_alignment: alignment } : null,
    };
  } finally {
    fs.rmSync(sd, { recursive: true, force: true });
  }
}

// Fold every registered run for `symbol` and assemble the faithful baseline.
// Returns the shape persisted to state/backtest/baseline/<slug>.json plus the
// buildAnalytics-ready run_details. INVARIANT: buildAnalytics(run_details).cum_r
// equals total_r (asserted in tests).
export async function foldSymbol({ symbol, stateDir, dates }) {
  const BT = path.join(stateDir, "backtest");
  const index = readJson(path.join(BT, "index.json"));
  const want = Array.isArray(dates) && dates.length ? new Set(dates) : null;
  const runs = index.runs.filter((r) => r.symbol === symbol && (!want || want.has(r.date)));

  const run_details = [];
  const per_day = [];
  const run_results = []; // per-run rollup for the index/summary refresh (not persisted in the baseline file)
  let total = 0;
  for (const entry of runs) {
    const res = await foldSession(BT, symbol, entry.run_id, entry.date, entry.session);
    if (!res) continue;
    total += res.total_r;
    per_day.push({ date: entry.date, session: entry.session, r: res.total_r });
    run_details.push({
      // Prefer the run's RECORDED open-reaction (carries htf_ltf_alignment) so the
      // BIAS ALIGNMENT cut renders — same source the pre-baseline dashboard used.
      entry: { date: entry.date, session: entry.session, open_reaction: entry.open_reaction ?? res.open_reaction },
      setups: res.setups,
    });
    const trades = tradesFromSetups(res.setups);
    run_results.push({
      run_id: entry.run_id, date: entry.date, session: entry.session,
      total_r: res.total_r,
      wins: trades.filter((t) => t.r > 0).length,
      losses: trades.filter((t) => t.r < 0).length,
      setups: trades.length,
    });
  }

  return {
    symbol,
    built_at: new Date().toISOString(),
    code_sha: gitSha(),
    corpus: {
      n_sessions: run_details.length,
      dates: [...new Set(run_details.map((d) => d.entry.date))].sort(),
    },
    total_r: round2(total),
    per_day,
    run_details,
    run_results,
    reason: null,
  };
}

// Write the faithful per-run totals back into index.json + each run's
// summary.json, so the popover's AGGREGATE grid + table (index-based) match the
// dashboard hero (baseline-based). Same write save-fold-baseline.mjs does, now
// driven by the RE-FOLD button. Best-effort per summary; index is authoritative.
export function applyRunResultsToIndex({ stateDir, runResults = [], marker }) {
  if (!runResults.length) return;
  const BT = path.join(stateDir, "backtest");
  const idxPath = path.join(BT, "index.json");
  const index = readJson(idxPath);
  const byId = new Map(runResults.map((r) => [r.run_id, r]));
  for (const entry of index.runs) {
    const r = byId.get(entry.run_id);
    if (!r) continue;
    entry.total_r = r.total_r; entry.wins = r.wins; entry.losses = r.losses; entry.setups = r.setups;
    entry.refold_baseline = marker;
    try {
      const sp = path.join(BT, entry.run_id, entry.session, "summary.json");
      const sum = readJson(sp);
      sum.total_r = r.total_r; sum.wins = r.wins; sum.losses = r.losses; sum.refold_baseline = marker;
      fs.writeFileSync(sp, JSON.stringify(sum, null, 2));
    } catch { /* best-effort */ }
  }
  fs.writeFileSync(idxPath, JSON.stringify(index, null, 2));
}

// ── Persistence — state/backtest/baseline/<slug>.json (+ .history.json) ───

function baselineDir(stateDir) { return path.join(stateDir, "backtest", "baseline"); }
export function baselinePath(stateDir, symbol) {
  return path.join(baselineDir(stateDir), `${symbolSlug(symbol)}.json`);
}
export function historyPath(stateDir, symbol) {
  return path.join(baselineDir(stateDir), `${symbolSlug(symbol)}.history.json`);
}

export function readBaseline({ stateDir, symbol }) {
  const p = baselinePath(stateDir, symbol);
  if (!fs.existsSync(p)) return null;
  try { return readJson(p); } catch { return null; }
}

export function readHistory({ stateDir, symbol }) {
  const p = historyPath(stateDir, symbol);
  if (!fs.existsSync(p)) return [];
  try { const h = readJson(p); return Array.isArray(h) ? h : []; } catch { return []; }
}

export function writeBaseline({ stateDir, symbol, baseline }) {
  const dir = baselineDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(baselinePath(stateDir, symbol), JSON.stringify(baseline, null, 2));
}

function writeHistory({ stateDir, symbol, history }) {
  const dir = baselineDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(historyPath(stateDir, symbol), JSON.stringify(history, null, 2));
}

// A compact snapshot of a baseline for the history log (no run_details — too big).
export function historyRecord(baseline) {
  return {
    built_at: baseline.built_at,
    code_sha: baseline.code_sha,
    corpus_n: baseline.corpus?.n_sessions ?? null,
    total_r: baseline.total_r,
    reason: baseline.reason ?? null,
  };
}

// Re-fold the symbol's corpus with current code, snapshot the prior baseline
// into history when it actually changed, persist the new baseline, return it.
// `fold` is injectable for tests; production uses foldSymbol.
export async function refoldBaseline({ stateDir, symbol, reason = null, fold = foldSymbol }) {
  const prev = readBaseline({ stateDir, symbol });
  const folded = await fold({ symbol, stateDir });
  const { run_results, ...next } = folded; // run_results drives the index refresh, not persisted in the baseline
  if (reason != null) next.reason = reason;
  if (shouldSnapshot(prev, next)) {
    const history = readHistory({ stateDir, symbol });
    history.push(historyRecord(prev));
    writeHistory({ stateDir, symbol, history });
  }
  writeBaseline({ stateDir, symbol, baseline: next });
  if (Array.isArray(run_results)) {
    applyRunResultsToIndex({ stateDir, runResults: run_results, marker: `refold-${next.code_sha ?? "nosha"}` });
  }
  return next;
}

// ── Fold-tests — state/backtest/tests/<id>.json ──────────────────────────
// A test is one fold of the CURRENT working code (the treatment) compared to
// the accepted baseline file. Run save-fold-test.mjs (optionally with an env
// gate set) to produce one; accept/reject + reason is set from the popover and
// is a RECORD, not a code-swap. The in-app version of the rejection log.

function testsDir(stateDir) { return path.join(stateDir, "backtest", "tests"); }
export function testPath(stateDir, id) { return path.join(testsDir(stateDir), `${id}.json`); }

export function writeTest({ stateDir, test }) {
  const dir = testsDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(testPath(stateDir, test.id), JSON.stringify(test, null, 2));
  return test;
}

export function readTest({ stateDir, id }) {
  const p = testPath(stateDir, id);
  if (!fs.existsSync(p)) return null;
  try { return readJson(p); } catch { return null; }
}

// List tests for a symbol, newest first, WITHOUT the heavy treatment_run_details
// (the list only needs label/totals/delta/status/reason; the expand reads full).
export function listTests({ stateDir, symbol }) {
  const dir = testsDir(stateDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return readJson(path.join(dir, f)); } catch { return null; } })
    .filter(Boolean)
    .filter((t) => !symbol || t.symbol === symbol)
    .map(({ treatment_run_details, ...meta }) => meta)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export function writeTestVerdict({ stateDir, id, status, reason = null }) {
  const test = readTest({ stateDir, id });
  if (!test) return null;
  test.status = status;            // "accepted" | "rejected" | "pending"
  test.reason = reason;
  test.decided_at = new Date().toISOString();
  return writeTest({ stateDir, test });
}

export function deleteTest({ stateDir, id }) {
  const p = testPath(stateDir, id);
  if (fs.existsSync(p)) fs.rmSync(p);
  return { deleted: true };
}

// Fold current code (treatment) over the symbol's corpus and diff against the
// accepted baseline file. corpus_match=false when the folded date/session set
// differs from the baseline's (delta then mixes code + corpus — UI warns).
export async function buildTestArtifact({ stateDir, symbol, label, dates, reason = null, fold = foldSymbol }) {
  const treatment = await fold({ symbol, stateDir, dates });
  const baseline = readBaseline({ stateDir, symbol });
  const tKeys = new Set(treatment.per_day.map((d) => `${d.date}|${d.session}`));
  const basePerDay = baseline?.per_day ?? [];
  const baseKeys = new Set(basePerDay.map((d) => `${d.date}|${d.session}`));
  const basePerDayMatched = basePerDay.filter((d) => tKeys.has(`${d.date}|${d.session}`));
  const baseline_total = round2(basePerDayMatched.reduce((s, d) => s + (Number(d.r) || 0), 0));
  const treatment_total = treatment.total_r;
  const corpus_match = tKeys.size === baseKeys.size && [...tKeys].every((k) => baseKeys.has(k));

  const test = {
    id: `${Date.now()}-${symbolSlug(symbol)}`,
    label: label || "(unlabeled test)",
    symbol,
    created_at: new Date().toISOString(),
    code_sha: treatment.code_sha,
    dates: treatment.corpus.dates,
    baseline_total,
    treatment_total,
    delta: round2(treatment_total - baseline_total),
    corpus_match,
    per_day: diffPerDay(basePerDayMatched, treatment.per_day),
    treatment_run_details: treatment.run_details,
    status: "pending",
    reason,
  };
  return writeTest({ stateDir, test });
}

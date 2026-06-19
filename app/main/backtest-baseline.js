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

// Self-healing brief: recompute payloads from the recorded bundle with CURRENT
// code (no stale baked targets); fall back to recorded payloads; null if a
// tape-only run (re-record it first).
function regen(runDir, session, symbol) {
  let rec = null;
  try { rec = readJson(path.join(runDir, "brief-payloads.json")); } catch { /* regen */ }
  const bp = path.join(runDir, "brief-bundle.json");
  if (!fs.existsSync(bp)) return rec;
  const bundle = readJson(bp);
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
  let total = 0;
  for (const entry of runs) {
    const res = await foldSession(BT, symbol, entry.run_id, entry.date, entry.session);
    if (!res) continue;
    total += res.total_r;
    per_day.push({ date: entry.date, session: entry.session, r: res.total_r });
    run_details.push({
      entry: { date: entry.date, session: entry.session, open_reaction: res.open_reaction },
      setups: res.setups,
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
    reason: null,
  };
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
  const next = await fold({ symbol, stateDir });
  if (reason != null) next.reason = reason;
  if (shouldSnapshot(prev, next)) {
    const history = readHistory({ stateDir, symbol });
    history.push(historyRecord(prev));
    writeHistory({ stateDir, symbol, history });
  }
  writeBaseline({ stateDir, symbol, baseline: next });
  return next;
}

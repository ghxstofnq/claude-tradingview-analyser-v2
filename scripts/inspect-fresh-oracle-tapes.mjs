#!/usr/bin/env node
// Inspect fresh capture-only oracle tapes by rebuilding deterministic brief
// context from the captured engine bundle, then folding each tape through the
// production backtest engine. This does NOT promote oracle truth.
//
// Outputs:
//   state/oracle-fresh-recording/fresh-context-fold-summary.json
//   state/oracle-fresh-recording/fresh-context-fold-summary.md

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { buildBriefDigest } from '../cli/lib/brief-digest.js';
import { computeEngineGates } from '../cli/lib/compute-engine-gates.js';
import { buildDirectSessionBriefPayloads } from '../app/main/direct-session-brief.js';
import { contextFromBriefPayloads } from '../app/main/backtest-context.js';
import { runBacktest } from '../app/main/backtest-engine.js';
import { gradeOpenTrade } from '../app/main/backtest-grader.js';
import { __test as barCloseTruth } from '../app/main/bar-close.js';
import { computeLeader } from '../cli/lib/compute-leader.js';
import { computeSmtLeader } from '../cli/lib/smt-leader.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAPE_DIR = path.join(REPO, 'tests/tapes/fresh-oracle');
const OUT_DIR = path.join(REPO, 'state/oracle-fresh-recording');
const SESSION = 'ny-am';

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function symbolSlugFromTape(tape) {
  return String(tape?.entries?.[0]?.inputs?.leader ?? tape?.entries?.[0]?.inputs?.bundle?.chart?.symbol ?? '')
    .replace(/^[A-Z_]+:/, '') || null;
}
function recomputeGate(bundle) {
  const b = clone(bundle);
  const c = b?.gates?.engine?.confirmation ?? {};
  try {
    const g = computeEngineGates({
      engine: b.engine,
      engineByTf: b.engine_by_tf,
      last: b?.quote?.last,
      lastBar: c.last_bar ?? null,
      lastBarAgeSeconds: c.last_bar_age_seconds ?? 0,
      m5LastBar: c.m5_last_bar ?? null,
      m15LastBar: c.m15_last_bar ?? null,
      quoteTimeMs: Date.now(),
    });
    b.gates = { ...(b.gates || {}), engine: { ...(b.gates?.engine || {}), ...g } };
  } catch (e) {
    b.__recompute_error = e.message;
  }
  return b;
}
function briefPayloadsForTape(tape) {
  const symbol = symbolSlugFromTape(tape);
  const anchorBundle = recomputeGate(tape.entries?.[0]?.inputs?.bundle ?? {});
  const digest = buildBriefDigest(anchorBundle);
  if (!digest?.symbols?.[symbol]) return { symbol, digest, payloads: [], context: null };
  const payloads = buildDirectSessionBriefPayloads({
    session: tape.session ?? SESSION,
    bundle: { ...anchorBundle, brief_digest: digest },
    symbols: [symbol],
  });
  const context = contextFromBriefPayloads({ session: tape.session ?? SESSION, payloads });
  return { symbol, digest, payloads, context };
}
async function foldOne(file) {
  const tape = readJson(file);
  const tapeForFold = clone(tape); // runBacktest mutates entry inputs while folding.
  const { symbol, payloads, context } = briefPayloadsForTape(tapeForFold);
  const surfaced = [];
  const outcomes = [];
  const events = [];
  const bus = new EventEmitter();
  bus.on('backtest:event', (e) => {
    if (e.type === 'setup_surfaced') surfaced.push(e.setup);
    else if (e.type === 'setup_outcome') outcomes.push({ setup_id: e.setupId, outcome: e.outcome, exit: e.exit });
    else if (e.type === 'error') events.push({ type: e.type, message: e.message });
  });
  const deps = {
    recordEntries: async () => ({ entries: tapeForFold.entries, warnings: [] }),
    loadDayContext: async () => null,
    runDirectBrief: async () => context,
    truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs,
    gradeFn: gradeOpenTrade,
  };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-oracle-inspect-'));
  let summary = null;
  try {
    const res = await runBacktest({
      date: tape.date,
      session: tape.session ?? SESSION,
      mode: 'auto',
      symbol,
      bus,
      deps,
      stateDir,
    });
    summary = res.summary;
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
  const p = payloads[0] ?? null;
  return {
    file: path.relative(REPO, file),
    date: tape.date,
    session: tape.session,
    symbol,
    bars: tape.entries?.length ?? 0,
    warnings: Array.isArray(tape.warnings) ? tape.warnings : [],
    tf_keys: Object.keys(tape.entries?.[0]?.inputs?.bundle?.engine_by_tf ?? {}).filter((k) => tape.entries?.[0]?.inputs?.bundle?.engine_by_tf?.[k]),
    brief: p ? {
      pillar_grade: p.pillar_grade ?? null,
      no_trade_reason: p.no_trade_reason ?? null,
      htf_bias_dir: p.htf_bias_dir ?? null,
      h4_struct_dir: p.h4_struct_dir ?? null,
      h1_struct_dir: p.h1_struct_dir ?? null,
      pillar2_verdict: p.pillar2_verdict ?? null,
      primary_draw: p.primary_draw ? {
        tf: p.primary_draw.tf,
        kind: p.primary_draw.kind,
        dir: p.primary_draw.dir,
        top: p.primary_draw.top,
        bottom: p.primary_draw.bottom,
        ce: p.primary_draw.ce,
        state: p.primary_draw.state,
        position: p.primary_draw.position,
        reacted: p.primary_draw.reacted,
        reaction_dir: p.primary_draw.reaction_dir,
        cite: p.primary_draw.cite,
      } : null,
      overnight_block: p.overnight_block ?? null,
    } : null,
    context_built: Boolean(context),
    open_reaction: summary?.open_reaction ?? null,
    chain_status: summary?.chain_status ?? null,
    setups: surfaced,
    outcomes,
    summary: summary ? {
      setups: summary.setups,
      wins: summary.wins,
      losses: summary.losses,
      closed_eod: summary.closed_eod,
      no_trades: summary.no_trades,
      total_r: summary.total_r,
      chain_status: summary.chain_status,
      context_source: summary.context_source,
    } : null,
    review_status: 'unreviewed_not_oracle_truth',
  };
}

const files = fs.readdirSync(TAPE_DIR)
  .filter((f) => f.endsWith('.tape.json'))
  .sort()
  .map((f) => path.join(TAPE_DIR, f));
const rows = [];
for (const file of files) {
  rows.push(await foldOne(file));
}
const byDate = {};
for (const r of rows) {
  byDate[r.date] ??= {};
  const root = /^MES/i.test(r.symbol) ? 'MES' : /^MNQ/i.test(r.symbol) ? 'MNQ' : r.symbol;
  byDate[r.date][root] = r;
}

function loadTapeForRow(row) {
  return row ? readJson(path.join(REPO, row.file)) : null;
}
function engineAtWindowEnd(tape) {
  if (!tape?.entries?.length) return null;
  const windowStartMs = Date.parse(tape.entries[0].event.ts);
  const windowEndMs = windowStartMs + 30 * 60 * 1000;
  let best = null;
  for (const e of tape.entries) {
    if (Date.parse(e.event.ts) <= windowEndMs) best = e;
  }
  return best?.inputs?.bundle?.engine ?? null;
}
function pairLeaderForDate(pair) {
  const mnqTape = loadTapeForRow(pair.MNQ);
  const mesTape = loadTapeForRow(pair.MES);
  if (!mnqTape || !mesTape) return null;
  const windowStartMs = Date.parse(mnqTape.entries[0].event.ts);
  const windowEndMs = windowStartMs + 30 * 60 * 1000;
  const args = {
    primary: 'MNQ1!',
    secondary: 'MES1!',
    primaryEngine: engineAtWindowEnd(mnqTape),
    secondaryEngine: engineAtWindowEnd(mesTape),
    windowStartMs,
    windowEndMs,
  };
  const disp = computeLeader(args);
  const smt = computeSmtLeader({ ...args, context: 'fresh-oracle-inspection' });
  return { displacement: disp, smt };
}
for (const pair of Object.values(byDate)) {
  pair.pair_leader = pairLeaderForDate(pair);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const jsonOut = { generated_at: new Date().toISOString(), tapes: rows.length, by_date: byDate, rows };
fs.writeFileSync(path.join(OUT_DIR, 'fresh-context-fold-summary.json'), `${JSON.stringify(jsonOut, null, 2)}\n`);

const setupLine = (r) => {
  if (!r) return 'MISSING';
  if (!r.context_built) return `context:none (${r.brief?.no_trade_reason ?? 'no_payload'})`;
  if (!r.setups.length) return `no setup · ${r.chain_status}`;
  const s = r.setups[0];
  const o = r.outcomes.find((x) => x.setup_id === s.id);
  return `${s.grade} ${s.model} ${s.side} e=${s.entry} st=${s.stop} tp1=${s.tp1} @ ${s.event_ts}${o ? ` → ${o.outcome} ${o.exit}` : ' → unresolved'}`;
};
const md = [];
md.push('# Fresh oracle context fold summary');
md.push('');
md.push(`Generated: ${jsonOut.generated_at}`);
md.push('');
md.push('These are mechanical folds from fresh capture-only tapes after rebuilding deterministic brief context from each tape anchor. They are review evidence, not approved oracle truth.');
md.push('');
md.push('| Date | Pair leaders | MNQ mechanical fold | MES mechanical fold | Review note |');
md.push('|---|---|---|---|---|');
for (const date of Object.keys(byDate).sort()) {
  const pair = byDate[date];
  const mnq = pair.MNQ;
  const mes = pair.MES;
  const leaders = pair.pair_leader
    ? `disp=${pair.pair_leader.displacement.leader ?? 'null'} (${pair.pair_leader.displacement.reason}); smt=${pair.pair_leader.smt.leader ?? 'null'} (${pair.pair_leader.smt.reason})`
    : 'missing pair';
  const note = [mnq, mes].some((r) => r?.setups?.length) ? 'needs chart/strategy review' : 'candidate no-trade, verify context';
  md.push(`| ${date} | ${leaders.replace(/\|/g, '/')} | ${setupLine(mnq).replace(/\|/g, '/')} | ${setupLine(mes).replace(/\|/g, '/')} | ${note} |`);
}
md.push('');
md.push('## Per-symbol brief context');
for (const r of rows) {
  md.push('');
  md.push(`### ${r.date} ${/^MES/i.test(r.symbol) ? 'MES' : 'MNQ'}`);
  md.push(`- context_built: ${r.context_built}`);
  md.push(`- chain_status: ${r.chain_status}`);
  md.push(`- tape_warnings: ${r.warnings.length}${r.warnings.length ? ` — ${r.warnings.join('; ')}` : ''}`);
  md.push(`- brief: grade=${r.brief?.pillar_grade ?? 'n/a'}, reason=${r.brief?.no_trade_reason ?? 'n/a'}, htf_bias=${r.brief?.htf_bias_dir ?? 'n/a'}, pillar2=${r.brief?.pillar2_verdict ?? 'n/a'}`);
  if (r.brief?.primary_draw) md.push(`- primary_draw: ${r.brief.primary_draw.tf} ${r.brief.primary_draw.dir} ${r.brief.primary_draw.kind} ${r.brief.primary_draw.bottom}-${r.brief.primary_draw.top} CE ${r.brief.primary_draw.ce} (${r.brief.primary_draw.cite})`);
  if (r.open_reaction) md.push(`- open_reaction: ${r.open_reaction.interaction} ${r.open_reaction.level ?? ''} -> ${r.open_reaction.ltf_bias ?? r.open_reaction.bias} ${r.open_reaction.htf_ltf_alignment} cap=${r.open_reaction.grade_cap} at ${r.open_reaction.resolved_at_ts}`);
  md.push(`- fold: ${setupLine(r)}`);
}
fs.writeFileSync(path.join(OUT_DIR, 'fresh-context-fold-summary.md'), `${md.join('\n')}\n`);
console.log(`wrote ${path.relative(REPO, path.join(OUT_DIR, 'fresh-context-fold-summary.json'))}`);
console.log(`wrote ${path.relative(REPO, path.join(OUT_DIR, 'fresh-context-fold-summary.md'))}`);
for (const date of Object.keys(byDate).sort()) {
  console.log(`${date}\n  MNQ: ${setupLine(byDate[date].MNQ)}\n  MES: ${setupLine(byDate[date].MES)}`);
}

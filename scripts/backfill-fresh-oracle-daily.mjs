#!/usr/bin/env node
// Backfill only missing Daily/1D HTF anchors into fresh oracle tapes.
// Does not alter 1m events, 5m/15m tracks, H4, or H1. Default behavior patches
// only tapes where entries[0].inputs.bundle.engine_by_tf.daily is absent.
//
// Usage:
//   node scripts/backfill-fresh-oracle-daily.mjs --dry-run
//   node scripts/backfill-fresh-oracle-daily.mjs
//   node scripts/backfill-fresh-oracle-daily.mjs --only 2026-06-09-mes
//   node scripts/backfill-fresh-oracle-daily.mjs --overwrite   # recapture daily even when present

import fs from 'node:fs';
import path from 'node:path';

import * as replay from '@tvmcp/core/replay';
import * as data from '@tvmcp/core/data';
import { parseIctEngineTable, findIctEngineRows } from '../cli/lib/ict-engine-parser.js';
import { tfMatchesMeta } from '../cli/lib/tf-capture.js';
import { freshChartForReplay } from '../cli/lib/replay-recovery.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TAPE_DIR = path.join(REPO, 'tests/tapes/fresh-oracle');
const LOG_DIR = path.join(REPO, 'state/oracle-fresh-recording');
const dryRun = process.argv.includes('--dry-run');
const overwrite = process.argv.includes('--overwrite');
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const only = arg('only', null)?.toLowerCase() ?? null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bare = (s) => String(s ?? '').replace(/^[A-Z_]+:/, '');

function logLine(line) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  fs.appendFileSync(path.join(LOG_DIR, 'daily-backfill.log'), `${s}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function tapeSymbol(tape) {
  return bare(tape?.entries?.[0]?.inputs?.leader
    ?? tape?.entries?.[0]?.inputs?.bundle?.chart?.symbol
    ?? tape?.entries?.[0]?.inputs?.bundle?.quote?.symbol
    ?? '');
}

function hasDaily(tape) {
  return Boolean(tape?.entries?.[0]?.inputs?.bundle?.engine_by_tf?.daily);
}

function matches(file, tape) {
  if (!only) return true;
  return [path.basename(file), tape?.fixture, tape?.date, tapeSymbol(tape)]
    .some((v) => String(v ?? '').toLowerCase().includes(only));
}

async function captureDaily({ symbol, date, fromEt = '09:30' }) {
  await freshChartForReplay({ leader: symbol, timeframe: 'D' });
  try {
    await replay.start({ date, time: fromEt });
    let last = null;
    for (let i = 0; i < 18; i += 1) {
      const eng = parseIctEngineTable(findIctEngineRows(await data.getPineTables()));
      last = eng;
      if (eng?.schema_supported && tfMatchesMeta('D', eng?.meta?.tf)) {
        return eng;
      }
      await sleep(400);
    }
    throw new Error(`daily engine did not emit D/1D snapshot; last_tf=${last?.meta?.tf ?? 'none'}`);
  } finally {
    try { await replay.stop(); } catch { /* best effort */ }
  }
}

function attachDaily(tape, daily, provenance) {
  const warnings = Array.isArray(tape.warnings) ? tape.warnings : [];
  const entries = (tape.entries ?? []).map((entry) => ({
    ...entry,
    inputs: {
      ...entry.inputs,
      bundle: {
        ...entry.inputs?.bundle,
        engine_by_tf: {
          ...(entry.inputs?.bundle?.engine_by_tf ?? {}),
          daily,
        },
      },
    },
  }));
  return {
    ...tape,
    warnings,
    htf_backfill: {
      ...(tape.htf_backfill ?? {}),
      daily: provenance,
    },
    entries,
  };
}

const files = fs.readdirSync(TAPE_DIR)
  .filter((f) => f.endsWith('.tape.json'))
  .sort()
  .map((f) => path.join(TAPE_DIR, f));

let scanned = 0;
let skipped = 0;
let patched = 0;
let failed = 0;
const failures = [];

logLine(`daily backfill start tapes=${files.length} dryRun=${dryRun} overwrite=${overwrite}${only ? ` only=${only}` : ''}`);

for (const file of files) {
  const tape = readJson(file);
  if (!matches(file, tape)) continue;
  scanned += 1;
  const rel = path.relative(REPO, file);
  const symbol = tapeSymbol(tape);
  const present = hasDaily(tape);
  if (present && !overwrite) {
    skipped += 1;
    logLine(`SKIP ${rel} ${tape.date} ${symbol} daily=present`);
    continue;
  }
  if (!symbol || !tape.date) {
    failed += 1;
    failures.push({ file: rel, error: 'missing date or symbol' });
    logLine(`FAIL ${rel} missing date or symbol`);
    continue;
  }
  logLine(`${dryRun ? 'DRY' : 'RUN'} ${rel} ${tape.date} ${symbol} daily=${present ? 'overwrite' : 'missing'}`);
  if (dryRun) continue;
  try {
    const daily = await captureDaily({ symbol, date: tape.date, fromEt: '09:30' });
    const provenance = {
      status: 'fresh_replay_anchor',
      method: 'daily-only-backfill',
      timeframe: 'D',
      engine_meta_tf: daily?.meta?.tf ?? null,
      engine_emit_ms: daily?.meta?.emit_ms ?? null,
      backfilled_at: new Date().toISOString(),
      source: 'TradingView replay 09:30 ET',
    };
    const patchedTape = attachDaily(tape, daily, provenance);
    writeJsonAtomic(file, patchedTape);
    patched += 1;
    logLine(`OK ${rel} daily_meta_tf=${daily?.meta?.tf ?? 'unknown'} fvgs=${daily?.fvgs?.length ?? 0}`);
  } catch (err) {
    failed += 1;
    const msg = err?.message ?? String(err);
    failures.push({ file: rel, date: tape.date, symbol, error: msg });
    logLine(`FAIL ${rel} ${msg}`);
  } finally {
    try { await freshChartForReplay({ leader: symbol, timeframe: '1' }); } catch { /* best effort */ }
  }
}

const summary = {
  ts: new Date().toISOString(),
  scanned,
  skipped,
  patched,
  failed,
  failures,
};
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(path.join(LOG_DIR, 'daily-backfill-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
logLine(`daily backfill done scanned=${scanned} skipped=${skipped} patched=${patched} failed=${failed}`);
if (failed) process.exit(1);

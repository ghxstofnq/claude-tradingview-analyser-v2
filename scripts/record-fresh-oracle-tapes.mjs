#!/usr/bin/env node
// Fresh oracle recorder — drives TradingView Desktop bar replay via `tv record-tape`
// for a manifest of capture-only MNQ/MES jobs. Outputs are raw evidence tapes,
// not trusted oracle truth. They remain verified:false and outside the normal
// tests/tapes gate until hand-graded + user-approved.
//
// Usage:
//   node scripts/record-fresh-oracle-tapes.mjs --dry-run
//   node scripts/record-fresh-oracle-tapes.mjs --limit 1
//   node scripts/record-fresh-oracle-tapes.mjs --only 2026-06-24
//   node scripts/record-fresh-oracle-tapes.mjs --force-market-hours  # dangerous

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_MANIFEST = path.join(REPO, 'docs/audits/2026-06-30-fresh-oracle-recording-manifest.json');
const LOG_DIR = path.join(REPO, 'state/oracle-fresh-recording');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);
const manifestPath = path.resolve(REPO, arg('manifest', DEFAULT_MANIFEST));
const only = arg('only', null);
const limit = Number(arg('limit', '0')) || 0;
const dryRun = has('dry-run');
const forceMarketHours = has('force-market-hours');
const overwrite = has('overwrite');

function etNowParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

function marketHoursGuard() {
  if (dryRun || forceMarketHours) return;
  const { weekday, hour, minute } = etNowParts();
  const mins = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  if (isWeekday && mins >= 9 * 60 + 25 && mins <= 16 * 60 + 5) {
    throw new Error(`Refusing to drive TradingView during market hours (${weekday} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET). Re-run after 16:05 ET, or pass --force-market-hours only if no live session is active.`);
  }
}

function logLine(line) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  fs.appendFileSync(path.join(LOG_DIR, 'record-fresh-oracle.log'), `${s}\n`);
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: REPO, env: process.env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (b) => { stdout += b.toString(); });
    p.stderr.on('data', (b) => { stderr += b.toString(); });
    p.on('close', (code) => resolve({ code, stdout, stderr }));
    p.on('error', (err) => resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}` }));
  });
}

function jobMatches(job) {
  if (!only) return true;
  const needle = only.toLowerCase();
  return [job.date, job.symbol, job.fixture, job.out, job.label].some((v) => String(v ?? '').toLowerCase().includes(needle));
}

function tapeWarnings(out) {
  try {
    const tape = JSON.parse(fs.readFileSync(out, 'utf8'));
    return Array.isArray(tape.warnings) ? tape.warnings : [];
  } catch {
    return [];
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let jobs = (manifest.jobs ?? []).filter(jobMatches);
if (limit > 0) jobs = jobs.slice(0, limit);
if (!jobs.length) {
  console.error('No manifest jobs matched.');
  process.exit(2);
}

try { marketHoursGuard(); } catch (err) {
  console.error(err.message);
  process.exit(3);
}

logLine(`fresh-oracle recording start jobs=${jobs.length} dryRun=${dryRun} manifest=${path.relative(REPO, manifestPath)}`);
let ok = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < jobs.length; i += 1) {
  const job = jobs[i];
  const out = path.resolve(REPO, job.out);
  const label = path.resolve(REPO, job.label);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = [
    'record-tape',
    '--label', path.relative(REPO, label),
    '--from', job.from ?? manifest.default_window?.from ?? '09:30',
    '--to', job.to ?? manifest.default_window?.to ?? '12:00',
    '--fixture', job.fixture,
    '--out', path.relative(REPO, out),
  ];
  if (fs.existsSync(out) && !overwrite) {
    skipped += 1;
    const warnings = tapeWarnings(out);
    logLine(`[${i + 1}/${jobs.length}] SKIP ${job.date} ${job.symbol} exists ${path.relative(REPO, out)} warnings=${warnings.length} (--overwrite to replace)`);
    continue;
  }
  logLine(`[${i + 1}/${jobs.length}] ${dryRun ? 'DRY' : 'RUN'} ${job.date} ${job.symbol} ${job.from}-${job.to} -> ${path.relative(REPO, out)}`);
  if (dryRun) continue;
  const t0 = Date.now();
  const res = await run('./bin/tv', args);
  const secs = Math.round((Date.now() - t0) / 1000);
  const resultRecord = {
    ts: new Date().toISOString(), job, code: res.code, seconds: secs,
    stdout_tail: res.stdout.slice(-2000), stderr_tail: res.stderr.slice(-2000),
  };
  const warnings = res.code === 0 ? tapeWarnings(out) : [];
  resultRecord.tape_warnings = warnings;
  fs.appendFileSync(path.join(LOG_DIR, 'record-fresh-oracle-results.jsonl'), `${JSON.stringify(resultRecord)}\n`);
  if (res.code === 0) {
    ok += 1;
    logLine(`[${i + 1}/${jobs.length}] OK ${job.date} ${job.symbol} ${secs}s warnings=${warnings.length}`);
  } else {
    failed += 1;
    logLine(`[${i + 1}/${jobs.length}] FAIL ${job.date} ${job.symbol} code=${res.code} ${secs}s stderr=${res.stderr.slice(-300).replace(/\s+/g, ' ')}`);
  }
}

logLine(`fresh-oracle recording done ok=${ok} skipped=${skipped} failed=${failed} dryRun=${dryRun}`);
process.exit(failed ? 1 : 0);

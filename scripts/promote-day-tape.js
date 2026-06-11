#!/usr/bin/env node
/**
 * promote-day-tape.js — freeze a recorded live session into a regression tape.
 *
 * Usage: node scripts/promote-day-tape.js <YYYY-MM-DD> <ny-am|ny-pm|london> [--out <path>]
 *
 * Reads state/session/<date>/<session>/walker-inputs.jsonl (the per-bar
 * detector inputs recorded by bar-close during live operation) and the same
 * folder's deterministic-packets.jsonl (what the chain surfaced that day),
 * and writes tests/tapes/<date>-<session>.tape.json with the expected block
 * prefilled from the day's first surfaced packet.
 *
 * The tape lands with `verified: false` — the tape gate skips it until you
 * hand-check the expectation against the chart (was the packet right? was a
 * no-trade day genuinely no-trade?) and flip the flag. That one-time grading
 * is what turns a recording into a frozen ground truth.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTapeFromRecords } from '../cli/lib/day-tape.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJsonl(p) {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function main() {
  const [date, session] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!date || !session) {
    console.error('usage: node scripts/promote-day-tape.js <YYYY-MM-DD> <ny-am|ny-pm|london> [--out <path>]');
    process.exit(1);
  }
  const outIdx = process.argv.indexOf('--out');
  const sessionDir = path.join(REPO_ROOT, 'state', 'session', date, session);
  const records = readJsonl(path.join(sessionDir, 'walker-inputs.jsonl'));
  if (records.length === 0) {
    console.error(`no walker-inputs.jsonl records under ${sessionDir} — was the live loop running that session?`);
    process.exit(1);
  }
  const packets = readJsonl(path.join(sessionDir, 'deterministic-packets.jsonl'));
  const fixture = `${date}-${session}`;
  const tape = buildTapeFromRecords(records, { fixture, date, session, packets });
  const out = outIdx > -1 ? process.argv[outIdx + 1] : path.join(REPO_ROOT, 'tests', 'tapes', `${fixture}.tape.json`);
  writeFileSync(out, `${JSON.stringify(tape, null, 2)}\n`, 'utf8');
  console.log(`wrote ${out}`);
  console.log(`  bars: ${tape.entries.length}`);
  console.log(`  prefilled expected: ${JSON.stringify(tape.expected)}`);
  console.log('  verified: false — hand-check the expectation against the chart, then flip to true to arm the gate.');
}

main();

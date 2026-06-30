#!/usr/bin/env node
// Fold fresh capture-only oracle tapes through the current production truth fn and
// print a monitoring summary. This is NOT oracle approval; it is a mechanical
// health/readout pass over newly recorded evidence.
//
// Usage:
//   node scripts/fold-fresh-oracle-tapes.mjs
//   node scripts/fold-fresh-oracle-tapes.mjs tests/tapes/fresh-oracle/2026-06-24-mnq-ny-am-replay.tape.json

import fs from 'node:fs';
import path from 'node:path';
import { foldTape } from '../cli/lib/day-tape.js';
import { __test as barCloseTruth } from '../app/main/bar-close.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const inputs = process.argv.slice(2);
const paths = inputs.length
  ? inputs.map((p) => path.resolve(REPO, p))
  : fs.existsSync(path.join(REPO, 'tests/tapes/fresh-oracle'))
    ? fs.readdirSync(path.join(REPO, 'tests/tapes/fresh-oracle'))
      .filter((f) => f.endsWith('.tape.json'))
      .sort()
      .map((f) => path.join(REPO, 'tests/tapes/fresh-oracle', f))
    : [];

if (!paths.length) {
  console.log('No fresh oracle tapes found under tests/tapes/fresh-oracle/.');
  process.exit(0);
}

const rows = [];
for (const p of paths) {
  const tape = JSON.parse(fs.readFileSync(p, 'utf8'));
  const outcome = await foldTape(tape, { truthFn: barCloseTruth.buildDeterministicPacketTruthFromInputs });
  rows.push({
    file: path.relative(REPO, p),
    fixture: tape.fixture,
    date: tape.date,
    session: tape.session,
    verified: tape.verified,
    expected_outcome: tape.expected?.outcome ?? null,
    bars: outcome.bars,
    packets: outcome.packets.length,
    distinct: outcome.distinctPacketIds,
    firstPacket: outcome.firstPacket,
    firstPacketEventTs: outcome.firstPacketEventTs,
    verdictCounts: outcome.verdictCounts,
  });
}

for (const r of rows) {
  console.log(`\n${r.file}`);
  console.log(`  ${r.date} ${r.session} fixture=${r.fixture} verified=${r.verified} expected=${r.expected_outcome}`);
  console.log(`  bars=${r.bars} packets=${r.packets} distinct=${JSON.stringify(r.distinct)} verdicts=${JSON.stringify(r.verdictCounts)}`);
  if (r.firstPacket) console.log(`  first=${JSON.stringify(r.firstPacket)} @ ${r.firstPacketEventTs}`);
}

console.log(`\n=== fresh oracle fold summary: ${rows.length} tape(s), ${rows.reduce((n, r) => n + (r.firstPacket ? 1 : 0), 0)} with packets ===`);

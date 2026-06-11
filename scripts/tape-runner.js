#!/usr/bin/env node
/**
 * tape-runner.js — replay every verified day tape through the REAL
 * deterministic chain and print the accuracy report.
 *
 * Usage: node scripts/tape-runner.js [tapes-dir]   (default tests/tapes)
 * The same run is enforced as a hard gate in tests/day-tape.test.js.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTapesFromDir, formatTapeRunReport } from '../cli/lib/day-tape.js';
import { __test } from '../app/main/bar-close.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const dir = process.argv[2] ?? path.join(REPO_ROOT, 'tests', 'tapes');
  const run = await runTapesFromDir(dir, { truthFn: __test.buildDeterministicPacketTruthFromInputs });
  console.log(formatTapeRunReport(run));
  process.exit(run.ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });

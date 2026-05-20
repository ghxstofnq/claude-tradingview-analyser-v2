#!/usr/bin/env node
/**
 * judge-report.js — tallies the /judge slash command's categorical
 * verdicts into a per-dimension agreement report.
 *
 * Reads tests/fixtures/*.judge.json (written by /judge). Each file:
 *   { "fixture": "001-current",
 *     "dimensions": { "grade": "agree", "htf_bias": "partial", ... } }
 * verdict ∈ { agree, partial, disagree }.
 *
 * Usage: npm run judge:report   (or: node scripts/judge-report.js)
 * Exit code: 0 always (informational).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = 'tests/fixtures';

/** Count verdicts per dimension across all judge results. */
export function tally(judgeResults) {
  const dims = {};
  for (const r of judgeResults) {
    for (const [dim, verdict] of Object.entries(r?.dimensions || {})) {
      dims[dim] ??= { agree: 0, partial: 0, disagree: 0 };
      if (verdict in dims[dim]) dims[dim][verdict]++;
    }
  }
  return dims;
}

/** Agreement % for one dimension's counts; partial = half credit. null if empty. */
export function agreementPct(counts) {
  const total = counts.agree + counts.partial + counts.disagree;
  if (total === 0) return null;
  return Math.round(((counts.agree + counts.partial * 0.5) / total) * 100);
}

function main() {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.judge.json'));
  if (files.length === 0) {
    console.error('no *.judge.json files — run /judge first');
    process.exit(0);
  }
  const results = files.map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')));
  const dims = tally(results);
  console.log(`Judge report — ${results.length} fixture(s)\n`);
  for (const [dim, counts] of Object.entries(dims)) {
    console.log(`  ${dim.padEnd(22)} ${agreementPct(counts)}%  ` +
      `(agree ${counts.agree} / partial ${counts.partial} / disagree ${counts.disagree})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

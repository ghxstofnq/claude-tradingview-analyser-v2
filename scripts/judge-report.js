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

export function replayAccuracyReport(cases) {
  const report = {
    total: 0,
    correct_trades: 0,
    correct_no_trades: 0,
    false_candidates: 0,
    missed_valid_setups: 0,
    wrong_model: 0,
    wrong_side: 0,
    mismatches: [],
  };

  for (const c of cases ?? []) {
    report.total += 1;
    const expected = c.expected ?? c.expectedOutcome ?? {};
    const actual = c.actual ?? c.actualOutcome ?? c.actualResult ?? {};
    const expectedTrade = expected.outcome === 'trade' || expected.outcome === 'manual_candidate';
    const actualTrade = actual.outcome === 'trade' || actual.outcome === 'manual_candidate' || actual.best_candidate != null;
    const actualModel = actual.model ?? actual.best_candidate?.model;
    const actualSide = actual.side ?? actual.best_candidate?.side;

    if (!expectedTrade && actualTrade) {
      report.false_candidates += 1;
      report.mismatches.push({ fixture: c.fixture, type: 'false_candidate', expected, actual });
      continue;
    }
    if (expectedTrade && !actualTrade) {
      report.missed_valid_setups += 1;
      report.mismatches.push({ fixture: c.fixture, type: 'missed_valid_setup', expected, actual });
      continue;
    }
    if (!expectedTrade && !actualTrade) {
      report.correct_no_trades += 1;
      continue;
    }

    if (expected.model && actualModel !== expected.model) {
      report.wrong_model += 1;
      report.mismatches.push({ fixture: c.fixture, type: 'wrong_model', expected, actual });
      continue;
    }
    if (expected.side && actualSide !== expected.side) {
      report.wrong_side += 1;
      report.mismatches.push({ fixture: c.fixture, type: 'wrong_side', expected, actual });
      continue;
    }
    report.correct_trades += 1;
  }
  return report;
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

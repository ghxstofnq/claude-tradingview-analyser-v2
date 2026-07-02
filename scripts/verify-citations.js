#!/usr/bin/env node

/**
 * verify-citations.js — verifies every cited price in a /analyze output
 * appears at the cited JSON path in the corresponding tv analyze bundle.
 *
 * Enforces CLAUDE.md hard constraint #6 (cite-or-reject).
 *
 * Citation syntax expected in the analysis: <price> (<json.path>)
 * Examples:  29172.75 (quote.last)
 *            29340.25 (bars.high)
 *            29302.75 (pine.labels.studies[0].labels[0].price)
 *
 * Usage: node scripts/verify-citations.js <analysis.md> <bundle.json>
 *
 * Exit codes: 0 = all citations valid, 1 = violations, 2 = usage / I/O error.
 */

import { readFileSync } from 'node:fs';
import { verifyCitations } from '../cli/lib/cite-check.js';

function fail(msg, code = 2) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

const [, , analysisPath, bundlePath] = process.argv;
if (!analysisPath || !bundlePath) {
  fail('usage: verify-citations.js <analysis.md> <bundle.json>');
}

let analysis, bundle;
try { analysis = readFileSync(analysisPath, 'utf8'); }
catch (e) { fail(`could not read analysis: ${e.message}`); }
try { bundle = JSON.parse(readFileSync(bundlePath, 'utf8')); }
catch (e) { fail(`could not parse bundle: ${e.message}`); }

// Shared resolver (cli/lib/cite-check.js) — same logic used by the live
// surface-time check so the two can never drift (audit C29).
const { violations, checked } = verifyCitations(analysis, bundle);

if (violations.length === 0 && checked.length === 0) {
  console.warn(
    `warning: no citations found in ${analysisPath}. Either no prices were cited, or the syntax does not match '<price> (<path>)'.`,
  );
}

if (violations.length > 0) {
  console.error(`FAIL: ${violations.length} citation violation(s) in ${analysisPath}:`);
  for (const v of violations) {
    console.error(`  - ${v.cited} (${v.path}) — ${v.reason}`);
  }
  process.exit(1);
}

console.log(`OK: ${checked.length} citation(s) verified in ${analysisPath}`);
process.exit(0);

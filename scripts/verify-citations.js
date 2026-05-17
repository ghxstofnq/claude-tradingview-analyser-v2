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

function fail(msg, code = 2) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

function getByPath(obj, path) {
  // Split 'pine.boxes.studies[0].zones[3].high' into tokens.
  const tokens = path.split(/\.|\[(\d+)\]/).filter((t) => t !== undefined && t !== '');
  let cur = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = /^\d+$/.test(t) ? cur[Number(t)] : cur[t];
  }
  return cur;
}

function approxEqual(a, b) {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-4;
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

// Match citation pairs: <number> (<path>)
// number: optional minus, digits with optional decimal
// path: paren-balanced, no nested parens (good enough for our syntax)
const cite = /(-?\d+(?:\.\d+)?)\s*\(([^)\n]+)\)/g;

const violations = [];
const checked = [];
let match;
while ((match = cite.exec(analysis)) !== null) {
  const cited = Number(match[1]);
  const path = match[2].trim();

  // Skip non-citation parentheticals (paths must look like a JSON accessor).
  // Allowed: letters/underscore start, then word chars, dots, brackets, digits.
  if (!/^[a-zA-Z_][\w.[\]]*$/.test(path)) continue;

  const actual = getByPath(bundle, path);
  if (actual === undefined) {
    violations.push({ cited, path, reason: 'path not present in bundle' });
  } else if (typeof actual !== 'number') {
    const preview = JSON.stringify(actual);
    violations.push({
      cited,
      path,
      reason: `path resolves to non-number (${typeof actual}: ${preview && preview.length > 60 ? preview.slice(0, 60) + '…' : preview})`,
    });
  } else if (!approxEqual(cited, actual)) {
    violations.push({ cited, path, reason: `bundle has ${actual}` });
  } else {
    checked.push({ cited, path });
  }
}

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

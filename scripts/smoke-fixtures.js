#!/usr/bin/env node

/**
 * smoke-fixtures.js — schema and citation checks across all fixtures
 * in tests/fixtures/. Run before any change to /analyze, tv analyze,
 * or the slash command rules.
 *
 * Usage: npm run smoke:fixtures   (or: node scripts/smoke-fixtures.js)
 *
 * Exit codes: 0 = all checks pass, 1 = one or more failures, 2 = no fixtures.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const FIXTURES = 'tests/fixtures';
const REQUIRED_TOP = ['timestamp', 'chart', 'visible_range', 'quote', 'bars', 'indicators', 'pine', 'gates'];
const REQUIRED_NESTED = {
  chart: ['symbol', 'resolution', 'chartType', 'studies'],
  quote: ['last', 'time'],
  bars: ['bar_count', 'period', 'range', 'last_5_bars'],
  pine: ['lines', 'labels', 'tables', 'boxes'],
  gates: ['session', 'price_context', 'pillar2'],
};

const bundles = readdirSync(FIXTURES).filter((f) => f.endsWith('.bundle.json')).sort();
if (bundles.length === 0) {
  console.error(`error: no fixtures found in ${FIXTURES}/`);
  process.exit(2);
}

let totalChecks = 0;
let failed = 0;

for (const f of bundles) {
  const bundlePath = join(FIXTURES, f);
  const base = bundlePath.replace(/\.bundle\.json$/, '');
  const expectedPath = `${base}.expected.md`;
  console.log(`\n== ${basename(base)} ==`);

  // Schema check
  totalChecks++;
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  } catch (e) {
    console.error(`  SCHEMA FAIL: invalid JSON: ${e.message}`);
    failed++;
    continue;
  }
  const missingTop = REQUIRED_TOP.filter((k) => !(k in bundle));
  if (missingTop.length) {
    console.error(`  SCHEMA FAIL: missing top-level keys: ${missingTop.join(', ')}`);
    failed++;
    continue;
  }
  let nestedFail = false;
  for (const [parent, children] of Object.entries(REQUIRED_NESTED)) {
    const subMissing = children.filter((k) => !(bundle[parent] && k in bundle[parent]));
    if (subMissing.length) {
      console.error(`  SCHEMA FAIL: ${parent} missing children: ${subMissing.join(', ')}`);
      nestedFail = true;
    }
  }
  if (nestedFail) {
    failed++;
    continue;
  }
  console.log('  schema OK');

  // Citation check (only if a paired analysis exists)
  if (!existsSync(expectedPath)) {
    console.log('  (no paired analysis; skipping citation check)');
    continue;
  }
  totalChecks++;
  const res = spawnSync('node', ['scripts/verify-citations.js', expectedPath, bundlePath], { encoding: 'utf8' });
  if (res.status === 0) {
    console.log(`  citations: ${res.stdout.trim()}`);
  } else {
    console.error(`  citations FAIL:`);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.stdout) process.stdout.write(res.stdout);
    failed++;
  }
}

const passed = totalChecks - failed;
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed}/${totalChecks} checks across ${bundles.length} fixture(s)`);
process.exit(failed === 0 ? 0 : 1);

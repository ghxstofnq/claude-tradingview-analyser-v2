#!/usr/bin/env node
/**
 * fixture-coverage.js — reports which target coverage cells the fixture
 * corpus fills, and which are still empty.
 *
 * Usage: npm run fixture:coverage   (or: node scripts/fixture-coverage.js)
 *
 * Target cells (tests/fixtures/README.md "When to grow the corpus"):
 *   NY-open window × {A+, B, no-trade};  outside-NY (any);
 *   A+ per entry model × {MSS, Trend, Inversion}.
 *
 * Exit code: 0 always (informational).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = 'tests/fixtures';

/** Extract and parse the trailing ```json fenced block of an expected.md. */
export function parseStructuredBlock(mdText) {
  const m = String(mdText).match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Grade enum from the structured block; null if absent/invalid. */
export function fixtureGrade(structured) {
  const g = structured?.grade;
  return g === 'A+' || g === 'B' || g === 'no-trade' ? g : null;
}

/** Entry model from the structured block; null if no model in play. */
export function fixtureEntryModel(structured) {
  const m = structured?.pillar3?.entry_model;
  return m === 'MSS' || m === 'Trend' || m === 'Inversion' ? m : null;
}

/** Session bucket from the bundle's gates. */
export function sessionBucket(bundle) {
  const s = bundle?.gates?.session;
  if (!s) return 'unknown';
  return s.in_ny_open_window === true ? 'ny_open' : 'outside_ny';
}

function main() {
  const bundles = readdirSync(FIXTURES).filter((f) => f.endsWith('.bundle.json')).sort();
  const rows = bundles.map((b) => {
    const base = b.replace(/\.bundle\.json$/, '');
    const expectedPath = join(FIXTURES, `${base}.expected.md`);
    let bundle = null;
    try { bundle = JSON.parse(readFileSync(join(FIXTURES, b), 'utf8')); } catch {}
    const structured = existsSync(expectedPath)
      ? parseStructuredBlock(readFileSync(expectedPath, 'utf8'))
      : null;
    return {
      name: base,
      session: bundle ? sessionBucket(bundle) : 'unknown',
      grade: fixtureGrade(structured),
      model: fixtureEntryModel(structured),
    };
  });

  const cells = [
    { id: 'ny_open + A+',       hit: (r) => r.session === 'ny_open' && r.grade === 'A+' },
    { id: 'ny_open + B',        hit: (r) => r.session === 'ny_open' && r.grade === 'B' },
    { id: 'ny_open + no-trade', hit: (r) => r.session === 'ny_open' && r.grade === 'no-trade' },
    { id: 'outside_ny (any)',   hit: (r) => r.session === 'outside_ny' },
    { id: 'A+ MSS',             hit: (r) => r.grade === 'A+' && r.model === 'MSS' },
    { id: 'A+ Trend',           hit: (r) => r.grade === 'A+' && r.model === 'Trend' },
    { id: 'A+ Inversion',       hit: (r) => r.grade === 'A+' && r.model === 'Inversion' },
  ];

  console.log(`Fixture corpus: ${rows.length} fixture(s) (target ~10)\n`);
  for (const r of rows) {
    console.log(`  ${r.name}  [${r.session}]  grade=${r.grade ?? '—'}  model=${r.model ?? '—'}`);
  }
  console.log('\nCoverage cells:');
  let filled = 0;
  for (const c of cells) {
    const hits = rows.filter(c.hit).length;
    if (hits > 0) filled++;
    console.log(`  ${hits > 0 ? '[x]' : '[ ]'} ${c.id}  (${hits})`);
  }
  console.log(`\n${filled}/${cells.length} target cells filled.`);
}

// Run main() only when invoked directly, so tests can import the helpers.
if (import.meta.url === `file://${process.argv[1]}`) main();

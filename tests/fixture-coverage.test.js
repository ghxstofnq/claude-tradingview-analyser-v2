import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStructuredBlock, fixtureGrade, fixtureEntryModel, sessionBucket,
} from '../scripts/fixture-coverage.js';
import { nextFixtureId } from '../scripts/new-fixture.js';

test('parseStructuredBlock extracts the trailing json block', () => {
  const md = 'prose\n\n```json\n{"grade":"A+"}\n```\n';
  assert.deepEqual(parseStructuredBlock(md), { grade: 'A+' });
});

test('parseStructuredBlock returns null when there is no block', () => {
  assert.equal(parseStructuredBlock('no json here'), null);
});

test('fixtureGrade reads the grade enum, rejects anything else', () => {
  assert.equal(fixtureGrade({ grade: 'no-trade' }), 'no-trade');
  assert.equal(fixtureGrade({ grade: 'bogus' }), null);
  assert.equal(fixtureGrade(null), null);
});

test('fixtureEntryModel reads pillar3.entry_model', () => {
  assert.equal(fixtureEntryModel({ pillar3: { entry_model: 'MSS' } }), 'MSS');
  assert.equal(fixtureEntryModel({ pillar3: { entry_model: null } }), null);
});

test('sessionBucket buckets by in_ny_open_window', () => {
  assert.equal(sessionBucket({ gates: { session: { in_ny_open_window: true } } }), 'ny_open');
  assert.equal(sessionBucket({ gates: { session: { in_ny_open_window: false } } }), 'outside_ny');
  assert.equal(sessionBucket({}), 'unknown');
});

test('nextFixtureId returns the next zero-padded id', () => {
  assert.equal(nextFixtureId(['001-current.bundle.json', '001-current.expected.md']), '002');
  assert.equal(nextFixtureId([]), '001');
  assert.equal(nextFixtureId(['007-x.bundle.json', '003-y.bundle.json']), '008');
});

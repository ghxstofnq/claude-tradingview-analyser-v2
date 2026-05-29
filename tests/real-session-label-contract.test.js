import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REAL_SESSION_LABEL_DIR = new URL('./fixtures/real-sessions/', import.meta.url);

function readLabel(name) {
  return JSON.parse(readFileSync(new URL(name, REAL_SESSION_LABEL_DIR), 'utf8'));
}

test('GXNQ label 2026-05-29 MNQ inversion long is captured as a replay-ready real-session contract', () => {
  const label = readLabel('2026-05-29-mnq-ny-am-inversion-long.label.json');

  assert.equal(label.schema, 'gxofnq.real-session-label.v1');
  assert.equal(label.fixture, '2026-05-29-mnq-ny-am-inversion-long');
  assert.equal(label.fixtureSource, 'real');
  assert.equal(label.label_status, 'labeled');
  assert.equal(label.reviewer, 'GXNQ');
  assert.equal(label.symbol, 'MNQ');
  assert.equal(label.contract_hint, 'CME_MINI:MNQ1!');
  assert.equal(label.trade_date, '2026-05-29');
  assert.equal(label.session, 'NY AM');

  assert.deepEqual(label.expected, {
    outcome: 'trade',
    model: 'Inversion',
    side: 'long',
    entry_time_et: '2026-05-29T10:48:00-04:00',
    stop_anchor_time_et: '2026-05-29T10:45:00-04:00',
    stop_anchor: 'low_of_10:45_candle',
    tp1: 30437.5,
  });

  assert.ok(label.evidence_requirements.includes('bundle must include 10:45 ET candle low for stop validation'));
  assert.ok(label.evidence_requirements.includes('bundle must include 10:48 ET confirmation candle for entry validation'));
  assert.ok(label.evidence_requirements.includes('bundle must prove TP1 30437.50 is untaken liquidity at entry time'));
  assert.equal(label.replay.bundlePath, null);
  assert.equal(label.replay.ready, false);
});

test('real-session labels are strict enough to prevent ambiguous tradable fixtures', () => {
  for (const file of readdirSync(REAL_SESSION_LABEL_DIR).filter((f) => f.endsWith('.label.json'))) {
    const label = readLabel(file);
    assert.equal(label.schema, 'gxofnq.real-session-label.v1', `${file}: schema`);
    assert.equal(label.fixtureSource, 'real', `${file}: fixtureSource`);
    assert.ok(label.fixture, `${file}: fixture`);
    assert.ok(label.reviewer, `${file}: reviewer`);
    assert.ok(label.trade_date, `${file}: trade_date`);
    assert.ok(label.symbol, `${file}: symbol`);
    assert.ok(label.session, `${file}: session`);
    assert.ok(['labeled', 'needs_gxofnq_review'].includes(label.label_status), `${file}: label_status`);

    if (label.expected?.outcome === 'trade') {
      assert.ok(['MSS', 'Trend', 'Inversion'].includes(label.expected.model), `${file}: model`);
      assert.ok(['long', 'short'].includes(label.expected.side), `${file}: side`);
      assert.match(label.expected.entry_time_et, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-04:00$/, `${file}: entry_time_et`);
      assert.equal(typeof label.expected.tp1, 'number', `${file}: tp1`);
      assert.ok(label.expected.stop_anchor || label.expected.stop, `${file}: stop anchor/price`);
    }
  }
});

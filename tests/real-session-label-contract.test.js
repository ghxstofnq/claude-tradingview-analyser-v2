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
  assert.equal(label.replay.bundlePath, '2026-05-29-mnq-ny-am-inversion-long.asof-1048.bundle.json');
  assert.equal(label.replay.ready, true);
  const bundle = readLabel(label.replay.bundlePath);
  assert.equal(bundle.schema, 'gxofnq.replay-capture.v1');
  assert.equal(bundle.validation?.ok, true);
  assert.ok(bundle.bars_by_tf?.m1?.bars?.some((b) => b.time === 1780065900), 'bundle has 10:45 ET stop anchor candle');
  assert.ok(bundle.bars_by_tf?.m1?.bars?.some((b) => b.time === 1780066080), 'bundle has 10:48 ET entry candle');
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

test('trade labels declare a no-lookahead replay readiness contract before they can be scored', () => {
  for (const file of readdirSync(REAL_SESSION_LABEL_DIR).filter((f) => f.endsWith('.label.json'))) {
    const label = readLabel(file);
    if (label.expected?.outcome !== 'trade') continue;

    if (label.replay?.ready) {
      assert.match(label.replay?.bundlePath, /\.bundle\.json$/, `${file}: ready labels must point at a bundle`);
      const bundle = readLabel(label.replay.bundlePath);
      assert.equal(bundle.validation?.ok, true, `${file}: ready bundle validation`);
    } else {
      assert.equal(label.replay?.bundlePath, null, `${file}: bundlePath must remain null until captured`);
      assert.ok(label.replay?.reason_not_ready, `${file}: not-ready labels must explain blocker`);
    }
    assert.match(label.replay?.as_of_et, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-04:00$/, `${file}: as_of_et`);
    assert.match(label.replay?.as_of_utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/, `${file}: as_of_utc`);
    assert.deepEqual(label.replay?.required_candles, [
      { tf: '1m', time_et: label.expected.stop_anchor_time_et, purpose: 'stop_anchor' },
      { tf: '1m', time_et: label.expected.entry_time_et, purpose: 'entry_confirmation' },
    ], `${file}: required candles`);
    assert.deepEqual(label.replay?.required_timeframes, {
      premarket_context: ['D1', 'H4', 'H1', '15M', '5M'],
      entry_window: ['15M', '5M', '1M'],
    }, `${file}: required_timeframes`);
    assert.deepEqual(label.replay?.capture_window_et, {
      context_start: `${label.trade_date}T09:30:00-04:00`,
      entry_window_end: `${label.trade_date}T12:00:00-04:00`,
      as_of: label.expected.entry_time_et,
    }, `${file}: capture_window_et`);
    assert.ok(label.replay?.readiness_checks?.includes('no bars after as_of may be used for entry decision'), `${file}: no-lookahead check`);
    assert.ok(label.replay?.readiness_checks?.includes('TP1 must cite untaken liquidity existing before/as-of entry'), `${file}: TP1 check`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildReplayCapturePlan,
  validateReplayCaptureBundle,
  captureReplayBundle,
  writeReplayBundleAtomic,
} from '../cli/lib/real-session-replay-capture.js';

const label = {
  fixture: '2026-05-29-mnq-ny-am-inversion-long',
  trade_date: '2026-05-29',
  symbol: 'MNQ',
  contract_hint: 'CME_MINI:MNQ1!',
  expected: {
    entry_time_et: '2026-05-29T10:48:00-04:00',
    stop_anchor_time_et: '2026-05-29T10:45:00-04:00',
  },
  replay: {
    capture_window_et: {
      context_start: '2026-05-29T09:30:00-04:00',
      entry_window_end: '2026-05-29T12:00:00-04:00',
      as_of: '2026-05-29T10:48:00-04:00',
    },
  },
};

function bar(time, open = 1) {
  return { time, open, high: open + 1, low: open - 1, close: open + 0.5, volume: 10 };
}

function goodTfBars(plan, key) {
  const pull = plan.pulls.find((p) => p.key === key);
  const bars = [
    bar(pull.from_utc_unix, 100),
    bar(Math.min(pull.to_utc_unix, plan.as_of_utc_unix), 101),
    bar(pull.to_utc_unix, 102),
  ];
  if (key === 'm1') {
    bars.splice(1, 0, bar(1780065900, 100.5));
  }
  return { success: true, bars };
}

test('buildReplayCapturePlan creates GXNQ context and entry-window TF pulls', () => {
  const plan = buildReplayCapturePlan({ label });

  assert.equal(plan.symbol, 'CME_MINI:MNQ1!');
  assert.equal(plan.trade_date, '2026-05-29');
  assert.equal(plan.context_start_et, '2026-05-29T09:30:00-04:00');
  assert.equal(plan.entry_window_end_et, '2026-05-29T12:00:00-04:00');
  assert.equal(plan.as_of_et, '2026-05-29T10:48:00-04:00');
  assert.equal(plan.as_of_utc, '2026-05-29T14:48:00Z');

  assert.deepEqual(plan.context_timeframes.map((tf) => tf.label), ['D1', 'H4', 'H1', '15M', '5M']);
  assert.deepEqual(plan.entry_timeframes.map((tf) => tf.label), ['15M', '5M', '1M']);
  assert.deepEqual(plan.pulls.map((p) => `${p.role}:${p.key}:${p.tv_resolution}`), [
    'context:daily:D',
    'context:h4:240',
    'context:h1:60',
    'context:m15:15',
    'context:m5:5',
    'entry_window:m15:15',
    'entry_window:m5:5',
    'entry_window:m1:1',
  ]);
});

test('validateReplayCaptureBundle fails closed on missing required TFs, missing candles, and lookahead in as-of decision data', () => {
  const plan = buildReplayCapturePlan({ label });
  const incomplete = { plan, bars_by_tf: { m1: { bars: [bar(1780065840)] } }, engine_by_tf: {} };

  const invalid = validateReplayCaptureBundle(incomplete, plan);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.blockers.includes('missing bars_by_tf.daily'));
  assert.ok(invalid.blockers.includes('missing engine_by_tf.m1'));
  assert.ok(invalid.blockers.includes('missing required 1m stop_anchor candle at 2026-05-29T14:45:00Z'));
  assert.ok(invalid.blockers.includes('missing required 1m entry_confirmation candle at 2026-05-29T14:48:00Z'));

  const withLookahead = {
    plan,
    bars_by_tf: {
      daily: goodTfBars(plan, 'daily'),
      h4: goodTfBars(plan, 'h4'),
      h1: goodTfBars(plan, 'h1'),
      m15: goodTfBars(plan, 'm15'),
      m5: goodTfBars(plan, 'm5'),
      m1: { success: true, bars: [bar(1780065900), bar(1780066080), bar(1780066140)] },
    },
    decision_bars_by_tf: { m1: { success: true, bars: [bar(1780065900), bar(1780066080), bar(1780066140)] } },
    engine_by_tf: {
      daily: { meta: { schema: 2 } }, h4: { meta: { schema: 2 } }, h1: { meta: { schema: 2 } },
      m15: { meta: { schema: 2 } }, m5: { meta: { schema: 2 } }, m1: { meta: { schema: 2 } },
    },
  };
  const lookahead = validateReplayCaptureBundle(withLookahead, plan);
  assert.equal(lookahead.ok, false);
  assert.ok(lookahead.blockers.includes('decision_bars_by_tf.m1 contains lookahead bar after as_of 2026-05-29T14:48:00Z'));
});

test('captureReplayBundle uses adapter to pull all requested TFs and builds no-lookahead decision bars', async () => {
  const calls = [];
  const plan = buildReplayCapturePlan({ label });
  const adapter = {
    async setSymbol(symbol) { calls.push(['symbol', symbol]); },
    async captureTimeframe(pull) {
      calls.push(['tf', pull.role, pull.key, pull.tv_resolution]);
      return { bars: goodTfBars(plan, pull.key), engine: { meta: { schema: 2 }, tf: pull.key } };
    },
  };

  const bundle = await captureReplayBundle({ label, adapter });
  assert.deepEqual(calls.slice(0, 2), [['symbol', 'CME_MINI:MNQ1!'], ['tf', 'context', 'daily', 'D']]);
  assert.equal(calls.filter((c) => c[0] === 'tf').length, 8);
  assert.equal(bundle.schema, 'gxofnq.replay-capture.v1');
  assert.equal(bundle.validation.ok, true);
  assert.equal(bundle.bars_by_tf.m1.bars.at(-1).time, plan.entry_window_end_utc_unix);
  assert.equal(bundle.decision_bars_by_tf.m1.bars.at(-1).time, plan.as_of_utc_unix);
});

test('writeReplayBundleAtomic writes bundle JSON and refuses invalid bundles unless forced', () => {
  const plan = buildReplayCapturePlan({ label });
  const dir = mkdtempSync(join(tmpdir(), 'gxofnq-replay-capture-'));
  const out = join(dir, 'bundle.json');
  const bundle = {
    schema: 'gxofnq.replay-capture.v1',
    plan,
    bars_by_tf: {
      daily: goodTfBars(plan, 'daily'), h4: goodTfBars(plan, 'h4'), h1: goodTfBars(plan, 'h1'),
      m15: goodTfBars(plan, 'm15'), m5: goodTfBars(plan, 'm5'),
      m1: { success: true, bars: [bar(1780065900), bar(1780066080), bar(plan.entry_window_end_utc_unix)] },
    },
    decision_bars_by_tf: { m1: { success: true, bars: [bar(1780065900), bar(1780066080)] } },
    engine_by_tf: {
      daily: { meta: { schema: 2 } }, h4: { meta: { schema: 2 } }, h1: { meta: { schema: 2 } },
      m15: { meta: { schema: 2 } }, m5: { meta: { schema: 2 } }, m1: { meta: { schema: 2 } },
    },
  };

  const res = writeReplayBundleAtomic(out, bundle, plan);
  assert.equal(res.success, true);
  const written = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(written.validation.ok, true);

  assert.throws(
    () => writeReplayBundleAtomic(join(dir, 'bad.json'), { ...bundle, bars_by_tf: {} }, plan),
    /Replay capture bundle is not ready/,
  );
});

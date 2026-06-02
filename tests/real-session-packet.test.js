import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRealSessionExecutionPacket } from '../cli/lib/real-session-packet.js';
import { runReplayCasesFromDir } from '../scripts/replay-runner.js';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

const label = {
  fixture: 'gx-real',
  trade_date: '2026-05-29',
  symbol: 'MNQ',
  expected: {
    outcome: 'trade',
    model: 'Inversion',
    side: 'long',
    entry_time_et: '2026-05-29T10:48:00-04:00',
    stop_anchor_time_et: '2026-05-29T10:45:00-04:00',
    stop_anchor: 'low_of_10:45_candle',
    tp1: 30437.5,
  },
  replay: { ready: true, as_of_utc: '2026-05-29T14:48:00Z' },
};

function bundle() {
  return {
    schema: 'gxofnq.replay-capture.v1',
    validation: { ok: true, blockers: [], warnings: [] },
    bars_by_tf: {
      m1: { bars: [
        { time: 1780065900, open: 30293.75, high: 30300, low: 30269.75, close: 30288.25, volume: 15416 },
        { time: 1780066080, open: 30291.5, high: 30318, low: 30285.5, close: 30314.75, volume: 10442 },
      ] },
    },
  };
}

test('buildRealSessionExecutionPacket creates exact GXNQ packet from label and replay bars', () => {
  const packet = buildRealSessionExecutionPacket({ label, bundle: bundle() });

  assert.equal(packet.outcome, 'trade');
  assert.equal(packet.model, 'Inversion');
  assert.equal(packet.side, 'long');
  assert.equal(packet.entry.value, 30314.75);
  assert.equal(packet.stop.value, 30269.75);
  assert.equal(packet.tp1.value, 30437.5);
  assert.equal(packet.risk_points, 45);
  assert.equal(packet.tp1_r_multiple, 2.73);
  assert.equal(packet.evidence.stop_anchor_bar.time, 1780065900);
  assert.equal(packet.evidence.entry_confirmation_bar.time, 1780066080);
});

test('buildRealSessionExecutionPacket fails closed when replay bundle is not validated or required candles are missing', () => {
  assert.throws(
    () => buildRealSessionExecutionPacket({ label, bundle: { ...bundle(), validation: { ok: false, blockers: ['missing m1'] } } }),
    /not replay-ready: missing m1/,
  );
  assert.throws(
    () => buildRealSessionExecutionPacket({ label, bundle: { ...bundle(), bars_by_tf: { m1: { bars: [] } } } }),
    /missing stop_anchor candle/,
  );
});

test('runReplayCasesFromDir can score a real-session packet case with exact entry stop and TP1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'real-session-packet-'));
  writeJson(join(dir, 'label.json'), label);
  writeJson(join(dir, 'bundle.json'), bundle());
  writeJson(join(dir, 'case.replay.json'), {
    fixture: 'gx-real',
    mode: 'real_session_packet',
    labelPath: 'label.json',
    bundlePath: 'bundle.json',
    expected: { outcome: 'trade', model: 'Inversion', side: 'long', entry: 30314.75, stop: 30269.75, tp1: 30437.5 },
  });

  const run = runReplayCasesFromDir(dir);

  assert.equal(run.cases[0].actual.model, 'Inversion');
  assert.equal(run.cases[0].actual.entry.value, 30314.75);
  assert.equal(run.cases[0].actual.stop.value, 30269.75);
  assert.equal(run.cases[0].actual.tp1.value, 30437.5);
  assert.equal(run.report.correct_trades, 1);
  assert.deepEqual(run.report.mismatches, []);
});

test('replay accuracy report rejects real-session packets with wrong exact prices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'real-session-packet-mismatch-'));
  writeJson(join(dir, 'label.json'), label);
  writeJson(join(dir, 'bundle.json'), bundle());
  writeJson(join(dir, 'case.replay.json'), {
    fixture: 'gx-real-wrong-entry',
    mode: 'real_session_packet',
    labelPath: 'label.json',
    bundlePath: 'bundle.json',
    expected: { outcome: 'trade', model: 'Inversion', side: 'long', entry: 30315, stop: 30269.75, tp1: 30437.5 },
  });

  const run = runReplayCasesFromDir(dir);

  assert.equal(run.report.correct_trades, 0);
  assert.equal(run.report.wrong_packet, 1);
  assert.equal(run.report.mismatches[0].type, 'wrong_packet');
  assert.deepEqual(run.report.mismatches[0].fields, ['entry']);
});

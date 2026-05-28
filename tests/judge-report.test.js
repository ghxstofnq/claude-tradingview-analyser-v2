import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tally, agreementPct, replayAccuracyReport, formatReplayAccuracyReport, loadReplayCasesFromDir } from '../scripts/judge-report.js';

test('tally counts verdicts per dimension', () => {
  const results = [
    { dimensions: { grade: 'agree', htf_bias: 'agree' } },
    { dimensions: { grade: 'disagree', htf_bias: 'partial' } },
  ];
  const t = tally(results);
  assert.deepEqual(t.grade, { agree: 1, partial: 0, disagree: 1 });
  assert.deepEqual(t.htf_bias, { agree: 1, partial: 1, disagree: 0 });
});

test('agreementPct scores partial as half credit', () => {
  assert.equal(agreementPct({ agree: 1, partial: 0, disagree: 1 }), 50);
  assert.equal(agreementPct({ agree: 1, partial: 1, disagree: 0 }), 75);
  assert.equal(agreementPct({ agree: 0, partial: 0, disagree: 0 }), null);
});

test('replayAccuracyReport counts false candidates, missed valid setups, wrong side/model, and correct no-trades', () => {
  const report = replayAccuracyReport([
    { fixture: 'ok-valid', expected: { outcome: 'trade', model: 'MSS', side: 'long' }, actual: { outcome: 'trade', model: 'MSS', side: 'long' } },
    { fixture: 'ok-no-trade', expected: { outcome: 'no_trade' }, actual: { outcome: 'no_trade', blockers: [{ reason: 'waiting' }] } },
    { fixture: 'false-candidate', expected: { outcome: 'no_trade' }, actual: { outcome: 'trade', model: 'Trend', side: 'long' } },
    { fixture: 'missed-valid', expected: { outcome: 'trade', model: 'Inversion', side: 'short' }, actual: { outcome: 'no_trade' } },
    { fixture: 'wrong-model', expected: { outcome: 'trade', model: 'MSS', side: 'long' }, actual: { outcome: 'trade', model: 'Trend', side: 'long' } },
    { fixture: 'wrong-side', expected: { outcome: 'trade', model: 'MSS', side: 'long' }, actual: { outcome: 'trade', model: 'MSS', side: 'short' } },
  ]);

  assert.equal(report.total, 6);
  assert.equal(report.correct_trades, 1);
  assert.equal(report.correct_no_trades, 1);
  assert.equal(report.false_candidates, 1);
  assert.equal(report.missed_valid_setups, 1);
  assert.equal(report.wrong_model, 1);
  assert.equal(report.wrong_side, 1);
  assert.equal(report.mismatches.length, 4);
  assert.deepEqual(report.mismatches.map((m) => m.fixture), ['false-candidate', 'missed-valid', 'wrong-model', 'wrong-side']);
});

test('formatReplayAccuracyReport prints decision-grade replay failure counts', () => {
  const text = formatReplayAccuracyReport({
    total: 6,
    correct_trades: 1,
    correct_no_trades: 1,
    false_candidates: 1,
    missed_valid_setups: 1,
    wrong_model: 1,
    wrong_side: 1,
    mismatches: [
      { fixture: 'false-candidate', type: 'false_candidate' },
      { fixture: 'missed-valid', type: 'missed_valid_setup' },
    ],
  });

  assert.match(text, /Replay accuracy — 6 case\(s\)/);
  assert.match(text, /correct trades\s+1/);
  assert.match(text, /correct no-trades\s+1/);
  assert.match(text, /false candidates\s+1/);
  assert.match(text, /missed valid setups\s+1/);
  assert.match(text, /wrong model\s+1/);
  assert.match(text, /wrong side\s+1/);
  assert.match(text, /false-candidate\s+false_candidate/);
});

test('loadReplayCasesFromDir reads .replay.json files that contain one case or a cases array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-cases-'));
  writeFileSync(join(dir, 'single.replay.json'), JSON.stringify({
    fixture: 'single',
    expected: { outcome: 'no_trade' },
    actual: { outcome: 'no_trade' },
  }));
  writeFileSync(join(dir, 'batch.replay.json'), JSON.stringify({ cases: [
    { fixture: 'batch-valid', expected: { outcome: 'trade', model: 'MSS', side: 'long' }, actual: { outcome: 'trade', model: 'MSS', side: 'long' } },
    { fixture: 'batch-false', expected: { outcome: 'no_trade' }, actual: { outcome: 'trade', model: 'Trend', side: 'short' } },
  ] }));
  writeFileSync(join(dir, 'ignore.judge.json'), JSON.stringify({ dimensions: { grade: 'agree' } }));

  const cases = loadReplayCasesFromDir(dir);

  assert.deepEqual(cases.map((c) => c.fixture).sort(), ['batch-false', 'batch-valid', 'single']);
  const report = replayAccuracyReport(cases);
  assert.equal(report.total, 3);
  assert.equal(report.false_candidates, 1);
});

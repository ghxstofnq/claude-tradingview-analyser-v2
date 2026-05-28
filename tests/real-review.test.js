import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildReviewQueue,
  buildReviewCallSheet,
  formatReviewCallSheet,
  formatReviewPack,
  writeRealReviewArtifacts,
  gradingGateReport,
  formatGradingGateReport,
} from '../scripts/real-review.js';

const sampleRun = {
  sourceDir: '/tmp/real-fixtures',
  cases: [
    {
      fixture: '2026-05-20-MNQ-ny-am',
      source_file: 'real.replay.json',
      expected: { outcome: 'no_trade', label_status: 'needs_gxofnq_review' },
      actual: {
        outcome: 'manual_candidate',
        best_candidate: {
          model: 'MSS',
          side: 'long',
          grade: 'B',
          entry: 21100.25,
          entry_time: '2026-05-20T13:47:00Z',
          stop: 21078.25,
          tp1: 21136.25,
          reasons: ['confirmed inside large bullish FVG'],
        },
      },
    },
    {
      fixture: '2026-05-21-MES-ny-am',
      source_file: 'real.replay.json',
      expected: { outcome: 'no_trade' },
      actual: { outcome: 'no_trade', blockers: [{ reason: 'missing HTF primary draw' }] },
    },
  ],
  report: {
    total: 2,
    correct_trades: 0,
    correct_no_trades: 1,
    false_candidates: 1,
    missed_valid_setups: 0,
    wrong_model: 0,
    wrong_side: 0,
    mismatches: [{ fixture: '2026-05-20-MNQ-ny-am', type: 'false_candidate' }],
  },
};

test('buildReviewQueue prioritizes mismatches and GXNQ review cases without mutating fixtures', () => {
  const queue = buildReviewQueue(sampleRun);

  assert.equal(queue.summary.total, 2);
  assert.equal(queue.summary.fix_model, 1);
  assert.equal(queue.summary.needs_gxnq_decision, 1);
  assert.equal(queue.items[0].fixture, '2026-05-20-MNQ-ny-am');
  assert.equal(queue.items[0].priority, 'fix_model');
  assert.equal(queue.items[0].mismatchType, 'false_candidate');
  assert.equal(queue.items[0].requiresGxnqDecision, true);
  assert.match(queue.items[0].question, /valid setup, bad setup, or no-trade/i);
});

test('formatReviewCallSheet separates model fixes, GXNQ decisions, and accuracy-safe cases', () => {
  const sheet = buildReviewCallSheet(buildReviewQueue(sampleRun));
  const text = formatReviewCallSheet(sheet);

  assert.match(text, /Model fixes \(review-only\)/);
  assert.match(text, /Needs GXNQ decision \(do not auto-label\)/);
  assert.match(text, /Accuracy-safe labeled\/ok cases/);
  assert.match(text, /2026-05-20-MNQ-ny-am/);
  assert.match(text, /Only labeled\/ok cases are accuracy-safe/);
});

test('formatReviewPack includes exact candidate fields and never renders object missing evidence as [object Object]', () => {
  const queue = buildReviewQueue({
    ...sampleRun,
    cases: [{
      ...sampleRun.cases[0],
      actual: {
        ...sampleRun.cases[0].actual,
        missingEvidence: [{ pillar: 'risk', field: 'structural_stop' }],
      },
    }],
  });

  const text = formatReviewPack(queue);

  assert.match(text, /GXNQ Real Session Review Pack/);
  assert.match(text, /confirmation close\/time/i);
  assert.match(text, /2026-05-20T13:47:00Z/);
  assert.match(text, /stop/i);
  assert.match(text, /TP1/i);
  assert.match(text, /risk\.structural_stop/);
  assert.doesNotMatch(text, /\[object Object\]/);
});

test('writeRealReviewArtifacts persists queue, call sheet, review pack, and accuracy JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'real-review-artifacts-'));
  const written = writeRealReviewArtifacts(sampleRun, dir);

  for (const path of Object.values(written)) assert.equal(existsSync(path), true, path);
  assert.match(readFileSync(written.callSheet, 'utf8'), /Needs GXNQ decision/);
  assert.match(readFileSync(written.reviewPack, 'utf8'), /GXNQ Real Session Review Pack/);
  const accuracy = JSON.parse(readFileSync(written.accuracy, 'utf8'));
  assert.equal(accuracy.false_candidates, 1);
});

test('gradingGateReport fails review-required issues separately from clean replay cases', () => {
  const bad = gradingGateReport(sampleRun);
  assert.equal(bad.ok, false);
  assert.equal(bad.reviewRequired, true);
  assert.equal(bad.issues.length, 1);
  assert.match(formatGradingGateReport(bad), /REVIEW REQUIRED/);
  assert.match(formatGradingGateReport(bad), /false_candidate/);

  const clean = gradingGateReport({ ...sampleRun, cases: [sampleRun.cases[1]], report: { ...sampleRun.report, false_candidates: 0, mismatches: [] } });
  assert.equal(clean.ok, true);
  assert.match(formatGradingGateReport(clean), /PASS/);
});

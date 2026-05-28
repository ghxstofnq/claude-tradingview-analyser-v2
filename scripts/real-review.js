#!/usr/bin/env node
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runReplayCasesFromDir } from './replay-runner.js';

const DEFAULT_FIXTURES = 'tests/fixtures';
const DEFAULT_OUT = 'artifacts/real-session-review';

function mismatchMap(report) {
  const map = new Map();
  for (const m of report?.mismatches ?? []) map.set(m.fixture, m);
  return map;
}

function isNeedsReview(expected = {}, actual = {}) {
  return expected.label_status === 'needs_gxofnq_review'
    || expected.labelStatus === 'needs_gxofnq_review'
    || expected.label_status === 'machine_labeled_needs_gxofnq_review'
    || actual.label_status === 'needs_gxofnq_review'
    || actual.review_status === 'needs_gxofnq_review';
}

function actualCandidate(actual = {}) {
  return actual.best_candidate ?? actual.candidate ?? (actual.outcome === 'trade' || actual.outcome === 'manual_candidate' ? actual : null);
}

function priorityFor({ expected, actual, mismatch }) {
  if (mismatch) return 'fix_model';
  if (isNeedsReview(expected, actual)) return 'needs_gxnq_decision';
  if ((expected?.fixtureSource ?? expected?.source) === 'real' && !expected?.reviewer && expected?.label_status !== 'labeled') return 'label_ready_real_capture';
  return 'accuracy_safe';
}

function priorityRank(priority) {
  return ({ fix_model: 0, needs_gxnq_decision: 1, label_ready_real_capture: 2, accuracy_safe: 3 })[priority] ?? 99;
}

function compactBlockers(actual = {}) {
  const blockers = actual.blockers ?? actual.missingEvidence ?? [];
  if (!Array.isArray(blockers)) return blockers ? [String(blockers)] : [];
  return blockers.map((b) => {
    if (typeof b === 'string') return b;
    const parts = [b.pillar, b.field, b.reason, b.code].filter(Boolean);
    return parts.length ? parts.join('.') : JSON.stringify(b);
  });
}

export function buildReviewQueue(run) {
  const mismatches = mismatchMap(run.report);
  const items = (run.cases ?? []).map((c) => {
    const expected = c.expected ?? c.expectedOutcome ?? {};
    const actual = c.actual ?? c.actualResult ?? c.actualOutcome ?? {};
    const mismatch = mismatches.get(c.fixture);
    const candidate = actualCandidate(actual);
    const priority = priorityFor({ expected, actual, mismatch });
    return {
      fixture: c.fixture,
      sourceFile: c.source_file,
      priority,
      mismatchType: mismatch?.type ?? null,
      requiresGxnqDecision: priority === 'needs_gxnq_decision' || isNeedsReview(expected, actual),
      question: candidate
        ? 'GXNQ: valid setup, bad setup, or no-trade? Confirm model/side/entry/stop/TP.'
        : 'GXNQ: confirm no-trade or mark missed setup window.',
      expected,
      actual,
      candidate,
      blockers: compactBlockers(actual),
    };
  }).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || String(a.fixture).localeCompare(String(b.fixture)));

  const summary = {
    total: items.length,
    fix_model: items.filter((i) => i.priority === 'fix_model').length,
    needs_gxnq_decision: items.filter((i) => i.requiresGxnqDecision).length,
    label_ready_real_captures: items.filter((i) => i.priority === 'label_ready_real_capture').length,
    accuracy_safe: items.filter((i) => i.priority === 'accuracy_safe').length,
  };
  return { sourceDir: run.sourceDir, summary, items, accuracy: run.report };
}

export function buildReviewCallSheet(queue) {
  const by = (priority) => queue.items.filter((i) => i.priority === priority);
  return {
    summary: queue.summary,
    modelFixes: by('fix_model'),
    needsGxnqDecision: queue.items.filter((i) => i.requiresGxnqDecision),
    labelReadyRealCaptures: by('label_ready_real_capture'),
    accuracySafe: by('accuracy_safe'),
  };
}

function itemLine(item) {
  const cand = item.candidate;
  const bits = [
    `- ${item.fixture}`,
    item.mismatchType ? `mismatch=${item.mismatchType}` : null,
    cand?.grade ? `grade=${cand.grade}` : null,
    cand?.model ? `model=${cand.model}` : null,
    cand?.side ? `side=${cand.side}` : null,
    cand?.entry_time ? `confirm=${cand.entry_time}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

export function formatReviewCallSheet(sheet) {
  const lines = [
    '# Real Session Review Call Sheet',
    '',
    `Total cases: ${sheet.summary.total}`,
    '',
    '> Only labeled/ok cases are accuracy-safe. Do not auto-label GXNQ-discretionary decisions.',
    '',
    '## Model fixes (review-only)',
    ...(sheet.modelFixes.length ? sheet.modelFixes.map(itemLine) : ['- none']),
    '',
    '## Needs GXNQ decision (do not auto-label)',
    ...(sheet.needsGxnqDecision.length ? sheet.needsGxnqDecision.map(itemLine) : ['- none']),
    '',
    '## Label-ready real captures',
    ...(sheet.labelReadyRealCaptures.length ? sheet.labelReadyRealCaptures.map(itemLine) : ['- none']),
    '',
    '## Accuracy-safe labeled/ok cases',
    ...(sheet.accuracySafe.length ? sheet.accuracySafe.map(itemLine) : ['- none']),
    '',
  ];
  return lines.join('\n');
}

function valueOrMissing(v) {
  return v === undefined || v === null || v === '' ? 'not proven' : String(v);
}

export function formatReviewPack(queue) {
  const lines = [
    '# GXNQ Real Session Review Pack',
    '',
    'Purpose: review candidate windows without mutating fixtures. Accuracy-safe only after GXNQ/delegated labels are applied.',
    '',
  ];
  for (const item of queue.items.filter((i) => i.priority !== 'accuracy_safe' || i.candidate)) {
    const c = item.candidate ?? {};
    lines.push(`## ${item.fixture}`);
    lines.push(`- Priority: ${item.priority}${item.mismatchType ? ` (${item.mismatchType})` : ''}`);
    lines.push(`- Question: ${item.question}`);
    lines.push(`- Model/side/grade: ${valueOrMissing(c.model)} / ${valueOrMissing(c.side)} / ${valueOrMissing(c.grade)}`);
    lines.push(`- Confirmation close/time: ${valueOrMissing(c.entry)} @ ${valueOrMissing(c.entry_time ?? c.confirmation_time)}`);
    lines.push(`- Stop: ${valueOrMissing(c.stop)} (${valueOrMissing(c.stop_cite ?? c.stop_source)})`);
    lines.push(`- TP1: ${valueOrMissing(c.tp1)} (${valueOrMissing(c.tp1_cite ?? c.tp1_source)})`);
    lines.push(`- TP2: ${valueOrMissing(c.tp2)} (${valueOrMissing(c.tp2_cite ?? c.tp2_source)})`);
    const blockers = item.blockers.length ? item.blockers.join('; ') : 'none surfaced';
    lines.push(`- Blockers / missing evidence: ${blockers}`);
    if (Array.isArray(c.reasons) && c.reasons.length) lines.push(`- Machine reasons: ${c.reasons.join('; ')}`);
    lines.push('- GXNQ label choices: valid A+/B setup | invalid setup | wrong model | wrong side | bad stop | bad TP | no-trade');
    lines.push('');
  }
  return lines.join('\n');
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function writeRealReviewArtifacts(run, outDir = DEFAULT_OUT) {
  const queue = buildReviewQueue(run);
  const callSheet = buildReviewCallSheet(queue);
  const paths = {
    queue: join(outDir, 'queue.json'),
    callSheet: join(outDir, 'call-sheet.md'),
    reviewPack: join(outDir, 'review-pack.md'),
    accuracy: join(outDir, 'accuracy.json'),
  };
  atomicWrite(paths.queue, JSON.stringify(queue, null, 2));
  atomicWrite(paths.callSheet, formatReviewCallSheet(callSheet));
  atomicWrite(paths.reviewPack, formatReviewPack(queue));
  atomicWrite(paths.accuracy, JSON.stringify(run.report, null, 2));
  return paths;
}

export function gradingGateReport(run) {
  const queue = buildReviewQueue(run);
  const issues = queue.items.filter((i) => i.priority === 'fix_model' || i.requiresGxnqDecision);
  return {
    ok: issues.length === 0,
    reviewRequired: issues.length > 0,
    issues: issues.map((i) => ({ fixture: i.fixture, priority: i.priority, type: i.mismatchType ?? i.priority, question: i.question })),
    summary: queue.summary,
  };
}

export function formatGradingGateReport(report) {
  if (report.ok) return `PASS — grading gate clean (${report.summary.total} case(s))`;
  return [
    `REVIEW REQUIRED — ${report.issues.length} grading/model issue(s)`,
    ...report.issues.map((i) => `- ${i.fixture}: ${i.type} · ${i.question}`),
  ].join('\n');
}

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function main() {
  const mode = process.argv.includes('--verify-grading') ? 'verify' : 'review';
  const dir = argValue('--fixtures', process.argv[2]?.startsWith('--') ? DEFAULT_FIXTURES : (process.argv[2] ?? DEFAULT_FIXTURES));
  const run = runReplayCasesFromDir(dir);
  if (mode === 'verify') {
    const report = gradingGateReport(run);
    console.log(formatGradingGateReport(report));
    process.exit(report.ok ? 0 : 1);
  }
  const outDir = argValue('--out', DEFAULT_OUT);
  const paths = writeRealReviewArtifacts(run, outDir);
  console.log(`Real review artifacts written — ${outDir}`);
  console.log(`  queue       ${paths.queue}`);
  console.log(`  call sheet  ${paths.callSheet}`);
  console.log(`  review pack ${paths.reviewPack}`);
  console.log(`  accuracy    ${paths.accuracy}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

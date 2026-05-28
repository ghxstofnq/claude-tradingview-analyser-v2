#!/usr/bin/env node
/**
 * replay-runner.js — deterministic replay harness for detector proof packs.
 *
 * Reads *.replay.json files from a directory. Each file may be either one case
 * or { cases: [...] }. A case can carry an inline `bundle` or `bundlePath`
 * relative to the replay directory. The runner hydrates the bundle, runs the
 * setup detector, and scores actual vs expected with replayAccuracyReport().
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detectSetups } from '../cli/lib/setup-detector.js';
import { formatReplayAccuracyReport, replayAccuracyReport } from './judge-report.js';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function replayFilesInDir(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.replay.json')).sort();
}

export function loadReplayCaseSpecsFromDir(dir) {
  return replayFilesInDir(dir).flatMap((file) => {
    const parsed = readJson(join(dir, file));
    const cases = Array.isArray(parsed?.cases) ? parsed.cases : [parsed];
    return cases.map((c, idx) => ({
      fixture: c.fixture ?? `${file}#${idx + 1}`,
      source_file: file,
      ...c,
    }));
  });
}

export function hydrateReplayCase(spec, dir) {
  let bundle = spec.bundle;
  if (!bundle && spec.bundlePath) {
    const bundlePath = resolve(dir, spec.bundlePath);
    const root = resolve(dir);
    if (!bundlePath.startsWith(root)) {
      throw new Error(`Replay case ${spec.fixture}: bundlePath escapes replay dir`);
    }
    if (!existsSync(bundlePath)) {
      throw new Error(`Replay case ${spec.fixture}: bundlePath not found: ${spec.bundlePath}`);
    }
    bundle = readJson(bundlePath);
  }
  if (!bundle) throw new Error(`Replay case ${spec.fixture}: missing bundle or bundlePath`);
  return { ...spec, bundle };
}

export function runReplayCase(spec, dir) {
  const hydrated = hydrateReplayCase(spec, dir);
  const input = hydrated.input ?? {};
  const actual = detectSetups({
    bundle: hydrated.bundle,
    leader: input.leader,
    ltf_bias_context: input.ltf_bias_context,
    untaken_targets: input.untaken_targets ?? untakenTargetsFromBundle(hydrated.bundle),
  });
  return {
    fixture: hydrated.fixture,
    source_file: hydrated.source_file,
    expected: hydrated.expected ?? hydrated.expectedOutcome ?? {},
    actual,
  };
}

export function untakenTargetsFromBundle(bundle) {
  const symbols = bundle?.brief_digest?.symbols ?? {};
  const sym = symbols[Object.keys(symbols)[0]] ?? {};
  const pillar1 = sym.pillar1 ?? {};
  return {
    untaken_above: pillar1.untaken_pools_above ?? [],
    untaken_below: pillar1.untaken_pools_below ?? [],
  };
}

export function runReplayCasesFromDir(dir) {
  const sourceDir = resolve(dir);
  const specs = loadReplayCaseSpecsFromDir(sourceDir);
  const cases = specs.map((spec) => runReplayCase(spec, sourceDir));
  return { sourceDir, cases, report: replayAccuracyReport(cases) };
}

export function formatReplayRunReport(run) {
  return [
    `Replay run — ${run.sourceDir}`,
    `  cases loaded        ${run.cases.length}`,
    '',
    formatReplayAccuracyReport(run.report),
  ].join('\n');
}

function main() {
  const dir = process.argv[2] ?? 'tests/fixtures';
  const run = runReplayCasesFromDir(dir);
  console.log(formatReplayRunReport(run));
  process.exit((run.report.mismatches ?? []).length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

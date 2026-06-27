#!/usr/bin/env node
// Refresh the label-derived ltf_bias_context in the Stage-G day-tapes from the
// CURRENT contextFromLabel — WITHOUT re-driving the chart. Engine/OHLC
// (inputs.bundle) and per-bar event data are untouched; only the session-
// constant ltf_bias_context (which contextFromLabel fully owns) is rewritten.
// Needed after a contextFromLabel change (e.g. the Stage-C 3-vote pillar) so the
// existing tapes fold through the updated context instead of the stale baked one.
//
//   node scripts/refresh-tape-context.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextFromLabel } from '../cli/lib/tape-recorder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP = {
  'tests/tapes/2026-06-09-ny-am-replay.tape.json': 'tests/fixtures/real-sessions/2026-06-09-mnq-ny-am-inversion-short.label.json',
  'tests/tapes/2026-06-16-ny-am-replay.tape.json': 'tests/fixtures/stage-g-sessions/2026-06-16-mnq-ny-am-mss-short.label.json',
  'tests/tapes/2026-06-17-ny-am-replay.tape.json': 'tests/fixtures/stage-g-sessions/2026-06-17-mnq-ny-am-no-trade.label.json',
  'tests/tapes/2026-02-09-ny-am-replay.tape.json': 'tests/fixtures/stage-g-sessions/2026-02-09-mnq-ny-am-multi-align-long.label.json',
  'tests/tapes/2026-06-18-ny-am-replay.tape.json': 'tests/fixtures/stage-g-sessions/2026-06-18-mnq-ny-am-trend-long.label.json',
};

for (const [tapeRel, labelRel] of Object.entries(MAP)) {
  const tapePath = path.join(ROOT, tapeRel);
  const tape = JSON.parse(fs.readFileSync(tapePath, 'utf8'));
  const label = JSON.parse(fs.readFileSync(path.join(ROOT, labelRel), 'utf8'));
  const ctx = contextFromLabel(label);
  let n = 0;
  for (const e of tape.entries ?? []) {
    if (!e.inputs) continue;
    e.inputs.ltf_bias_context = ctx.ltf_bias_context;
    n += 1;
  }
  fs.writeFileSync(tapePath, `${JSON.stringify(tape, null, 2)}\n`, 'utf8');
  console.log(`refreshed ${tapeRel} (${n} entries) — draw_bias_pillar=${ctx.ltf_bias_context.draw_bias_pillar}`);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReplayCasesFromDir, formatReplayRunReport } from '../scripts/replay-runner.js';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function tradableMssBundle() {
  return {
    quote: { time: 1779836400, last: 29998.5 },
    bars_by_tf: {
      m5: { last_5_bars: [
        { time: 1779836160, open: 29985, high: 29988.75, low: 29981.25, close: 29986.5 },
        { time: 1779836280, open: 29991.5, high: 29998.5, low: 29982.25, close: 29998.5 },
        { time: 1779836400, open: 29998.5, high: 29998.75, low: 29994.75, close: 29998.5 },
      ] },
    },
    engine: { schema_supported: true },
    engine_by_tf: {
      m5: {
        fvgs: [{ kind: 'fvg', dir: 'bull', top: 29998.5, bottom: 29992.5, ce: 29995.5, state: 'fresh', created_ms: 1779836400000 }],
      },
    },
    brief_digest: {
      symbols: {
        'MNQ1!': {
          pillar1: {
            untaken_pools_above: [{ price: 30015, cite: 'pillar1.mnq.untaken_above[0]' }, { price: 30119, cite: 'pillar1.mnq.untaken_above[1]' }],
            untaken_pools_below: [],
            htf_destination: { dir: 'above', cite: 'pillar1.mnq.htf_destination' },
            primary_draw: { kind: 'fvg', cite: 'engine_by_tf.h4.fvgs[0]' },
          },
        },
      },
    },
    gates: {
      engine: {
        meta: { stale: false, schema_supported: true },
        price_context: { last: 29998.5, inside_fvgs: [{ kind: 'fvg', dir: 'bull', top: 29998.5, bottom: 29992.5, state: 'fresh' }], inside_bprs: [] },
        pillar1: { sweeps: [{ target: 'AS_L', price: 29982.25, side: 'sell', rejected: true }] },
        pillar2: { current_tf: { range_quality: 'good', displacement: 'clean' } },
        pillar3: {
          failure_swings: [{ event: 'mss', dir: 'bull', level: 30002.25, validation: 'sweep' }],
          fvg_summary: { size_quality: 'medium' },
          structures_by_tier: { swing: [], internal: [{ level: 29982.25, tier: 'internal', is_high: false }] },
          most_recent_structure: { event: 'mss', dir: 'bull', level: 30002.25 },
        },
        confirmation: { entry_state: 'confirmed', confirm_close: 1, ce_held: true, chop_15m: 0, confirm_dir: 'bull' },
      },
    },
  };
}

test('runReplayCasesFromDir hydrates bundle cases, runs detector, and reports accuracy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-runner-'));
  writeJson(join(dir, 'bundle.json'), tradableMssBundle());
  writeJson(join(dir, 'cases.replay.json'), {
    cases: [
      {
        fixture: 'mss-valid',
        bundlePath: 'bundle.json',
        input: {
          leader: 'mnq',
          ltf_bias_context: { entry_model_priority: 'mss' }
        },
        expected: { outcome: 'trade', model: 'MSS', side: 'long' },
      },
      {
        fixture: 'intentional-false-candidate',
        bundlePath: 'bundle.json',
        input: {
          leader: 'mnq',
          untaken_targets: { untaken_above: [{ price: 30015, cite: 'pillar1.mnq.untaken_above[0]' }, { price: 30119, cite: 'pillar1.mnq.untaken_above[1]' }], untaken_below: [] },
        },
        expected: { outcome: 'no_trade' },
      },
    ],
  });

  const run = runReplayCasesFromDir(dir);

  assert.equal(run.cases.length, 2);
  assert.equal(run.cases[0].actual.best_candidate.model, 'MSS');
  assert.equal(run.report.total, 2);
  assert.equal(run.report.correct_trades, 1);
  assert.equal(run.report.false_candidates, 1);
  assert.deepEqual(run.report.mismatches.map((m) => m.fixture), ['intentional-false-candidate']);
});

test('formatReplayRunReport prints run provenance plus accuracy summary', () => {
  const text = formatReplayRunReport({
    sourceDir: '/tmp/replay-proof',
    cases: [{ fixture: 'mss-valid' }],
    report: {
      total: 1,
      correct_trades: 1,
      correct_no_trades: 0,
      false_candidates: 0,
      missed_valid_setups: 0,
      wrong_model: 0,
      wrong_side: 0,
      mismatches: [],
    },
  });

  assert.match(text, /Replay run — \/tmp\/replay-proof/);
  assert.match(text, /cases loaded\s+1/);
  assert.match(text, /Replay accuracy — 1 case\(s\)/);
  assert.match(text, /correct trades\s+1/);
});

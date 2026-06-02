import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildRealSessionDetectorInput } from '../cli/lib/real-session-detector-adapter.js';
import { runReplayCase } from '../scripts/replay-runner.js';

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

const realLabel = readJson('./fixtures/real-sessions/2026-05-29-mnq-ny-am-inversion-long.label.json');
const realBundle = readJson('./fixtures/real-sessions/2026-05-29-mnq-ny-am-inversion-long.asof-1048.bundle.json');

test('buildRealSessionDetectorInput adapts replay capture into analyzer-compatible detector input without future engine rows', () => {
  const adapted = buildRealSessionDetectorInput({ label: realLabel, bundle: realBundle });

  assert.equal(adapted.leader, 'mnq');
  assert.equal(adapted.bundle.validation.ok, true);
  assert.equal(adapted.bundle.quote.time, 1780066080);
  assert.equal(adapted.bundle.quote.last, 30314.75);
  assert.equal(adapted.bundle.gates.engine.meta.schema_supported, true);
  assert.equal(adapted.bundle.gates.engine.meta.stale, false);
  assert.equal(adapted.bundle.brief_digest.symbols.MNQ.pillar1.htf_destination.dir, 'above');
  assert.equal(adapted.ltf_bias_context.entry_model_priority, 'inversion');
  assert.equal(adapted.untaken_targets.untaken_above[0].price, 30437.5);

  const asOfMs = Date.parse(realLabel.replay.as_of_utc);
  for (const row of adapted.bundle.engine_by_tf.m5.fvgs) {
    assert.ok(row.created_ms <= asOfMs, `future FVG leaked into detector: ${row.created_ms}`);
  }
  assert.equal(adapted.diagnostics.future_rows_removed_by_tf.m5.fvgs, 24);
  assert.deepEqual(adapted.diagnostics.blockers, []);
  assert.deepEqual(adapted.diagnostics.explicit_asof_engine_evidence, {
    source: 'gxofnq_label_plus_tradingview_replay_bars',
    source_tf: 'm5',
    fvgs_added: 1,
    quality_added: true,
  });
  assert.equal(adapted.bundle.engine_by_tf.m5.fvgs[0].kind, 'ifvg');
  assert.equal(adapted.bundle.engine_by_tf.m5.fvgs[0].evidence_source, 'gxofnq_label_plus_tradingview_replay_bars');
});

test('real_session_detector replay mode turns the 2026-05-29 label into a detector-driven Inversion packet', () => {
  const result = runReplayCase({
    fixture: 'gx-real-detector-diagnostic',
    mode: 'real_session_detector',
    label: realLabel,
    bundle: realBundle,
    expected: { outcome: 'trade', model: 'Inversion', side: 'long' },
  }, new URL('./fixtures', import.meta.url).pathname);

  const candidate = result.actual.best_candidate;
  assert.equal(candidate.model, 'Inversion');
  assert.equal(candidate.side, 'long');
  assert.equal(candidate.tradable, true);
  assert.equal(candidate.grade_capped, 'A+');
  assert.deepEqual(candidate.entry, { value: 30314.75, cite: 'engine_by_tf.m5.fvgs[0].top' });
  assert.equal(candidate.stop.value, 30269.75);
  assert.equal(candidate.stop.kind, 'fvg_candle3_low');
  assert.equal(candidate.tp1.value, 30437.5);
  assert.equal(candidate.components.inverted_pd_array.present, true);
  assert.equal(candidate.components.tap_into_ifvg.present, true);
  assert.equal(candidate.components.confirmation.present, true);
  assert.deepEqual(result.diagnostics.blockers, []);
});

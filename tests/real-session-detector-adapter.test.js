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
});

test('real_session_detector replay mode runs the adapter plus detector and exposes diagnostics', () => {
  const result = runReplayCase({
    fixture: 'gx-real-detector-diagnostic',
    mode: 'real_session_detector',
    label: realLabel,
    bundle: realBundle,
    expected: { outcome: 'no_trade' },
  }, new URL('./fixtures', import.meta.url).pathname);

  assert.equal(result.actual.best_candidate, null);
  assert.equal(result.expected.outcome, 'no_trade');
  assert.ok(result.diagnostics.blockers.includes('no_asof_ifvg_rows'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { __test } from '../app/main/bar-close.js';

const confirmedWalker = {
  id: 'w_MNQ1__ny-am_MSS_long_pdlargebull',
  market: 'MNQ1!',
  session: 'ny-am',
  model: 'MSS',
  side: 'long',
  stage: 'confirmed',
  chain: 'MSS_standard',
  pdArrayRef: 'pd.large.bull',
  evidence: {
    pdArray: {
      evidenceRef: 'pd.large.bull',
      rawPayload: { evidenceRef: 'pd.large.bull', kind: 'fvg', dir: 'bull', direction: 'bullish', state: 'fresh', size_quality: 'large' },
    },
    confirmation: {
      evidenceRef: 'confirm.close',
      rawPayload: { close: 21000, confirm_ms: 1780062420000, entry_state: 'confirmed', confirm_close: 1, ce_held: 1, chop_15m: 0, confirm_dir: 'bull' },
    },
  },
};

function runtimeInputs() {
  return {
    leader: 'MNQ1!',
    untaken_targets: { untaken_above: [{ evidenceRef: 'target.pdh', label: 'PDH', price: 21050 }], untaken_below: [] },
    bundle: {
      chart: { symbol: 'CME_MINI:MNQ1!' },
      brief_digest: { htf_destination: 'above PDH', primary_draw: 'PDH' },
      gates: {
        engine: {
          meta: { schema_supported: true, stale: false },
          rows: [{ evidenceRef: 'pd.large.bull', kind: 'fvg', dir: 'bull', state: 'fresh', size_quality: 'large' }],
          pillar2: { current_tf: { candle: 'clean', displacement: 'clean' }, chop_15m: 0 },
          pillar3: { structural_stops: [{ evidenceRef: 'stop.mss_swing_low', kind: 'mss_swing_low', price: 20990 }] },
        },
      },
      bars: { last_5_bars: [] },
      bars_by_tf: { m5: { last_5_bars: [] } },
    },
  };
}

test('buildDeterministicPacketTruthFromInputs promotes confirmed walker into surfaced deterministic packet payload', () => {
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: runtimeInputs(),
    previousWalkers: [confirmedWalker],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.finalVerdict, 'manual_candidate');
  assert.equal(truth.bestPacket.status, 'executable');
  assert.equal(truth.surfacePayload.entry, 21000);
  assert.equal(truth.surfacePayload.stop, 20990);
  assert.equal(truth.surfacePayload.tp1, 21050);
  assert.equal(truth.surfacePayload.model, 'MSS');
  assert.equal(truth.surfacePayload.side, 'long');
  assert.equal(truth.surfacePayload.grade, 'A+');
  assert.equal(truth.surfacePayload.executionPacket, truth.bestPacket);
  assert.equal(truth.events.length >= 1, true);
});

test('buildDeterministicPacketTruthFromInputs emits blocked no-trade reason instead of executable setup when packet is not ready', () => {
  const truth = __test.buildDeterministicPacketTruthFromInputs({
    inputs: runtimeInputs(),
    previousWalkers: [],
    event: { ts: '2026-05-29T13:45:00.000Z', tf: '1m' },
    session: 'ny-am',
  });

  assert.equal(truth.finalVerdict, 'no_trade');
  assert.equal(truth.bestPacket, null);
  assert.equal(truth.surfacePayload, null);
  assert.match(truth.noTradeReason, /deterministic packet blocked/);
});

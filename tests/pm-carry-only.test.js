import assert from 'node:assert/strict';
import test from 'node:test';

import { __test } from '../app/main/bar-close.js';

// Minimal confirmed-walker + inputs that promote to a surfaced packet (mirrors
// bar-close-deterministic-packet-runtime.test.js). The PM carry-only gate must
// suppress this fresh spawn ONLY when the flag is on AND session === 'ny-pm'.
const confirmedWalker = {
  id: 'w_MNQ1__ny-pm_MSS_long_pdlargebull',
  market: 'MNQ1!',
  session: 'ny-pm',
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
    ltf_bias_context: { bias: 'bullish', htf_ltf_alignment: 'aligned', is_retrace_day: false, entry_model_priority: 'MSS', grade_cap: 'A+' },
    session_state: {
      pillar1: { status: 'pass', htfBias: 'bullish', htfDraw: 'above PDH', primaryDraw: 'PDH' },
      pillar2: { status: 'pass', verdict: 'pass' },
    },
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

function fold(session) {
  return __test.buildDeterministicPacketTruthFromInputs({
    inputs: runtimeInputs(),
    previousWalkers: [confirmedWalker],
    event: { ts: '2026-05-29T18:45:00.000Z', tf: '1m' },
    session,
  });
}

function withFlag(value, fn) {
  const prev = process.env.GOFNQ_PM_CARRY_ONLY;
  if (value == null) delete process.env.GOFNQ_PM_CARRY_ONLY;
  else process.env.GOFNQ_PM_CARRY_ONLY = value;
  try { return fn(); } finally {
    if (prev == null) delete process.env.GOFNQ_PM_CARRY_ONLY;
    else process.env.GOFNQ_PM_CARRY_ONLY = prev;
  }
}

test('PM carry-only OFF (default): ny-pm still spawns a fresh setup', () => {
  withFlag(undefined, () => {
    const truth = fold('ny-pm');
    assert.ok(truth.bestPacket, 'expected a surfaced packet with the lever off');
    assert.equal(truth.surfacePayload.entry, 21000);
  });
});

test('PM carry-only ON: ny-pm fresh spawn is suppressed with pm_carry_only blocker', () => {
  withFlag('1', () => {
    const truth = fold('ny-pm');
    assert.equal(truth.bestPacket, null, 'fresh PM spawn must be suppressed');
    assert.equal(truth.finalVerdict, 'no_trade');
    assert.ok(truth.blockers.includes('pm_carry_only'), `expected pm_carry_only blocker, got ${truth.blockers.join(',')}`);
  });
});

test('PM carry-only ON: ny-am is unaffected (gate is PM-only)', () => {
  withFlag('1', () => {
    const truth = fold('ny-am');
    assert.ok(truth.bestPacket, 'AM spawns must be untouched by the PM gate');
    assert.equal(truth.surfacePayload.entry, 21000);
  });
});

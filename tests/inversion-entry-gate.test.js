import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inversionEntryValid } from '../app/main/strategy/walkers/inversion-lifecycle.js';

// Stage-G deterministic inversion gate (depth-in-leg → reversal needs a recent
// session-tier grab / continuation needs a swing-tier trend). Leg 29000–30000.
const NOW = Date.parse('2026-06-09T14:00:00.000Z');
const min = (m) => NOW - m * 60000;
const ctx = ({ sweeps = [], structuresSwing = [], legHigh = 30000, legLow = 29000, coherence }) => ({
  pillar2: { legHigh, legLow, coherence },
  pillar3: { sweeps, structuresSwing },
});

test('reversal (deep) VALID with a recent session-tier opposing grab', () => {
  const r = inversionEntryValid({
    context: ctx({ sweeps: [{ side: 'buy', target: 'NYAM.H', swept_ms: min(30) }] }),
    side: 'short', entryPrice: 29400, nowMs: NOW, // depth 60%
  });
  assert.equal(r.kind, 'reversal');
  assert.equal(r.valid, true);
});

test('reversal (deep) INVALID when the only grab is stale (overnight)', () => {
  const r = inversionEntryValid({
    context: ctx({ sweeps: [{ side: 'buy', target: 'AS.H', swept_ms: min(300) }] }),
    side: 'short', entryPrice: 29400, nowMs: NOW,
  });
  assert.equal(r.kind, 'reversal');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'reversal_no_recent_grab');
});

test('continuation (shallow) VALID with a swing-tier trend break', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss', tier: 'swing' }] }),
    side: 'short', entryPrice: 29900, nowMs: NOW, // depth 10%
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, true);
});

test('continuation (shallow) INVALID without a swing-tier trend', () => {
  const r = inversionEntryValid({
    // hasContext via a sweep, but no swing structure
    context: ctx({ sweeps: [{ side: 'buy', target: 'LO.H', swept_ms: min(20) }] }),
    side: 'short', entryPrice: 29900, nowMs: NOW,
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'continuation_no_swing_trend');
});

test('long mirror: reversal needs a recent sell-side grab', () => {
  const valid = inversionEntryValid({
    context: ctx({ sweeps: [{ side: 'sell', target: 'NYAM.L', swept_ms: min(15) }] }),
    side: 'long', entryPrice: 29600, nowMs: NOW, // depth 60%
  });
  assert.equal(valid.valid, true);
  const invalid = inversionEntryValid({
    context: ctx({ sweeps: [{ side: 'buy', target: 'NYAM.H', swept_ms: min(15) }] }), // wrong side
    side: 'long', entryPrice: 29600, nowMs: NOW,
  });
  assert.equal(invalid.valid, false);
});

test('fail-open: no sweep AND no structure (minimal fixture) → valid', () => {
  const r = inversionEntryValid({ context: ctx({}), side: 'short', entryPrice: 29400, nowMs: NOW });
  assert.equal(r.kind, 'no_context');
  assert.equal(r.valid, true);
});

test('fail-open: unreadable leg extremes → valid', () => {
  const r = inversionEntryValid({
    context: { pillar2: {}, pillar3: { sweeps: [{ side: 'buy', target: 'NYAM.H', swept_ms: min(10) }] } },
    side: 'short', entryPrice: 29400, nowMs: NOW,
  });
  assert.equal(r.valid, true);
});

test('continuation chop veto: low m15 coherence → invalid (G3)', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss' }], coherence: 0.1 }),
    side: 'short', entryPrice: 29900, nowMs: NOW, // shallow continuation
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'chop_low_coherence');
});

test('continuation: high coherence (clean trend) → valid', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss' }], coherence: 0.8 }),
    side: 'short', entryPrice: 29900, nowMs: NOW,
  });
  assert.equal(r.valid, true);
});

test('continuation: NULL coherence (no m15 bars) → valid, NOT chop (Number(null) guard)', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss' }], coherence: null }),
    side: 'short', entryPrice: 29900, nowMs: NOW,
  });
  assert.equal(r.valid, true, 'null coherence must fail-open, not read as 0/chop');
});

// Continuation = run WITH the CURRENT trend ("clear strong trend in price",
// Entry-Models 11:15). The current trend is set by the MOST-RECENT swing-tier
// break (by confirmed_ms), not any stale break still in the history list.
// 2026-06-24 ny-am: a bull continuation long fired one bar after a bear MSS
// because an old bull BOS still sat in structuresSwing.
test('continuation: most-recent swing-tier break AGAINST the trade direction → invalid (2026-06-24 ny-am bug)', () => {
  const r = inversionEntryValid({
    context: ctx({
      structuresSwing: [
        { dir: 'bull', event: 'bos', confirmed_ms: min(600) }, // stale bull
        { dir: 'bear', event: 'bos', confirmed_ms: min(30) },  // recent bear = current trend
      ],
      coherence: 0.8,
    }),
    side: 'long', entryPrice: 29100, nowMs: NOW, // shallow → continuation
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'continuation_trend_against');
});

test('continuation: most-recent swing-tier break WITH the trade direction → valid', () => {
  const r = inversionEntryValid({
    context: ctx({
      structuresSwing: [
        { dir: 'bear', event: 'bos', confirmed_ms: min(600) }, // stale bear
        { dir: 'bull', event: 'mss', confirmed_ms: min(30) },  // recent bull = current trend
      ],
      coherence: 0.8,
    }),
    side: 'long', entryPrice: 29100, nowMs: NOW,
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, true);
});

test('GOFNQ_INV_GATE=0 disables the gate', () => {
  const prev = process.env.GOFNQ_INV_GATE;
  process.env.GOFNQ_INV_GATE = '0';
  try {
    const r = inversionEntryValid({ context: ctx({}), side: 'short', entryPrice: 29400, nowMs: NOW });
    assert.equal(r.valid, true);
    assert.equal(r.kind, 'disabled');
  } finally {
    if (prev === undefined) delete process.env.GOFNQ_INV_GATE; else process.env.GOFNQ_INV_GATE = prev;
  }
});

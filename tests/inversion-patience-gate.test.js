import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inversionPatienceOk } from '../app/main/strategy/walkers/inversion-lifecycle.js';

// Patience gate (GOFNQ_INV_PATIENCE, default-off): an inversion confirms only AFTER
// the opposing-side INTERNAL liquidity sweep that anchors the stop (Lanto "stop
// relative low" / "major liquidity taken first"). A long needs a recently-swept
// internal LOW; a short a swept internal HIGH. 06-15: the 09:46 long is premature
// (no recent low swept); the 10:30 long works (after the 10:15 dip). Uses the
// schema-4 engine signal swing.swept_ms; pre-swept_ms tapes fail open.
const NOW = Date.parse('2026-06-15T14:30:00.000Z'); // 06-15 10:30 ET entry
const min = (m) => NOW - m * 60000;
const ctx = (internalSwings = []) => ({ pillar3: { internalSwings } });
const sweptLow = (agoMin) => ({ kind: 'HL', is_high: false, swept: true, swept_ms: min(agoMin), price: 7605 });
const sweptHigh = (agoMin) => ({ kind: 'LH', is_high: true, swept: true, swept_ms: min(agoMin), price: 7068 });

function withPatience(fn, env = {}) {
  const saved = {};
  const keys = ['GOFNQ_INV_PATIENCE', ...Object.keys(env)];
  for (const k of keys) saved[k] = process.env[k];
  process.env.GOFNQ_INV_PATIENCE = '1';
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try { fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('disabled by default → ok (no gating)', () => {
  const r = inversionPatienceOk({ context: ctx([sweptHigh(10)]), side: 'long', nowMs: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'disabled');
});

test('flag on, no internal swings → fail-open', () => {
  withPatience(() => {
    const r = inversionPatienceOk({ context: ctx([]), side: 'long', nowMs: NOW });
    assert.equal(r.ok, true);
  });
});

test('flag on, swings present but no swept_ms (old engine) → fail-open', () => {
  withPatience(() => {
    const r = inversionPatienceOk({ context: ctx([{ kind: 'HL', is_high: false, swept: true }]), side: 'long', nowMs: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'no_timing_data');
  });
});

test('LONG: recent swept internal LOW → ok (06-15 10:30, after the 10:15 dip)', () => {
  withPatience(() => {
    const r = inversionPatienceOk({ context: ctx([sweptLow(15)]), side: 'long', nowMs: NOW });
    assert.equal(r.ok, true);
  });
});

test('LONG: only a STALE swept low → blocked (06-15 09:46 premature, pre-dip)', () => {
  withPatience(() => {
    const r = inversionPatienceOk({ context: ctx([sweptLow(120)]), side: 'long', nowMs: NOW });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_recent_opposing_internal_sweep');
  });
});

test('LONG: only a swept HIGH (wrong side) → blocked', () => {
  withPatience(() => {
    const r = inversionPatienceOk({ context: ctx([sweptHigh(10)]), side: 'long', nowMs: NOW });
    assert.equal(r.ok, false);
  });
});

test('SHORT: recent swept internal HIGH → ok (01-29, after the pre-short rally)', () => {
  withPatience(() => {
    const r = inversionPatienceOk({ context: ctx([sweptHigh(10)]), side: 'short', nowMs: NOW });
    assert.equal(r.ok, true);
  });
});

test('a sweep AFTER the entry bar (future swept_ms) does not count', () => {
  withPatience(() => {
    const futureLow = { kind: 'HL', is_high: false, swept: true, swept_ms: NOW + 60000, price: 7605 };
    const r = inversionPatienceOk({ context: ctx([futureLow]), side: 'long', nowMs: NOW });
    assert.equal(r.ok, false);
  });
});

test('recency tunable via GOFNQ_INV_PATIENCE_RECENCY', () => {
  withPatience(() => {
    const r = inversionPatienceOk({ context: ctx([sweptLow(40)]), side: 'long', nowMs: NOW });
    assert.equal(r.ok, false); // 40 min > 30 min window
  }, { GOFNQ_INV_PATIENCE_RECENCY: '30' });
});

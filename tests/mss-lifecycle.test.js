import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMssWalkerSpawnRequests } from '../app/main/strategy/walkers/mss-lifecycle.js';

// D3 — MSS significance gate (entry-models.md §MSS §2/§3): the grab must hit
// SIGNIFICANT liquidity (named session/PD level, or a swing-tier grab), and the
// shift must break it WITH displacement (a large-bodied breaking candle = the
// speed Lanto requires), swing-tier. Short-side context mirrors the June-9 MSS.
function shortMssContext({ sweep = {}, shift = {} } = {}) {
  return {
    pillar2: { displacement: 'clean' },
    pillar3: {
      sweeps: [{ side: 'buy', rejected: true, target: 'LO.H', price: 30092, swept_ms: 1000, ...sweep }],
      failureSwings: [{
        dir: 'bear', event: 'mss', validation: 'sweep', tier: 'swing', displacement: true,
        level: 30067, broken_swing_ms: 900, confirmed_ms: 2000, ...shift,
      }],
      fvgs: [{ dir: 'bear', kind: 'fvg', state: 'fresh', top: 30070, bottom: 30050, ce: 30060 }],
    },
  };
}

test('MSS spawns on a significant named-level grab + displaced swing-tier shift', () => {
  const reqs = buildMssWalkerSpawnRequests(shortMssContext());
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].model, 'MSS');
  assert.equal(reqs[0].side, 'short');
});

test('MSS does NOT spawn off an insignificant grab + internal shift (the 1m-equal-low case, §2)', () => {
  // unnamed/internal target AND an internal-tier shift → neither the session-level
  // sweep path nor the swing-grab fallback qualifies.
  const reqs = buildMssWalkerSpawnRequests(shortMssContext({
    sweep: { target: 'EQH' }, shift: { tier: 'internal' },
  }));
  assert.equal(reqs.length, 0);
});

test('MSS does NOT spawn when the reversal break lacks displacement (§3 speed gate)', () => {
  const reqs = buildMssWalkerSpawnRequests(shortMssContext({ shift: { displacement: false } }));
  assert.equal(reqs.length, 0);
});

test('MSS does NOT spawn when the shift is internal-tier (not a real structural turn, §3)', () => {
  const reqs = buildMssWalkerSpawnRequests(shortMssContext({ shift: { tier: 'internal' } }));
  assert.equal(reqs.length, 0);
});

test('MSS still spawns on a field-less (legacy) context — gates only fire when the engine stamps them', () => {
  // No target on the sweep, no tier/displacement on the shift (hand-built fixture shape).
  const reqs = buildMssWalkerSpawnRequests(shortMssContext({
    sweep: { target: undefined }, shift: { tier: undefined, displacement: undefined },
  }));
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].model, 'MSS');
});

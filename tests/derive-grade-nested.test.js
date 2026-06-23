import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../app/main/strategy/walkers/execution-packet.js';

const { deriveGrade } = __test;

// Step 1 of the Stage-C→live grade integration: the packet grade is now the
// 3-vote NESTED grade (daily-bias §1) when the live resolver supplies it
// (chain.drawBiasPillar present) — a_plus_eligible (3/3 + good price) → A+, 2/3
// → B — instead of the old alignment heuristic. Field-less inputs fall back.
const ctx = (chain) => ({
  pillar1: { status: 'pass' },
  pillar2: { status: 'pass' },
  sessionChain: { ltfBias: 'bearish', gradeCap: 'A+', ...chain },
});
const shortWalker = { model: 'Inversion', side: 'short' };

test('nested 3/3 (a_plus_eligible) + known model + side aligned → A+', () => {
  const g = deriveGrade({
    context: ctx({ drawBiasPillar: 'confirmed-3of3', aPlusEligible: true, bElevatable: false }),
    walker: shortWalker,
  });
  assert.equal(g, 'A+');
});

test('nested 2/3 (not a_plus_eligible) → B even when aligned', () => {
  const g = deriveGrade({
    context: ctx({ drawBiasPillar: 'clear-2of3', aPlusEligible: false, bElevatable: true }),
    walker: shortWalker,
  });
  assert.equal(g, 'B');
});

test('nested 3/3 but the side is NOT in the bias direction → B (constraint #9)', () => {
  const g = deriveGrade({
    context: ctx({ drawBiasPillar: 'confirmed-3of3', aPlusEligible: true }),
    walker: { model: 'MSS', side: 'long' }, // long against a bearish bias
  });
  assert.equal(g, 'B');
});

test('nested 3/3 but unknown model → B', () => {
  const g = deriveGrade({
    context: ctx({ drawBiasPillar: 'confirmed-3of3', aPlusEligible: true }),
    walker: { model: 'unknown', side: 'short' },
  });
  assert.equal(g, 'B');
});

test('pillars not passing → no-trade regardless of nested grade', () => {
  const g = deriveGrade({
    context: { pillar1: { status: 'blocked' }, pillar2: { status: 'pass' }, sessionChain: { drawBiasPillar: 'confirmed-3of3', aPlusEligible: true } },
    walker: shortWalker,
  });
  assert.equal(g, 'no-trade');
});

// D5 — multi-alignment ("two-and-one") elevates a 2/3 b_elevatable day to A+.
const elevCtx = (fvgs5m) => ({
  pillar1: { status: 'pass' },
  pillar2: { status: 'pass' },
  pillar3: { fvgs5m },
  sessionChain: { ltfBias: 'bearish', gradeCap: 'B', drawBiasPillar: 'clear-2of3', aPlusEligible: false, bElevatable: true },
});
const elevWalker = { model: 'Inversion', side: 'short', evidence: { pdArray: { rawPayload: { top: 29795, bottom: 29790 } } } };

test('D5: 2/3 + a distinct overlapping same-direction 5m FVG → elevated to A+', () => {
  const g = deriveGrade({
    context: elevCtx([{ dir: 'bear', top: 29796, bottom: 29788 }]), // overlaps the 1m entry zone, distinct, bearish
    walker: elevWalker,
  });
  assert.equal(g, 'A+');
});

test('D5: 2/3 with NO 5m FVG partner → stays B', () => {
  assert.equal(deriveGrade({ context: elevCtx([]), walker: elevWalker }), 'B');
});

test('D5: 2/3 with an OPPOSITE-direction 5m FVG → stays B (not a real alignment)', () => {
  const g = deriveGrade({ context: elevCtx([{ dir: 'bull', top: 29796, bottom: 29788 }]), walker: elevWalker });
  assert.equal(g, 'B');
});

test('D5: the entry zone itself does not self-elevate (must be a DISTINCT 5m zone)', () => {
  const g = deriveGrade({ context: elevCtx([{ dir: 'bear', top: 29795, bottom: 29790 }]), walker: elevWalker });
  assert.equal(g, 'B');
});

test('legacy fallback: no drawBiasPillar → old alignment+displacement path still grades A+', () => {
  const g = deriveGrade({
    context: {
      pillar1: { status: 'pass' }, pillar2: { status: 'pass', displacement: 'clean' },
      sessionChain: { ltfBias: 'bearish', htfLtfAlignment: 'aligned', gradeCap: 'A+' }, // no drawBiasPillar
    },
    walker: shortWalker,
  });
  assert.equal(g, 'A+');
});

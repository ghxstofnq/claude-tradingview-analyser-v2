import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLeader } from '../cli/lib/compute-leader.js';

// Synthetic engine builder. Returns a parsed-engine shape with only the
// fields compute-leader reads (fvgs[].disp_score and fvgs[].created_ms).
function engineWithFvgs(fvgs) {
  return { fvgs };
}

const windowStart = 1_000_000;
const windowEnd = windowStart + 15 * 60 * 1000;
const inWindow = windowStart + 1000;
const beforeWindow = windowStart - 1000;

test('picks the symbol with the higher max disp_score', () => {
  const primary = engineWithFvgs([
    { created_ms: inWindow, disp_score: 0.4 },
    { created_ms: inWindow, disp_score: 0.82 },
  ]);
  const secondary = engineWithFvgs([
    { created_ms: inWindow, disp_score: 0.54 },
  ]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, 'MNQ1!');
  assert.equal(res.primary_disp_score, 0.82);
  assert.equal(res.secondary_disp_score, 0.54);
  assert.ok(Math.abs(res.margin - 0.28) < 1e-9);
  assert.equal(res.reason, 'primary_higher_disp_score');
});

test('returns secondary when secondary leads', () => {
  const primary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.30 }]);
  const secondary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.70 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, 'MES1!');
  assert.equal(res.reason, 'secondary_higher_disp_score');
});

test('inconclusive when margin under threshold', () => {
  const primary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.55 }]);
  const secondary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.50 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, null);
  assert.equal(res.reason, 'inconclusive_margin_below_threshold');
});

test('null when secondary engine missing', () => {
  const primary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.82 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: null,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, null);
  assert.equal(res.reason, 'secondary_engine_missing');
});

test('null when no FVGs created in window', () => {
  const primary = engineWithFvgs([{ created_ms: beforeWindow, disp_score: 0.82 }]);
  const secondary = engineWithFvgs([{ created_ms: beforeWindow, disp_score: 0.70 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, null);
  assert.equal(res.reason, 'no_fvgs_created_in_window');
});

test('ignores FVGs with non-finite disp_score', () => {
  const primary = engineWithFvgs([
    { created_ms: inWindow, disp_score: null },
    { created_ms: inWindow, disp_score: 0.30 },
  ]);
  const secondary = engineWithFvgs([
    { created_ms: inWindow, disp_score: NaN },
    { created_ms: inWindow, disp_score: 0.10 },
  ]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
  });
  assert.equal(res.leader, 'MNQ1!');
  assert.equal(res.primary_disp_score, 0.30);
  assert.equal(res.secondary_disp_score, 0.10);
});

test('threshold is configurable', () => {
  const primary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.55 }]);
  const secondary = engineWithFvgs([{ created_ms: inWindow, disp_score: 0.50 }]);
  const res = computeLeader({
    primary: 'MNQ1!', secondary: 'MES1!',
    primaryEngine: primary, secondaryEngine: secondary,
    windowStartMs: windowStart, windowEndMs: windowEnd,
    threshold: 0.01,
  });
  assert.equal(res.leader, 'MNQ1!');
});

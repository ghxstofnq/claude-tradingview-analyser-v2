import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chartResolutionMatches } from '../cli/lib/replay-recovery.js';

test('chartResolutionMatches accepts TradingView daily alias 1D for requested D', () => {
  assert.equal(chartResolutionMatches('D', '1D'), true);
  assert.equal(chartResolutionMatches('D', 'D'), true);
});

test('chartResolutionMatches keeps numeric resolutions exact', () => {
  assert.equal(chartResolutionMatches('240', '240'), true);
  assert.equal(chartResolutionMatches('240', '60'), false);
  assert.equal(chartResolutionMatches('1', '5'), false);
});

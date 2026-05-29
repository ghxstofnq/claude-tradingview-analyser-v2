import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryHuntFastScanArgs,
  shouldShortCircuitAfterWalkerTick,
} from '../app/main/bar-close.js';
import { PAIR_DEFAULT, PAIR_PRIMARY, PAIR_SECONDARY, baselinePathFor } from '../app/main/config.js';

describe('bar-close entry-hunt hybrid flow', () => {
  test('entry-hunt walker tick must not short-circuit Claude packaging', () => {
    assert.equal(shouldShortCircuitAfterWalkerTick({ phase: 'entry_hunt' }), false);
  });

  test('entry-hunt scan refresh uses paired fast scan with both baselines', () => {
    assert.deepEqual(entryHuntFastScanArgs(), {
      pair: PAIR_DEFAULT,
      baseline: baselinePathFor(PAIR_PRIMARY),
      baselineSecondary: baselinePathFor(PAIR_SECONDARY),
    });
  });
});

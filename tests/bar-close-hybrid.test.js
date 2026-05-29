import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  briefFilenameForLeader,
  entryHuntFastScanArgs,
  htfBiasFromBrief,
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

  test('entry-hunt reads the leader-specific brief instead of stale combined brief.json', () => {
    assert.equal(briefFilenameForLeader('mnq'), `brief-${PAIR_PRIMARY}.json`);
    assert.equal(briefFilenameForLeader('mes'), `brief-${PAIR_SECONDARY}.json`);
  });

  test('entry-hunt parses prose htf_destination into detector direction', () => {
    assert.equal(htfBiasFromBrief({ htf_destination: 'above NYAM.H 7611.75 buy-side' }), 'above');
    assert.equal(htfBiasFromBrief({ htf_destination: 'below LO.L 7580.25 sell-side' }), 'below');
  });
});

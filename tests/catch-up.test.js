import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRouteToCatchUp } from '../app/main/bar-close.js';

describe('catch-up routing', () => {
  test('inside open-reaction window, no ltf-bias.md → normal flow (not catch-up)', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'open_reaction_ny_am',
      minutesIntoPhase: 5,
      pillar1Exists: true,
      ltfBiasExists: false,
    });
    assert.equal(r, false);
  });

  test('past open-reaction window (entry_hunt phase), no ltf-bias.md, pillar1 exists → catch-up', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'entry_hunt_ny_am',
      minutesIntoPhase: 30,
      pillar1Exists: true,
      ltfBiasExists: false,
    });
    assert.equal(r, true);
  });

  test('past window, ltf-bias.md exists → normal flow (not catch-up)', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'entry_hunt_ny_am',
      minutesIntoPhase: 30,
      pillar1Exists: true,
      ltfBiasExists: true,
    });
    assert.equal(r, false);
  });

  test('no pillar1.md → not catch-up (brief never ran is a different problem)', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'entry_hunt_ny_am',
      minutesIntoPhase: 30,
      pillar1Exists: false,
      ltfBiasExists: false,
    });
    assert.equal(r, false);
  });

  test('NY PM past window, no ltf-bias.md, pillar1 exists → catch-up', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'entry_hunt_ny_pm',
      minutesIntoPhase: 30,
      pillar1Exists: true,
      ltfBiasExists: false,
    });
    assert.equal(r, true);
  });

  test('post_session phase with missing ltf-bias.md → catch-up (still worth backfilling for wrap)', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'post_ny_am',
      minutesIntoPhase: 5,
      pillar1Exists: true,
      ltfBiasExists: false,
    });
    assert.equal(r, true);
  });

  test('inter_session phase → not catch-up', () => {
    const r = shouldRouteToCatchUp({
      sessionPhase: 'inter_session',
      minutesIntoPhase: 0,
      pillar1Exists: true,
      ltfBiasExists: false,
    });
    assert.equal(r, false);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { __test } from '../cli/commands/live.js';

test('defaultTruthPathForSession points live-dry-run at current ET session deterministic truth', () => {
  const p = __test.defaultTruthPathForSession({
    session: 'ny-pm',
    nowMs: Date.parse('2026-06-02T22:28:34.490Z'),
  });

  assert.match(p, /state\/session\/2026-06-02\/ny-pm\/deterministic-packet\.json$/);
});

test('sessionFromOpts defaults to the active ET session instead of hard-coding NY-AM', () => {
  assert.equal(__test.sessionFromOpts({ now: '2026-06-02T17:30:00.000Z' }), 'ny-pm');
  assert.equal(__test.sessionFromOpts({ now: '2026-06-02T13:45:00.000Z' }), 'ny-am');
  assert.equal(__test.sessionFromOpts({ now: '2026-06-02T07:30:00.000Z' }), 'london');
  assert.equal(__test.sessionFromOpts({ now: '2026-06-02T11:13:00.000Z' }), 'idle');
});

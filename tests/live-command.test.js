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
